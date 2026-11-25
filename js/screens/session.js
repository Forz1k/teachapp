/* Единый экран урока. Все записи используют существующий журнал, без отдельной копии данных. */
import * as S from '../store.js';
import * as M from '../model.js';
import * as H from '../health.js';
import * as ui from '../ui.js';
import {openParticipation} from './participation.js';
import {editTags} from './health.js';
import {batchTable} from './norm-batch.js';
import {openSchoolTeams} from './team-generator.js';
import {metric} from '../dashboard.js';
import * as W from '../workbench.js';
const {el,toast,openSheet}=ui;
const btn=(text,onclick,kind='')=>el('button',{type:'button',class:'btn '+kind,text,onclick});
const p=text=>el('p',{text});
const field=(text,input)=>el('label',{class:'field'},[el('span',{text}),input]);
const select=(rows,value)=>{const n=el('select',{},rows.map(([v,text])=>el('option',{value:v,text})));if(value!=null)n.value=value;return n;};
export function openLessonPicker(classId,date=M.todayIso()){
  const input=el('input',{type:'date',value:date,max:M.todayIso()});
  const dates=S.lessonsOfClass(classId).filter(l=>l.date<=M.todayIso()).slice().reverse();
  const picker=select([['','Выбрать урок'],...dates.map(l=>[l.id,M.lessonLabel(l)])],'');
  picker.onchange=()=>{const selected=dates.find(l=>l.id===picker.value);if(selected)input.value=selected.date;};input.onchange=()=>{picker.value='';};
  const slot=el('input',{type:'number',min:1,max:99,step:1,placeholder:'Необязательно'}),time=el('input',{type:'time'});
  openSheet(el('div',{},[el('h2',{text:'Проведение урока'}),field('Существующий урок',picker),field('Дата',input),field('Номер нового урока',slot),field('Время',time),btn('Открыть урок',()=>picker.value?showLessonSession(picker.value):openLessonSession(classId,input.value,{slot:slot.value===''?null:Number(slot.value),time:time.value}),'primary wide')]));
}
export async function openLessonSession(classId,date=M.todayIso(),options={}){
  if(!S.state.classes.some(c=>c.id===classId)||!H.validPeriod(date,null)||date>M.todayIso())return toast('Выберите класс и дату не позднее сегодняшней');
  if(!S.studentsOfClass(classId).length)return toast('В классе нет учеников');
  try{
    const lesson=await S.addLesson(classId,date,null,'',options);
    showLessonSession(lesson.id);
  }catch(e){toast(e.message);}
}
/** A preview never assigns work or changes existing lesson activity tags. */
export async function openLessonPlanReview(lessonId,back=ui.closeSheet){
  try{
    const plans=(await W.listWork('plan')).filter(p=>p.context==='school');
    const panel=el('div',{class:'coach-form'},[el('h2',{text:'Конспект и подготовка урока'}),p('Выберите утверждённый конспект. Просмотр не меняет тему, журнал или виды нагрузки урока.')]);
    const choice=select([['','Выберите конспект'],...plans.map(p=>[p.id,p.name+' · '+p.minutes+' мин'])],'');
    const preview=el('div',{class:'coach-stack'});
    function draw(){
      preview.replaceChildren();
      const plan=plans.find(p=>p.id===choice.value),lesson=S.state.lessons.find(l=>l.id===lessonId);
      if(!lesson){preview.append(p('Урок больше недоступен.'));return;}
      if(!plan)return;
      const review=W.lessonPlanReview(plan,lesson,{students:S.state.students,activities:S.activities(),restrictions:S.state.activityRestrictions,exemptions:S.state.exemptions});
      const pupils=new Map(S.studentsOfClass(lesson.classId).map(s=>[s.id,s]));
      preview.append(el('h3',{text:plan.name}),p('Цель: '+(plan.goal||'Не указана')),p('Время упражнений: '+review.minutes+' / '+plan.minutes+' мин'),p('Инвентарь: '+(plan.equipment||'Не указан')),...(plan.resources||[]).map(r=>p(r.name+' · '+r.qty+' '+r.unit)),
        p('Документальные ОСВ: '+review.full.length+(review.full.length?' · '+review.full.map(id=>pupils.get(id)?.fullName).filter(Boolean).join(', '):'')),
        p('Сведения сверяются на дату урока. Отсутствие совпадений не является допуском. Проверьте фактическую нагрузку и основания.'));
      for(const {item,matches,needsReview} of review.items){
        const card=el('section',{class:'card-block'},[el('h3',{text:W.phases[item.phase]+' · '+item.exercise.name+' · '+item.minutes+' мин'}),p(item.exercise.description),item.exercise.equipment?p('Инвентарь: '+item.exercise.equipment):null,item.notes?p('Указания: '+item.notes):null]);
        if(needsReview)card.append(p('Категория нагрузки требует проверки.'));
        if(matches.length)for(const m of matches)card.append(el('p',{class:'session-warning has-warning',text:(pupils.get(m.studentId)?.fullName||'Ученик')+' · '+(H.types[m.restriction.type]||'Проверить')}));
        else if(!needsReview)card.append(p('Совпадений по этому упражнению не найдено.'));
        preview.append(card);
      }
    }
    choice.onchange=draw;
    if(plans.length)panel.append(field('Школьный конспект',choice),preview);
    else panel.append(p('Создайте школьный конспект в библиотеке.'));
    panel.append(btn('Вернуться к уроку',back,'wide'));
    openSheet(panel);
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
    head.replaceChildren(el('h2',{text:(cls?.name||'Класс')+' · Урок'}),p(M.lessonLabel(lesson)+' · '+(lesson.held?'Проведение подтверждено':'Рабочий экран')),
      el('h3',{class:'session-topic',text:topic?.name||'Тема КТП не указана'}),el('div',{class:'dashboard-metrics session-metrics'},[metric('Присутствуют',rows.filter(r=>r.present).length,'check'),metric('Отсутствуют',rows.filter(r=>r.absent).length,'classes'),metric('Не отмечено',unknown,'journal'),metric('ОСВ',rows.filter(r=>r.covered).length,'shield')]),
      el('div',{class:'session-warning'+(byStudent.size?' has-warning':''),text:'Совпадения ограничений: '+byStudent.size}),
      needsReview?p('Содержание нагрузки требует проверки. Отсутствие совпадений не является допуском.'):p('Проверка по внесённым сведениям, не медицинский допуск.'));
    nav.replaceChildren(...Object.entries({attendance:'Явка',grades:'Оценки',participation:'Нагрузка',norms:'Нормативы',details:'Тема и завершение'}).map(([id,text])=>btn(text,()=>{mode=id;selected.clear();action=id==='grades'?'grade':'normal';draw();},mode===id?'primary':'')));
    body.replaceChildren();
    if(mode==='attendance')body.append(btn('Конспект и подготовка урока',()=>openLessonPlanReview(lessonId,reopen),'wide'),btn('Генератор команд',()=>openSchoolTeams(lessonId,reopen),'wide'));
    if(mode==='details'){
      const topics=S.topicsForClass(lesson.classId),options=[['','Без темы'],...topics.map(t=>[t.id,t.name])];
      if(topic&&!topics.some(t=>t.id===topic.id))options.push([topic.id,topic.name+' (другой план)']);
      const choice=select(options,lesson.topicId||''),note=el('textarea',{placeholder:'Заметка к уроку'});note.value=lesson.note||'';
      body.append(field('Тема КТП',choice),field('Заметка',note),btn('Сохранить тему и заметку',()=>run(()=>S.updateLesson(lessonId,{topicId:choice.value||null,note:note.value.trim()})),'primary wide'),
        btn('Настроить виды нагрузки',()=>editTags(lesson,false,reopen),'wide'),
        btn('Конспект и подготовка урока',()=>openLessonPlanReview(lessonId,reopen),'wide'),
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
        const row=el('article',{class:'card-block lesson-session-row'+(warnings.length?' session-row-warning':''),},[el('div',{class:'session-person'},[el('span',{class:'session-number',text:st.number??'—'}),el('strong',{text:st.fullName})]),
          p((r.absent?'Отсутствует':r.present?'Присутствует':'Явка не отмечена')+' · '+(mark?.value?'Оценка '+mark.value:'Без оценки')+(covered?' · ОСВ':''))]);
        if(part)row.append(p(S.participationModes[part.mode]||'Участие записано'));
        for(const m of warnings)row.append(el('p',{class:'session-warning has-warning',text:'Ограничение: '+(S.activities().find(a=>a.id===m.restriction.activityId)?.name||'нагрузка')+' · '+(H.types[m.restriction.type]||'проверить')+(m.restriction.instruction?' · '+m.restriction.instruction:'')}));
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
