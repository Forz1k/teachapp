import * as S from '../store.js';
import * as W from '../workbench.js';
import {fmtFull} from '../model.js';
import {el,openSheet,closeSheet,toast,confirmDialog} from '../ui.js';
const sources={manual:'Ручная запись',weight:'Вес оценки',norm:'Перенос норматива',batch:'Массовый ввод',final:'Итоговая отметка',undo:'Отмена'};
const format=s=>s.value===null?'—':s.value+(s.weight===2?' (вес 2)':'');
const btn=(text,onclick,kind='')=>el('button',{class:'btn wide '+kind,type:'button',text,onclick});
export async function openGradeHistory(studentId,filter={},back=closeSheet){
 async function draw(){try{
  const student=S.state.students.find(s=>s.id===studentId);
  if(!student)return toast('Ученик недоступен');
  const rows=(await W.listWork('gradeHistory')).filter(r=>r.studentId===studentId&&(!filter.lessonId||r.lessonId===filter.lessonId)&&(!filter.from||r.from===filter.from&&r.to===filter.to)).sort((a,b)=>b.events.at(-1).at.localeCompare(a.events.at(-1).at));
  const body=el('div',{class:'coach-form'},[el('h2',{text:'История оценок'}),el('p',{text:student.fullName}),el('p',{text:'История ведётся с версии 3.8.0: до 200 изменений каждой оценки. Не включает медицинские основания. Отменить можно только последнее изменение, если текущая запись совпадает. При изменении участия используйте обычный журнал.'})]);
  for(const r of rows){
   const lesson=S.state.lessons.find(l=>l.id===r.lessonId),title=r.scope==='final'?r.periodName+' · '+fmtFull(r.from)+' — '+fmtFull(r.to):lesson?fmtFull(lesson.date):'Урок недоступен';
   const last=r.events.at(-1);
   const undo=btn('Отменить последнее изменение',async()=>{try{
    if(!await confirmDialog({title:'Вернуть предыдущую оценку?',text:format(last.after)+' → '+format(last.before)+'. Операция будет записана в историю.',ok:'Вернуть',danger:true}))return;
    undo.disabled=true;if(r.scope==='final')await S.undoFinalHistory(studentId,r.from,r.to,last.id,true);else await S.undoGradeHistory(studentId,r.lessonId,last.id,true);await draw();
   }catch(e){toast(e.message);}finally{undo.disabled=false;}});
   body.append(el('section',{class:'card-block coach-card'},[el('h3',{text:title}),el('p',{text:format(last.before)+' → '+format(last.after)+' · '+sources[last.source]}),el('details',{},[el('summary',{text:'Изменений: '+r.events.length}),...r.events.slice().reverse().map(e=>el('p',{text:new Date(e.at).toLocaleString('ru-RU')+' · '+format(e.before)+' → '+format(e.after)+' · '+sources[e.source]}))]),r.scope==='final'||lesson?undo:null]));
  }
  if(!rows.length)body.append(el('p',{text:'Изменений после введения истории пока нет.'}));
  body.append(btn('Назад',back));openSheet(body);
 }catch(e){toast(e.message);}}
 await draw();
}
