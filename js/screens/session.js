/* Единый экран урока. Все записи используют существующий журнал, без отдельной копии данных. */
import * as S from '../store.js';
import * as M from '../model.js';
import * as H from '../health.js';
import * as ui from '../ui.js';
import {openParticipation} from './participation.js';
import {editTags} from './health.js';
import {batchTable} from './norm-batch.js';
const {el,toast,openSheet}=ui;
const btn=(text,onclick,kind='')=>el('button',{type:'button',class:'btn '+kind,text,onclick});
const p=text=>el('p',{text});
const field=(text,input)=>el('label',{class:'field'},[el('span',{text}),input]);
const select=(rows,value)=>{const n=el('select',{},rows.map(([v,text])=>el('option',{value:v,text})));if(value!=null)n.value=value;return n;};
export function openLessonPicker(classId,date=M.todayIso()){
  const input=el('input',{type:'date',value:date,max:M.todayIso()});
  const dates=S.lessonsOfClass(classId).filter(l=>l.date<=M.todayIso()).slice().reverse();
  const picker=select([['','Выбрать дату'],...dates.map(l=>[l.date,M.fmtFull(l.date)])],'');
  picker.onchange=()=>{if(picker.value)input.value=picker.value;};
  openSheet(el('div',{},[el('h2',{text:'Проведение урока'}),field('Существующий урок',picker),field('Дата',input),btn('Открыть урок',()=>openLessonSession(classId,input.value),'primary wide')]));
}
export async function openLessonSession(classId,date=M.todayIso()){
  if(!S.state.classes.some(c=>c.id===classId)||!H.validPeriod(date,null)||date>M.todayIso())return toast('Выберите класс и дату не позднее сегодняшней');
  if(!S.studentsOfClass(classId).length)return toast('В классе нет учеников');
  try{
    const lesson=await S.addLesson(classId,date);
    showLessonSession(lesson.id);
  }catch(e){toast(e.message);}
}
export function showLessonSession(lessonId){
  let mode='attendance',query='',action='normal',grade='5',busy=false;
  const selected=new Set();
  const panel=el('div',{class:'lesson-session'}),head=el('div',{class:'lesson-session-head'}),nav=el('div',{class:'lesson-session-nav'}),body=el('div',{class:'lesson-session-body'});
  const status=el('p',{role:'status','aria-live':'polite'}),search=el('input',{type:'search',placeholder:'Найти ученика','aria-label':'Найти ученика'});
  panel.append(head,nav,body,status);
  const lessonNow=()=>S.state.lessons.find(l=>l.id===lessonId);
  const reopen=()=>{draw();openSheet(panel);};
  const run=async fn=>{
    if(busy)return;busy=true;status.textContent='Сохранение…';
    const controls=[...panel.querySelectorAll('button,input,select')].filter(n=>!n.disabled);
    controls.forEach(n=>n.disabled=true);
    try{await fn();status.textContent='Сохранено';draw();}
    catch(e){status.textContent=e.message;toast(e.message);}
    finally{busy=false;controls.forEach(n=>n.disabled=false);}
  };
  function draw(){
    const lesson=lessonNow();if(!lesson){panel.replaceChildren(p('Урок больше недоступен'));return;}
    const cls=S.state.classes.find(c=>c.id===lesson.classId),students=S.studentsOfClass(lesson.classId),marks=S.markMap(lesson.classId);
    const parts=new Map(S.state.participation.filter(x=>x.lessonId===lessonId).map(x=>[x.studentId,x]));
    const {matches,needsReview}=S.lessonCheck(lesson),byStudent=new Map();
    for(const m of matches){if(!byStudent.has(m.studentId))byStudent.set(m.studentId,[]);byStudent.get(m.studentId).push(m);}
    const rows=students.map(st=>{
      const mark=marks.get(lessonId+'|'+st.id),part=parts.get(st.id),covered=!!S.activeExemption(st.id,lesson.date)||M.hasOsv(mark),warnings=byStudent.get(st.id)||[];
      const absent=mark?.flag==='Н',present=!absent&&!!(part||mark?.value||mark?.source==='manual'||mark?.baseMark?.source==='manual');
      return {st,mark,part,covered,warnings,absent,present};
    });
    const unknown=rows.filter(r=>!r.absent&&!r.present).length;
    const topic=S.state.topics.find(t=>t.id===lesson.topicId);
    head.replaceChildren(el('h2',{text:(cls?.name||'Класс')+' · Урок'}),p(M.fmtFull(lesson.date)+' · '+(lesson.held?'Проведение подтверждено':'Рабочий экран')),
      p(topic?.name||'Тема КТП не указана'),p('Присутствуют: '+rows.filter(r=>r.present).length+' · отсутствуют: '+rows.filter(r=>r.absent).length+' · не отмечено: '+unknown),
      p('ОСВ: '+rows.filter(r=>r.covered).length+' · совпадения ограничений: '+byStudent.size),
      needsReview?p('Содержание нагрузки требует проверки. Отсутствие совпадений не является допуском.'):p('Проверка по внесённым сведениям, не медицинский допуск.'));
    nav.replaceChildren(...Object.entries({attendance:'Явка',grades:'Оценки',participation:'Нагрузка',norms:'Нормативы',details:'Тема и завершение'}).map(([id,text])=>btn(text,()=>{mode=id;selected.clear();action=id==='grades'?'grade':'normal';draw();},mode===id?'primary':'')));
    body.replaceChildren();
    if(mode==='details'){
      const topics=S.topicsForClass(lesson.classId),options=[['','Без темы'],...topics.map(t=>[t.id,t.name])];
      if(topic&&!topics.some(t=>t.id===topic.id))options.push([topic.id,topic.name+' (другой план)']);
      const choice=select(options,lesson.topicId||''),note=el('textarea',{placeholder:'Заметка к уроку'});note.value=lesson.note||'';
      body.append(field('Тема КТП',choice),field('Заметка',note),btn('Сохранить тему и заметку',()=>run(()=>S.updateLesson(lessonId,{topicId:choice.value||null,note:note.value.trim()})),'primary wide'),
        btn('Настроить виды нагрузки',()=>editTags(lesson,false,reopen),'wide'),
        p('Подтверждение проведения не заполняет автоматически пустые строки явки.'),
        btn(lesson.held?'Закрыть урок':'Подтвердить проведение урока',async()=>{
          if(lesson.held){ui.closeSheet();return;}
          if(!await ui.confirmDialog({title:'Завершить урок?',text:'Не отмечено: '+unknown+'. Пустые строки останутся неизвестными. Подтвердить, что занятие проведено?',ok:'Подтвердить'}))return;
          await run(()=>S.updateLesson(lessonId,{held:true}));
        },'primary wide'),btn('Выйти без подтверждения',ui.closeSheet,'wide'));
      return;
    }
    if(mode==='norms'){
      body.append(p('Выберите норматив. Результаты сохраняются на дату этого урока, с соответствующими шкалами и проверкой ограничений.'));
      if(!S.state.norms.length)body.append(p('Нет настроенных нормативов. Добавьте их в разделе «Нормативы».'));
      for(const n of S.state.norms){
        const saved=S.state.normResults.filter(r=>r.normId===n.id&&r.lessonId===lessonId);
        body.append(btn(n.name+' · записано '+new Set(saved.map(r=>r.studentId)).size+' / '+students.length,()=>batchTable(n,lesson.classId,lessonId,reopen),'wide'));
      }
      return;
    }
    const eligible=r=>!S.lessonBatchReason(action,r.mark,r.part,r.covered,r.warnings.length>0);
    const visible=()=>rows.filter(r=>r.st.fullName.toLocaleLowerCase('ru').includes(query));
    const list=el('div',{class:'lesson-session-list'}),selectionStatus=p('');
    function drawRows(){
      const shown=visible();list.replaceChildren();selectionStatus.textContent='Выбрано: '+selected.size;
      for(const r of shown){
        const {st,mark,part,covered,warnings}=r;
        const row=el('article',{class:'card-block lesson-session-row'},[el('strong',{text:st.fullName}),
          p((r.absent?'Отсутствует':r.present?'Присутствует':'Явка не отмечена')+' · '+(mark?.value?'Оценка '+mark.value:'Без оценки')+(covered?' · ОСВ':''))]);
        if(part)row.append(p(S.participationModes[part.mode]||'Участие записано'));
        for(const m of warnings)row.append(p('Ограничение: '+(S.activities().find(a=>a.id===m.restriction.activityId)?.name||'нагрузка')+' · '+(H.types[m.restriction.type]||'проверить')+(m.restriction.instruction?' · '+m.restriction.instruction:'')));
        if(mode==='participation'||mode==='attendance')row.append(btn('Участие / основание',()=>openParticipation(st.id,lessonId,undefined,reopen),'wide'));
        if(mode==='grades'||mode==='attendance'){
          const check=el('input',{type:'checkbox','aria-label':'Выбрать '+st.fullName});check.checked=selected.has(st.id);check.disabled=!eligible(r);
          check.onchange=()=>{if(check.checked)selected.add(st.id);else selected.delete(st.id);selectionStatus.textContent='Выбрано: '+selected.size;};
          row.append(field('Выбрать для массового действия',check));
          if(!eligible(r))row.append(p(S.lessonBatchReason(action,mark,part,covered,warnings.length>0)));
          if(mode==='grades'){
            const choice=select([['','Без оценки'],...['5','4','3','2','1'].map(v=>[v,v])],mark?.value||'');
            row.append(field('Индивидуальная оценка',choice),btn('Сохранить оценку',async()=>{
              if(!choice.value)return toast('Для снятия отметки используйте подробную карточку журнала');
              if(r.absent||covered||part?.mode==='paused')return toast('Проверьте явку, ОСВ и участие в подробной карточке');
              if(!await ui.confirmDialog({title:'Подтвердить оценку?',text:(warnings.length?'Есть ограничения нагрузки. Проверьте основание оценки, не назначая противопоказанные упражнения. ':'')+(mark?'Существующая оценка будет изменена. ':'')+'Оценка '+choice.value+'.',ok:'Сохранить'}))return;
              await run(()=>S.setMark(st.id,lessonId,{value:choice.value}));
            },'wide'));
          }else if(!part&&!r.absent){
            row.append(btn('Отметить Н',async()=>{
              if(!await ui.confirmDialog({title:'Отметить отсутствие?',text:mark?.value?'Существующая оценка будет снята. ОСВ при наличии сохраняется.':'Подтвердите отсутствие ученика.',ok:'Отметить Н'}))return;
              await run(()=>S.setMark(st.id,lessonId,{flag:'Н'}));
            },'wide'));
          }
          if(mode==='attendance'&&r.absent)row.append(btn('Снять Н',async()=>{
            if(!await ui.confirmDialog({title:'Снять отметку Н?',text:'Явка снова будет неизвестна, действующее документальное ОСВ сохранится.',ok:'Снять'}))return;
            await run(()=>S.setMark(st.id,lessonId,{value:null,flag:null}));
          },'wide'));
        }
        list.append(row);
      }
      if(!shown.length)list.append(p('Нет учеников по запросу'));
    }
    search.value=query;search.oninput=()=>{query=search.value.trim().toLocaleLowerCase('ru');drawRows();};
    body.append(search);
    if(mode!=='participation'){
      const actionSelect=select(mode==='grades'?[['grade','Выставить оценку в пустые ячейки']]:[['normal','Присутствовали, обычная нагрузка'],['absent','Отсутствовали (Н)']],action);
      actionSelect.onchange=()=>{action=actionSelect.value;selected.clear();draw();};
      body.append(field('Массовое действие',actionSelect));
      if(mode==='grades'){const choice=select(['5','4','3','2','1'].map(v=>[v,v]),grade);choice.onchange=()=>grade=choice.value;body.append(field('Оценка',choice));}
      body.append(p('Выбирайте только фактически проверенных учеников. Заполненные ячейки и ограничения защищены.'),
        btn('Выбрать доступных в списке',()=>{for(const r of visible())if(eligible(r))selected.add(r.st.id);drawRows();},'wide'),
        btn('Снять выбор',()=>{selected.clear();drawRows();},'wide'),selectionStatus,
        btn('Применить к выбранным',async()=>{
          if(!selected.size)return toast('Выберите учеников');
          const ids=[...selected],what=action,markValue=grade;
          if(!await ui.confirmDialog({title:'Подтвердить массовое действие?',text:'Учеников: '+ids.length+'. '+(what==='normal'?'Подтвердите фактическое присутствие и обычную нагрузку.':what==='absent'?'Отметить отсутствие.':'Выставить оценку '+markValue+' в пустые ячейки.')+(needsReview&&what!=='absent'?' Виды нагрузки требуют проверки.':'')+' Существующие записи не заменяются.',ok:'Применить'}))return;
          await run(async()=>{await S.applyLessonBatch(lessonId,ids,what,markValue,true);selected.clear();});
        },'primary wide'));
    }
    for(const id of [...selected])if(!rows.some(r=>r.st.id===id&&eligible(r)))selected.delete(id);
    body.append(list);drawRows();
  }
  draw();openSheet(panel);
}
