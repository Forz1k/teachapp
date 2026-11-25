import {openDocuments} from './documents.js';
import {openPeriodReview,openSchoolWorkload} from './school-review.js';
import * as S from '../store.js';
import * as A from '../analytics.js';
import * as M from '../model.js';
import {periodName} from '../assessment.js';
import {matrixToDelimited,buildSummary} from '../export.js';
import * as ui from '../ui.js';
const {el}=ui;
const btn=(text,onclick,kind='')=>el('button',{type:'button',class:'btn '+kind,text,onclick});
const p=text=>el('p',{text});
const field=(text,input)=>el('label',{class:'field'},[el('span',{text}),input]);
function select(options,value){
 const node=el('select',{},options.map(([value,text])=>el('option',{value,text})));if(value!=null)node.value=value;return node;
}
const format=x=>x==null?'—':String(x);
function card(title,children){return el('section',{class:'card-block analytics-card'},[el('h2',{text:title}),...children]);}
function table(matrix){
 return el('div',{class:'analytics-table'},[el('table',{},[
  el('thead',{},[el('tr',{},matrix[0].map(x=>el('th',{text:String(x)})))]),
  el('tbody',{},matrix.slice(1).map(r=>el('tr',{},r.map(x=>el('td',{text:format(x)})))))
 ])]);
}
function printMatrix(title,matrix){
 const existing=document.getElementById('teachapp-print-report');existing?.remove();
 const node=el('div',{id:'teachapp-print-report'},[el('h1',{text:title}),table(matrix)]);
 document.body.append(node);
 const cleanup=()=>node.remove();
 window.addEventListener('afterprint',cleanup,{once:true});
 try{window.print();}catch{cleanup();ui.toast('Печать недоступна');}
}
function saveCsv(matrix,kind){try{ui.downloadBlob(new Blob([matrixToDelimited(matrix,';',true)],{type:'text/csv;charset=utf-8'}),'teachapp-'+kind+'-'+M.todayIso()+'.csv');ui.toast('Проверьте файл в загрузках');}catch{ui.toast('Не удалось скачать отчёт');}}
let pickedClass=null,pickedPeriod=null,pickedStudent='',section='overview';
export function renderAnalytics(root,ctx={}){
 root.append(el('div',{class:'topbar'},[el('div',{class:'topbar-row'},[el('h1',{text:'Аналитика'}),btn('Назад',()=>ctx.onBack?.(),'small')])]));
 const body=el('div',{class:'analytics-body'});root.append(body);
 if(!S.state.classes.length){body.append(p('Добавьте класс, чтобы открыть аналитику.'));return;}
 if(!S.state.classes.some(c=>c.id===pickedClass))pickedClass=S.state.currentClassId||S.state.classes[0].id;
 pickedPeriod=S.currentTrimester().id;
 const cls=select(S.state.classes.map(c=>[c.id,c.name]),pickedClass);
 const periods=select(S.state.settings.trimesters.map(t=>[t.id,periodName(t)+' · '+M.fmtFull(t.from)+' — '+M.fmtFull(t.to)]),pickedPeriod);
 const pupil=select([]);const content=el('div',{class:'analytics-content'});
 function pupils(){
   const students=S.studentsOfClass(pickedClass);
   if(pickedStudent&&!students.some(s=>s.id===pickedStudent))pickedStudent='';
   pupil.replaceChildren(el('option',{value:'',text:'Весь класс'}),...students.map(s=>el('option',{value:s.id,text:s.fullName})));pupil.value=pickedStudent;
 }
 function draw(){
  content.replaceChildren();
  const t=S.state.settings.trimesters.find(x=>x.id===pickedPeriod);if(!t)return;
  const a=A.schoolAnalytics(pickedClass,t.from,t.to,pickedStudent||null);
  const clsName=S.state.classes.find(c=>c.id===pickedClass)?.name||'';
  const att=a.att;
  const title='Отчёт · '+clsName+' · '+periodName(t)+' · '+M.fmtFull(t.from)+' — '+M.fmtFull(t.to);
  const sections={overview:'Оценки и посещаемость',ktp:'КТП',norms:'Нормативы',participation:'Участие',health:'Ограничения',reports:'Отчёты'};
  content.append(el('div',{class:'analytics-nav',role:'group','aria-label':'Разделы аналитики'},Object.entries(sections).map(([id,name])=>btn(name,()=>{section=id;draw();},section===id?'primary':''))));
  if(section==='overview'){
    content.append(card('Проверка периода',[btn('Мастер закрытия периода',()=>openPeriodReview(pickedClass,t.id),'primary wide'),btn('Педагогическая нагрузка',openSchoolWorkload,'wide')]),card('Фактическая посещаемость',[p('Проведено '+a.held+' из '+a.lessons+' · будущих '+att.future+' · не подтверждено '+att.unconfirmed),
      p('Явка '+format(att.pct)+(att.pct===null?'':'%')+' · присутствовали '+att.present+' · отсутствовали '+att.absent+' · без отметки '+att.unknown)]),
      card('Динамика среднего балла (не итоговые отметки)',[table([['Месяц','Средний балл','Оценок'],...a.trend.map(r=>[r.month,format(r.mean),r.count])])]),
      card('Итоговые оценки',[p('Предложение — округлённый средний балл за проведённые уроки. Итог выставляет преподаватель вручную за завершённый период. Журнал не меняется.'),
        ...a.rows.map(r=>{
          const choose=select([['','Не выставлена'],...['1','2','3','4','5'].map(x=>[x,x])],r.final||'');
          return el('div',{class:'analytics-student'},[p(r.student.fullName),p('Оценок: '+r.count+' · средний: '+format(r.mean)+' · предложение: '+format(r.suggested)+' · итог: '+format(r.final)),p('Отсутствия: '+r.att.absent+' · не отмечено: '+r.att.unknown+' · ОСВ: '+r.att.exempt),!r.count?p('Недостаточно оценок для предложения.'):null,
            field('Итоговая оценка',choose),btn('Подтвердить итог',async()=>{
              if(!await ui.confirmDialog({title:'Сохранить итоговую оценку?',text:choose.value?'Будет сохранена оценка '+choose.value+'.':'Текущая итоговая оценка будет удалена.',ok:'Подтвердить'}))return;
              try{await S.saveFinalGrade(r.student.id,t.id,choose.value||null,true);ui.toast('Итог сохранён');draw();}catch(e){ui.toast(e.message);}
            },'wide'),
            ...S.state.finalGrades.filter(x=>x.studentId===r.student.id&&(x.from!==t.from||x.to!==t.to)).map(x=>p('Архив: '+x.periodName+' ('+M.fmtFull(x.from)+' — '+M.fmtFull(x.to)+') · '+x.value))]);
        })]));
  }else if(section==='ktp'){
    content.append(card('Выполнение КТП',[p('Тем проведено по всему плану: '+a.ktp.filter(x=>x.done).length+' из '+a.ktp.length+'; проведённые уроки за выбранный период отдельно.'),
      table(A.reportMatrix('ktp',a))]));
  }else if(section==='norms'){
    content.append(card('Выполненные нормативы',[p('Только фактически внесённые результаты; отсутствие результата не является низкой оценкой.'),table(A.reportMatrix('norms',a))]));
  }else if(section==='participation'){
    content.append(card('Режимы фактического участия',[p('Суммарные записи по проведённым урокам. Без причин, справок и диагнозов.'),table(A.reportMatrix('participation',a))]));
  }else if(section==='health'){
    const h=A.healthOverview(pickedClass),up=A.upcomingLessons(pickedClass);
    content.append(card('Рабочая сводка класса',[p('Сведения указаны у '+h.withGroup+' из '+h.total+' · активные ограничения у '+h.active+' · требуется проверить сведения у '+h.review),
      p('Проверка актуальности: отсутствующая или не действующая группа, истёкшее ограничение. Это не оценка здоровья.'),
      table([['Группа','Количество'],...Object.entries(h.groups)]),p('Сводка не учитывает фильтр ученика; не включается в общую ведомость.')]),
      card('Предстоящие 14 дней',[p('Отсутствие совпадений не является допуском. Для незаполненных тем нужна проверка.'),table(A.reportMatrix('plan',a,{upcoming:up,includeWarnings:true}))]));
  }else{
    const kinds={class:'Отчёт по классу',student:'Отчёт по ученику',ktp:'Отчёт по КТП',norms:'Отчёт по нормативам',participation:'Отчёт по фактическому участию',plan:'План предстоящих уроков',journal:'Печатная ведомость журнала'};
    const kind=select(Object.entries(kinds),'class'),warnings=el('input',{type:'checkbox'}),preview=el('div',{class:'analytics-content'});
    const matrix=()=>{
      if(kind.value==='student'&&!pickedStudent)throw Error('Выберите ученика в фильтре');
      if(kind.value==='journal'){const b=buildSummary({classId:pickedClass,from:t.from,to:t.to,includeExemptions:false});return [b.header,...b.rows];}
      const data=kind.value==='class'?A.schoolAnalytics(pickedClass,t.from,t.to):a;
      return A.reportMatrix(kind.value,data,{upcoming:A.upcomingLessons(pickedClass),includeWarnings:warnings.checked});
    };
    const redraw=()=>{try{preview.replaceChildren(table(matrix()));}catch(e){preview.replaceChildren(p(e.message));}};
    kind.onchange=redraw;warnings.onchange=redraw;redraw();
    const action=fn=>{try{fn(matrix());}catch(e){ui.toast(e.message);}};
    content.append(card('Отчёты',[p('Обычные ведомости не содержат группы здоровья, ограничений, оснований освобождения или заметок. Перед передачей проверьте состав данных.'),
      field('Вид отчёта',kind),field('Включить агрегированные предупреждения в план уроков',warnings),preview,
      btn('Генератор Word / Excel',()=>openDocuments(kind.value==='ktp'?'ktp':kind.value==='norms'?'norms':'classReport'),'wide'),btn('CSV',()=>action(m=>saveCsv(m,kind.value)),'wide'),btn('Печать',()=>action(m=>printMatrix(title+' · '+kinds[kind.value],m)),'primary wide')]));
  }
 }
 cls.onchange=()=>{pickedClass=cls.value;pickedStudent='';pupils();draw();};
 periods.onchange=()=>{pickedPeriod=periods.value;S.selectSchoolPeriod(pickedPeriod);draw();};pupil.onchange=()=>{pickedStudent=pupil.value;draw();};
 pupils();body.append(card('Фильтры',[field('Класс',cls),field('Учебный период',periods),field('Ученик',pupil)]),content);draw();
}
