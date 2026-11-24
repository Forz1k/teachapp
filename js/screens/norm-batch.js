import * as S from '../store.js';
import * as A from '../assessment.js';
import * as M from '../model.js';
import * as ui from '../ui.js';
import {headers,parseNormRows,planNormImport} from '../norm-import.js';
const {el,openSheet,toast}=ui;
const btn=(text,onclick,primary=false)=>el('button',{type:'button',class:'btn wide'+(primary?' primary':''),text,onclick});
const field=(text,input)=>el('label',{class:'field'},[el('span',{text}),input]);
const select=(options)=>el('select',{},options.map(([value,text])=>el('option',{value,text})));
const p=text=>el('p',{text});
function xlsx(){if(!window.XLSX)throw Error('Модуль Excel не загружен');return window.XLSX;}
function template(){
  try{
    const X=xlsx(),wb=X.utils.book_new();
    const sheet=X.utils.aoa_to_sheet([headers]);sheet['!cols']=headers.map((h,i)=>({wch:i<6?25:9}));
    X.utils.book_append_sheet(wb,sheet,'Шкалы');
    X.utils.book_append_sheet(wb,X.utils.aoa_to_sheet([['Код','Вид нагрузки'],...S.activities().map(a=>[a.id,a.name])]),'Нагрузки');
    X.utils.book_append_sheet(wb,X.utils.aoa_to_sheet([['Поле','Допустимые значения'],['Единица',A.units.join(', ')],['Направление','меньше / больше'],['Параллель / класс','1–11, точное название класса или Все'],['Категория','мальчики / девочки / общая'],['1–5','Числовые пороги; для «больше» по возрастанию, для «меньше» по убыванию']]),'Инструкция');
    ui.downloadBlob(new Blob([X.write(wb,{bookType:'xlsx',type:'array'})],{type:'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'}),'teachapp-нормативы.xlsx');
  }catch(e){toast(e.message);}
}
export function openNormImport(){
  const file=el('input',{type:'file',accept:'.xlsx,.csv,.tsv'}),replace=el('input',{type:'checkbox'}),preview=el('div',{class:'norm-scale-list','aria-live':'polite'});
  let parsed=null,busy=false,serial=0;
  const apply=btn('Импортировать',async()=>{
    if(busy||!parsed)return;
    const plan=planNormImport(parsed.rows,S.state.norms,S.activities(),{replace:replace.checked});
    if(parsed.errors.length||plan.errors.length||!plan.records.length)return;
    if(!await ui.confirmDialog({title:'Импортировать шкалы?',text:'Новых нормативов: '+plan.counts.created+'; добавлено шкал: '+plan.counts.added+'; заменено: '+plan.counts.replaced+'. Исторические результаты не изменятся.',ok:'Импортировать'}))return;
    busy=true;apply.disabled=true;
    try{await S.importNormScales(parsed.rows,{replace:replace.checked,confirmed:true,expected:plan.counts});ui.closeSheet();toast('Шкалы импортированы');}catch(e){toast(e.message);draw();}finally{busy=false;}
  },true);
  function draw(){
    apply.disabled=true;preview.replaceChildren();
    if(!parsed)return;
    const plan=planNormImport(parsed.rows,S.state.norms,S.activities(),{replace:replace.checked}),errors=[...parsed.errors,...plan.errors];
    preview.append(p('Новых нормативов: '+plan.counts.created+' · новых шкал: '+plan.counts.added+' · замен: '+plan.counts.replaced+' · без изменений: '+plan.counts.unchanged));
    for(const err of errors.slice(0,30))preview.append(p(err));
    if(errors.length>30)preview.append(p('Ещё ошибок: '+(errors.length-30)));
    if(errors.length)preview.append(p('Исправьте ошибки. Ничего не будет записано частично.'));
    for(const {norm} of parsed.rows.slice(0,12)){const r=norm.scales[0];preview.append(p(norm.name+' · '+(r.classId?S.state.classes.find(c=>c.id===r.classId)?.name:r.gradeLevel??'Все')+' · '+A.normGroups[r.group]+' · '+r.scale.join(' / ')));}
    if(parsed.rows.length>12)preview.append(p('Ещё строк: '+(parsed.rows.length-12)));
    apply.disabled=!!errors.length||!plan.records.length;
  }
  replace.onchange=draw;
  file.onchange=async()=>{
    const seq=++serial,selected=file.files?.[0];parsed=null;draw();if(!selected)return;
    try{
      if(selected.size>10*1024*1024)throw Error('Файл больше 10 МБ');
      const X=xlsx(),buffer=await selected.arrayBuffer();
      const wb=/\.(csv|tsv)$/i.test(selected.name)?X.read(new TextDecoder().decode(buffer),{type:'string',raw:true}):X.read(buffer,{type:'array'});
      const sheet=wb.Sheets['Шкалы']||wb.Sheets[wb.SheetNames[0]];
      if(!sheet)throw Error('Нет листа со шкалами');
      const range=X.utils.decode_range(sheet['!ref']||'A1');if(range.e.r>5000||range.e.c>100)throw Error('Слишком большой лист');
      const result=parseNormRows(X.utils.sheet_to_json(sheet,{header:1,defval:'',blankrows:true}),S.activities(),S.state.classes);
      if(seq!==serial)return;parsed=result;draw();
    }catch(e){if(seq===serial)preview.replaceChildren(p(e.message));}
  };
  apply.disabled=true;
  openSheet(el('div',{class:'norm-editor'},[el('h2',{text:'Импорт нормативов'}),p('Скачайте шаблон, заполните одну строку для каждой параллели и категории. Пороги задаёт преподаватель; готовых официальных значений нет.'),btn('Скачать шаблон Excel',template),field('Файл XLSX / CSV / TSV',file),field('Разрешить замену существующих шкал',replace),preview,apply]));
}
export function openNormBatch(norm){
  if(!S.state.classes.length)return toast('Сначала добавьте класс');
  const cls=select(S.state.classes.map(c=>[c.id,c.name])),lesson=select([]);
  cls.value=S.state.currentClassId||S.state.classes[0].id;
  function draw(){lesson.replaceChildren(...S.lessonsOfClass(cls.value).filter(l=>l.date<=M.todayIso()).reverse().map(l=>el('option',{value:l.id,text:M.fmtFull(l.date)})));}
  cls.onchange=draw;draw();
  openSheet(el('div',{},[el('h2',{text:norm.name+' · весь класс'}),field('Класс',cls),field('Урок',lesson),btn('Открыть ведомость результатов',()=>{
    if(!lesson.value)return toast('Выберите существующий урок');batchTable(norm,cls.value,lesson.value);
  },true)]));
}
export function batchTable(norm,classId,lessonId,onReturn){
  const lesson=S.state.lessons.find(l=>l.id===lessonId),cls=S.state.classes.find(c=>c.id===classId);
  if(!lesson||!cls)return toast('Урок или класс недоступен');
  const students=S.studentsOfClass(classId),marks=S.markMap(classId),entries=new Map(),invalid=new Set(),list=el('div',{class:'norm-scale-list'}),count=el('p',{role:'status'});
  const existing=new Map(S.state.normResults.filter(r=>r.normId===norm.id&&r.lessonId===lessonId).map(r=>[r.studentId,r]));
  const update=()=>count.textContent='К сохранению: '+entries.size+(invalid.size?' · исправьте строк: '+invalid.size:'');
  for(const st of students){
    const scope=A.selectNormScale(norm,cls,st),matches=S.normCheck(norm,lesson,st.id),mark=marks.get(lessonId+'|'+st.id),full=S.activeExemption(st.id,lesson.date)||M.hasOsv(mark);
    const part=S.state.participation.find(p=>p.studentId===st.id&&p.lessonId===lessonId);
    const blocked=full||mark?.flag==='Н'||part?.mode==='paused'||matches.some(m=>['avoid','no_test'].includes(m.restriction.type));
    const row=el('div',{class:'card-block norm-batch-row'},[el('strong',{text:st.fullName}),p(scope?scope.label:'Нет подходящей шкалы')]);
    if(existing.has(st.id)){
      const r=existing.get(st.id);row.append(p('Уже записано: '+(r.status==='restricted'?'Не выполнялся по ограничению':r.value+' '+r.definition.unit+' · '+(r.grade||'без оценки'))));list.append(row);continue;
    }
    const result=el('input',{type:'number',inputmode:'decimal',min:0,step:'any',placeholder:norm.unit,'aria-label':'Результат: '+st.fullName}),estimate=p('');
    const basis=el('input',{placeholder:'Подтверждённое основание (без диагноза)'}),skip=el('input',{type:'checkbox'});
    function recalc(){
      entries.delete(st.id);invalid.delete(st.id);estimate.textContent='';
      if(skip.checked){entries.set(st.id,{studentId:st.id,status:'restricted'});estimate.textContent='Не выполнялся';}
      else if(!blocked&&(result.value.trim()!==''||result.validity.badInput)){
        try{if(result.validity.badInput)throw Error('Введите корректный результат');if((matches.length||part?.mode==='adapted')&&!basis.value.trim())throw Error('Укажите подтверждённое основание');const value=Number(result.value),grade=A.gradeNorm({direction:norm.direction,scale:scope?.scale??null},value);
          entries.set(st.id,{studentId:st.id,status:'done',value,basis:basis.value});estimate.textContent=grade?'Оценка '+grade:'Без оценки';
        }catch(e){invalid.add(st.id);estimate.textContent=e.message;}
      }
      update();
    }
    result.oninput=basis.oninput=recalc;skip.onchange=()=>{result.disabled=skip.checked;basis.disabled=skip.checked;recalc();};
    if(mark?.flag==='Н')row.append(p('Отсутствует'));
    if(full)row.append(p('Освобождение / ОСВ'));
    if(part?.mode==='paused')row.append(p('По записи участия упражнения не выполнялись'));
    for(const m of matches)row.append(p('Ограничение: '+(S.activities().find(a=>a.id===m.restriction.activityId)?.name||'нагрузка')+' · '+m.restriction.type+' · '+(m.restriction.instruction||'')));
    if((matches.length||full)&&mark?.flag!=='Н')row.append(field('Не выполнялся по ограничению',skip));
    if(!blocked){row.append(field('Результат ('+norm.unit+')',result));if(matches.length||part?.mode==='adapted')row.append(field('Основание допуска',basis));}
    row.append(estimate);list.append(row);
  }
  update();let busy=false;
  const save=btn('Сохранить заполненные строки',async()=>{
    if(busy)return;
    if(invalid.size)return toast('Исправьте все заполненные строки перед сохранением');
    if(!entries.size)return toast('Нет заполненных строк');
    const draft=[...entries.values()];
    if(!await ui.confirmDialog({title:'Сохранить результаты?',text:'Записей: '+draft.length+'. Пустые строки пропускаются. Отметки журнала не изменяются. Без подходящей шкалы — без оценки.',ok:'Сохранить'}))return;
    busy=true;save.disabled=true;
    try{const records=await S.saveNormResultsBatch(norm.id,lessonId,draft,true);toast('Сохранено: '+records.length);batchTable(norm,classId,lessonId,onReturn);}catch(e){toast(e.message);}finally{busy=false;save.disabled=false;}
  },true);
  openSheet(el('div',{class:'norm-editor'},[el('h2',{text:norm.name+' · '+cls.name}),p(M.fmtFull(lesson.date)),p('Проверка ограничений по внесённым сведениям не является медицинским допуском. Уже внесённые результаты защищены от повторной записи.'),list,count,save,btn(onReturn?'Вернуться к уроку':'Назад',onReturn||(()=>openNormBatch(norm)))]));
}
