import * as S from '../store.js';
import * as M from '../model.js';
import * as A from '../assessment.js';
import * as ui from '../ui.js';
const {el,openSheet,toast}=ui;
const btn=(text,onclick,primary=false)=>el('button',{type:'button',class:'btn wide'+(primary?' primary':''),text,onclick});
const field=(text,input)=>el('label',{class:'field'},[text,input]);
function select(rows,value){
  const node=el('select',{},rows.map(([id,text])=>el('option',{value:id,text})));
  if(value!=null)node.value=value;return node;
}
function error(e){toast(e.message);}
function scopeLabel(r){
  return (r.classId?(S.state.classes.find(c=>c.id===r.classId)?.name||'Удалённый класс'):r.gradeLevel!=null?r.gradeLevel+' класс':'Все классы')+' · '+A.normGroups[r.group];
}
function editNorm(n={}){
  const name=el('input',{value:n.name||'',placeholder:'Например, прыжок в длину с места'});
  const activity=select(S.activities().map(a=>[a.id,a.name]),n.activityId||'30m');
  const unit=select(A.units.map(x=>[x,x]),n.unit||'с');
  const direction=select([['min','Меньше — лучше'],['max','Больше — лучше']],n.direction||'min');
  let rows=n.scales!==undefined?n.scales.map(r=>({...r,scale:[...r.scale]})):n.scale?[{classId:null,gradeLevel:null,group:'all',scale:[...n.scale]}]:[];
  const list=el('div',{class:'norm-scale-list'});
  function draw(){
    list.replaceChildren();
    for(const [i,r] of rows.entries()){
      const scopes=[['all','Все классы (общая область)'],...Array.from({length:11},(_,j)=>['g'+(j+1),(j+1)+' класс · все параллельные классы']),...S.state.classes.map(c=>['c'+c.id,c.name+' · только этот класс'])];
      if(r.classId&&!S.state.classes.some(c=>c.id===r.classId))scopes.push(['c'+r.classId,'Удалённый класс']);
      const scope=select(scopes,r.classId?'c'+r.classId:r.gradeLevel!=null?'g'+r.gradeLevel:'all');
      const group=select(Object.entries(A.normGroups).map(([v,t])=>[v,t]),r.group);
      scope.onchange=()=>{r.classId=scope.value.startsWith('c')?scope.value.slice(1):null;r.gradeLevel=scope.value.startsWith('g')?Number(scope.value.slice(1)):null;};
      group.onchange=()=>r.group=group.value;
      const inputs=r.scale.map((v,j)=>{
        const node=el('input',{type:'number',min:0,step:'any',value:v??'',placeholder:'—','aria-label':'Шкала '+(i+1)+', оценка '+(j+1)});
        node.oninput=()=>r.scale[j]=node.value.trim()===''?null:Number(node.value);
        return field(String(j+1),node);
      });
      list.append(el('section',{class:'card-block norm-scale'},[el('h3',{text:'Шкала '+(i+1)}),field('Для кого',scope),field('Категория',group),el('div',{class:'norm-scale-values'},inputs),
        btn('Копировать шкалу',()=>{rows.splice(i+1,0,{...r,scale:[...r.scale]});draw();}),
        btn('Удалить шкалу',()=>{rows.splice(i,1);draw();})]));
    }
  }
  draw();
  const add=btn('+ Добавить шкалу',()=>{
    const cls=S.state.classes.find(c=>c.id===S.state.currentClassId);
    rows.push({classId:null,gradeLevel:A.gradeLevelOf(cls)||7,group:'boys',scale:Array(5).fill(null)});draw();
  });
  openSheet(el('div',{class:'norm-editor'},[el('h2',{text:n.id?'Редактировать норматив':'Новый норматив'}),field('Название',name),field('Вид нагрузки',activity),field('Единица',unit),field('Направление',direction),
    el('p',{text:'Задайте свои пороги для оценок 1–5. Одна шкала на категорию и область. Конкретный класс имеет приоритет над параллелью. При отсутствии подходящей шкалы результат сохраняется без оценки.'}),
    ...(n.scale&&!n.scales?[el('p',{text:'Прежняя общая шкала перенесена в черновик. Удалите её, если она не должна применяться к другим классам.'})]:[]),
    list,add,btn('Сохранить',async()=>{
      try{
        if(!rows.length)throw Error('Добавьте хотя бы одну шкалу');
        if(rows.some(r=>r.scale.some(v=>v===null)))throw Error('Заполните все пять порогов каждой шкалы');
        await S.saveNorm({id:n.id,name:name.value,activityId:activity.value,unit:unit.value,direction:direction.value,scales:rows});
        ui.closeSheet();toast('Норматив сохранён');
      }catch(e){error(e);}
    },true)]));
}
function choosePupil(norm){
  const classes=S.state.classes;if(!classes.length)return toast('Сначала добавьте класс');
  const cls=select(classes.map(c=>[c.id,c.name]),S.state.currentClassId||classes[0].id),pupil=select([]),lesson=select([]);
  function draw(){
    pupil.replaceChildren(...S.studentsOfClass(cls.value).map(s=>el('option',{value:s.id,text:s.fullName})));
    lesson.replaceChildren(...S.lessonsOfClass(cls.value).filter(l=>l.date<=M.todayIso()).reverse().map(l=>el('option',{value:l.id,text:M.fmtFull(l.date)})));
  }
  cls.onchange=draw;draw();
  openSheet(el('div',{},[el('h2',{text:norm.name}),field('Класс',cls),field('Ученик',pupil),field('Урок',lesson),
    btn('Проверить ограничения и открыть результат',()=>{if(!pupil.value||!lesson.value)return toast('Выберите ученика и существующий урок');enterResult(norm,pupil.value,lesson.value);},true)]));
}
function enterResult(norm,studentId,lessonId){
  const lesson=S.state.lessons.find(l=>l.id===lessonId),student=S.state.students.find(s=>s.id===studentId);
  if(!student||!lesson)return toast('Ученик или урок не найден');
  const cls=S.state.classes.find(c=>c.id===student.classId),selectedScale=A.selectNormScale(norm,cls,student);
  const matches=S.normCheck(norm,lesson,studentId),mark=S.markMap(lesson.classId).get(lessonId+'|'+studentId),full=S.activeExemption(studentId,lesson.date)||M.hasOsv(mark);
  const blocked=full||mark?.flag==='Н'||matches.some(m=>['avoid','no_test'].includes(m.restriction.type));
  const panel=el('div',{},[el('h2',{text:norm.name}),el('p',{text:student.fullName+' · '+M.fmtFull(lesson.date)}),
    el('p',{text:matches.length?'Внимание: есть действующие ограничения.':'По внесённым сведениям совпадений нет. Это не подтверждение медицинского допуска.'})]);
  for(const m of matches)panel.append(el('p',{text:(S.activities().find(a=>a.id===m.restriction.activityId)?.name||'Нагрузка')+' · '+({avoid:'Не выполнять',no_test:'Освобождение от норматива',adapt:'Адаптация нагрузки',individual:'Индивидуальные условия'}[m.restriction.type]||'Ограничение')+' · '+(m.restriction.instruction||'')}));
  panel.append(el('p',{text:'Класс: '+(cls?.name||'—')+' · категория: '+(A.normGroups[student.normGroup]||'Не указана')}),
    el('p',{text:selectedScale?'Шкала: '+selectedScale.label+' · пороги 1–5: '+selectedScale.scale.join(' / '):'Подходящая шкала не найдена. Результат можно сохранить без оценки.'}));
  if(!student.normGroup){
    const category=select([['','Не указана'],['boys','Мальчики'],['girls','Девочки']],'');
    panel.append(field('Указать категорию для нормативов',category),btn('Сохранить категорию ученика',async()=>{
      if(!category.value)return toast('Выберите категорию');
      try{await S.saveNormGroups(student.classId,{[student.id]:category.value});enterResult(norm,studentId,lessonId);}catch(e){error(e);}
    }));
  }
  if(full)panel.append(el('p',{text:'Есть ОСВ или действующее освобождение.'}));
  if(mark?.flag==='Н')panel.append(el('p',{text:'Отмечено отсутствие.'}));
  let busy=false;
  const save=async(status,value,basis)=>{
    if(busy)return;busy=true;
    try{await S.saveNormResult({normId:norm.id,studentId,lessonId,status,value,basis});ui.closeSheet();toast('Результат сохранён');}catch(e){error(e);}finally{busy=false;}
  };
  if(matches.length||full)panel.append(btn('Не выполнялся по ограничению',()=>save('restricted',null,'')));
  if(!blocked){
    const basis=el('textarea',{placeholder:'Подтверждённое основание допуска (без диагноза)'}),value=el('input',{type:'number',min:0,step:'any',placeholder:norm.unit}),estimate=el('p',{role:'status'});
    value.oninput=()=>{try{estimate.textContent=value.value===''?'':'Предлагаемая оценка: '+(selectedScale?A.gradeNorm({...norm,scale:selectedScale.scale},Number(value.value))||'вне шкалы':'нет подходящей шкалы');}catch{estimate.textContent='Проверьте значение';}};
    if(matches.length)panel.append(field('Основание допуска',basis));
    panel.append(field('Результат ('+norm.unit+')',value),estimate,btn(selectedScale?'Сохранить результат':'Сохранить без оценки',async()=>{if(value.value==='')return toast('Введите результат');if(!selectedScale&&!await ui.confirmDialog({title:'Сохранить без оценки?',text:'Подходящая шкала не задана. Результат останется без оценки даже после изменения шкал.',ok:'Сохранить'}))return;save('done',Number(value.value),basis.value);},true));
  }else panel.append(el('p',{text:'Обычная сдача недоступна. Отрицательная оценка и полное ОСВ автоматически не создаются.'}));
  panel.append(btn('Назад',()=>choosePupil(norm)));openSheet(panel);
}
function history(norm){
  const rows=S.state.normResults.filter(r=>r.normId===norm.id).sort((a,b)=>b.date.localeCompare(a.date)||b.createdAt.localeCompare(a.createdAt));
  const panel=el('div',{},[el('h2',{text:'История · '+norm.name})]);
  const filter=select([['','Все ученики'],...S.state.students.filter(s=>rows.some(r=>r.studentId===s.id)).map(s=>[s.id,s.fullName])]),list=el('div');
  function draw(){
    list.replaceChildren();
    const selected=rows.filter(r=>!filter.value||r.studentId===filter.value);
    if(!selected.length)list.append(el('p',{text:'Пока нет результатов'}));
    for(const r of selected){
      const st=S.state.students.find(s=>s.id===r.studentId);
      const previous=selected.find(x=>x.studentId===r.studentId&&x.status==='done'&&x.definition.unit===r.definition.unit&&x.definition.activityId===r.definition.activityId&&x.date<r.date);
      const delta=r.status==='done'&&previous?' · изменение: '+Number((r.value-previous.value).toFixed(3))+' '+r.definition.unit:'';
      const row=el('div',{class:'card-block'},[el('p',{text:(st?.fullName||'Ученик')+' · '+M.fmtFull(r.date)}),
        el('p',{text:r.status==='restricted'?'Не выполнялся по ограничению':r.value+' '+r.definition.unit+' · оценка: '+(r.grade||'—')+delta})]);
      row.append(el('p',{text:'Шкала на дату сдачи: '+(r.definition.scaleScope?.label||(r.definition.scale?'Прежняя общая':'Не выбрана'))+(r.definition.scale?' · '+r.definition.scale.join(' / '):'')}));
      if(r.grade)row.append(btn('Перенести оценку в журнал',async()=>{
        if(!await ui.confirmDialog({title:'Перенести оценку?',text:'В журнал будет добавлена оценка '+r.grade+'. Существующие отметки не заменяются.',ok:'Перенести'}))return;
        try{await S.transferNormGrade(r.id,true);toast('Оценка внесена в журнал');}catch(e){error(e);}
      }));
      row.append(btn('Удалить результат',async()=>{
        if(!await ui.confirmDialog({title:'Удалить результат?',text:'Уже перенесённые оценки в журнале не меняются.',ok:'Удалить',danger:true}))return;
        try{await S.deleteNormResult(r.id);history(norm);}catch(e){error(e);}
      }));list.append(row);
    }
  }
  filter.onchange=draw;draw();panel.append(field('Ученик',filter),list);openSheet(panel);
}
export function renderNorms(root){
  root.append(el('div',{class:'topbar'},[el('div',{class:'topbar-row'},[el('h1',{text:'Нормативы'})])]));
  const body=el('div',{class:'norm-list'},[btn('+ Новый норматив',()=>editNorm(),true)]);
  if(!S.state.norms.length)body.append(el('p',{text:'Создайте норматив: бег, челночный бег, прыжки, подтягивания, отжимания, гибкость или своё упражнение. Пороги задаёт учитель.'}));
  for(const n of S.state.norms)body.append(el('article',{class:'card-block'},[el('h2',{text:n.name}),el('p',{text:n.unit+' · '+(n.direction==='min'?'меньше — лучше':'больше — лучше')+' · '+(n.scales!==undefined?n.scales.length+' шкал':n.scale.join(' / '))}),
    ...(n.scales||[]).map(r=>el('p',{text:scopeLabel(r)+' · '+r.scale.join(' / ')})),btn('Внести результат',()=>choosePupil(n),true),btn('История и динамика',()=>history(n)),btn('Редактировать шкалу',()=>editNorm(n))]));
  root.append(body);
}
