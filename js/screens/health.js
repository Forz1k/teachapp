import * as S from '../store.js';
import * as H from '../health.js';
import * as M from '../model.js';
import { el, openSheet, toast } from '../ui.js';
import { openParticipation } from './participation.js';

const field = (label,control) => el('label',{class:'field'},[el('span',{text:label}),control]);
const btn = (text, action) => el('button',{type:'button',class:'btn',text,onclick:async e => {
  e.stopPropagation();
  try { await action(); } catch (error) { toast(error.message); }
}});
const select = (options,value) => {
  const s = el('select',{},options.map(([value,text]) => el('option',{value,text})));
  if (value != null) s.value = value;
  return s;
};
const input = (type,value = '') => el('input',{type,value});
const dateLabel = r => r.dateTo ? 'До ' + M.fmtFull(r.dateTo) : 'Без указанного срока · проверить актуальность';
const profile = id => S.state.studentHealthProfiles.find(p => p.id === id);
const groupAt = (id,date) => H.active(profile(id),date) && profile(id).group || 'Не указана';
const nameOf = id => S.activities().find(a => a.id === id)?.name || 'Неизвестная нагрузка';
const restrictions = id => S.state.activityRestrictions.filter(r => r.studentId === id);
const expires = (r,date) => H.active(r,date) && r.dateTo && r.dateTo <= M.addDays(date,30);

function groupForm(ids, done) {
  const p = ids.length === 1 ? profile(ids[0]) : null;
  const group = select([['','Не указана'],...S.healthGroups().map(g => [g,g])],p?.group);
  const from = input('date',p?.dateFrom || M.todayIso()), to = input('date',p?.dateTo);
  const custom = input('text');
  openSheet(el('div',{},[el('h2',{text:'Медицинская группа'}),field('Группа',group),
    field('Новое обозначение группы',custom),field('С даты',from),field('По дату (необязательно)',to),
    btn('Сохранить',async () => {
      if (ids.length > 1 && !window.confirm('Подтвердить группу по имеющимся основаниям для выбранных учеников: ' + ids.length + '?')) return;
      const label = custom.value.trim() || group.value;
      if (!H.validPeriod(from.value,to.value)) throw new Error('Проверьте даты');
      if (label && !S.healthGroups().includes(label)) await S.saveSettings({healthGroups:[...S.healthGroups(),label]});
      await S.saveProfiles(ids,label,from.value,to.value); done();
    })]));
}

function restrictionForm(studentId,r = {}) {
  const activity = select(S.activities().map(a => [a.id,a.name]),r.activityId);
  const type = select(Object.entries(H.types),r.type);
  const from = input('date',r.dateFrom || M.todayIso()), to = input('date',r.dateTo);
  const note = input('text',r.instruction); note.maxLength = 160;
  const enabled = input('checkbox'); enabled.checked = r.enabled !== false;
  const instruction = field('Организационные указания без диагноза',note);
  type.onchange = () => { instruction.hidden = type.value !== 'individual'; }; type.onchange();
  openSheet(el('div',{},[el('h2',{text:'Ограничения нагрузки'}),field('Упражнение или категория',activity),
    field('Тип ограничения',type),field('Начало',from),field('Окончание (пусто — без указанного срока)',to),
    instruction,field('Применять в пределах указанных дат',enabled),btn('Подтвердить основание и сохранить',async () => {
      await S.saveRestriction({ id:r.id,studentId,activityId:activity.value,type:type.value,dateFrom:from.value,dateTo:to.value,
        instruction:note.value,enabled:enabled.checked }); openHealth(studentId);
    })]));
}

export function openHealth(id) {
  const student = S.state.students.find(s => s.id === id);
  if (!student) return;
  const today = M.todayIso(), p = profile(id);
  const sheet = el('div',{},[el('h2',{text:'Группа здоровья и ограничения'}),el('p',{text:student.fullName}),
    el('p',{text:'Медицинская группа: ' + groupAt(id,today)}),btn('Изменить группу',() => groupForm([id],() => openHealth(id)))]);
  if (p) sheet.append(el('p',{text:[p.group || 'Не указана',M.fmtFull(p.dateFrom),dateLabel(p),'Обновлено ' + M.fmtFull(p.updatedAt.slice(0,10))].join(' · ')}));
  sheet.append(btn('Ограничения нагрузки · добавить',() => restrictionForm(id)));
  for (const r of restrictions(id)) sheet.append(btn([nameOf(r.activityId),H.types[r.type],
    H.active(r,today) ? 'Действует' : 'Не действует',dateLabel(r),expires(r,today) ? 'Срок истекает' : ''].filter(Boolean).join(' · '),() => restrictionForm(id,r)));
  openSheet(sheet);
}

export function openRoster(classId) {
  const date = M.todayIso(), picked = new Set();
  const filter = select([['all','Все'],...S.healthGroups().map(g => [g,g]),['none','Без указанной группы'],
    ['restricted','С индивидуальными ограничениями'],['ending','С истекающими ограничениями']], 'all');
  const list = el('div');
  const draw = () => {
    list.replaceChildren();
    for (const s of S.studentsOfClass(classId)) {
      const rs = restrictions(s.id).filter(r => H.active(r,date)), group = groupAt(s.id,date);
      if (!(filter.value === 'all' || filter.value === group || (filter.value === 'none' && group === 'Не указана')
          || (filter.value === 'restricted' && rs.length) || (filter.value === 'ending' && rs.some(r => expires(r,date))))) continue;
      const check = input('checkbox'); check.checked = picked.has(s.id); check.setAttribute('aria-label','Выбрать ' + s.fullName);
      check.onchange = () => check.checked ? picked.add(s.id) : picked.delete(s.id);
      list.append(el('div',{class:'row-item'},[check,btn(s.fullName + (rs.length ? ' · ⚑' : ''),() => openHealth(s.id))]));
    }
  };
  filter.onchange = () => { picked.clear(); draw(); }; draw();
  openSheet(el('div',{},[el('h2',{text:'Состав класса'}),field('Фильтр',filter),list,btn('Изменить группу выбранным',() => {
    if (!picked.size) throw new Error('Выберите учеников');
    groupForm([...picked],() => openRoster(classId));
  })]));
}

/** Поиск скрывает строки, сохраняя выбранные теги. */
function tagPicker(ids) {
  const selected = new Set(ids || []);
  const search = input('search'), list = el('div');
  function draw() {
    list.replaceChildren();
    for (const a of S.activities().filter(a => a.name.toLowerCase().includes(search.value.toLowerCase()))) {
      const box = input('checkbox'); box.checked = selected.has(a.id);
      box.onchange = () => box.checked ? selected.add(a.id) : selected.delete(a.id);
      list.append(field(a.name,box));
    }
  }
  search.oninput = draw; draw();
  return { node:el('div',{},[field('Поиск нагрузки',search),list]), selected };
}
export function editTags(entity, isTopic, done) {
  const topic = S.state.topics.find(t => t.id === entity.topicId);
  const picker = tagPicker(entity.activityIds ?? topic?.activityIds);
  const save = async ids => {
    if (isTopic) await S.updateTopic(entity.id,{activityIds:ids});
    else await S.updateLesson(entity.id,{activityIds:ids});
    done();
  };
  const sheet = el('div',{},[el('h2',{text:'Виды физической нагрузки'}),picker.node,
    btn('Подтвердить теги',() => save([...picker.selected]))]);
  if (!isTopic) sheet.append(btn('Наследовать теги темы КТП',() => {
    if (entity.activityIds == null || window.confirm('Заменить индивидуальные теги урока тегами темы?')) return save(null);
  }));
  sheet.append(btn('Добавить свою категорию или упражнение',() => {
    const name = input('text'), parents = tagPicker([]);
    openSheet(el('div',{},[field('Название',name),el('p',{text:'Родительские категории'}),parents.node,
      btn('Добавить',async () => { await S.addActivity(name.value,[...parents.selected]); editTags({...entity,activityIds:[...picker.selected]},isTopic,done); })]));
  }));
  openSheet(sheet);
}

export function warning(lesson,studentId) {
  const {matches,needsReview} = S.lessonCheck(lesson);
  const rows = matches.filter(m => !studentId || m.studentId === studentId);
  const node = el('div');
  if (needsReview) node.append(el('p',{text:'Содержание нагрузки требует проверки'}));
  if (rows.length) node.append(el('p',{role:'status',text:'Ограничение нагрузки · учеников: ' + new Set(rows.map(m => m.studentId)).size}));
  node.append(btn('Проверить ограничения',() => {
    const panel = el('div',{},[el('h2',{text:'Проверка ограничений'}),el('p',{text:M.fmtFull(lesson.date)})]);
    if (needsReview) panel.append(el('p',{text:'Содержание нагрузки требует проверки'}));
    if (!needsReview && !rows.length) panel.append(el('p',{text:'По внесённым данным действующих совпадений не найдено'}));
    for (const {studentId:id,activityId,restriction:r} of rows) {
      const student = S.state.students.find(s => s.id === id);
      panel.append(el('div',{class:'card-block'},[btn(student.fullName,() => openHealth(id)),
        el('p',{text:[groupAt(id,lesson.date),nameOf(activityId),nameOf(r.activityId),H.types[r.type],r.instruction,dateLabel(r)].filter(Boolean).join(' · ')}),
        ...(lesson.id ? [btn('Зафиксировать фактическое участие',() => openParticipation(id,lesson.id,activityId))] : [])]));
    }
    openSheet(panel);
  }));
  return node;
}
export function checkGrade(lesson,id) {
  return !S.lessonCheck(lesson).matches.some(m => m.studentId === id)
    || window.confirm('Есть действующее ограничение на нагрузку урока. Вы проверили основание для выставления этой оценки?');
}

export function prepareTest(lesson) {
  const catalog = S.activities();
  const byId = new Map(catalog.map(a => [a.id,a]));
  const tests = catalog.filter(a => a.id !== 'test' && H.ancestorIds(a.id,byId).ancestors.has('test'));
  const choice = select(tests.map(a => [a.id,a.name]));
  const result = el('div');
  const draw = () => result.replaceChildren(warning({...lesson,activityIds:[choice.value]}));
  choice.onchange = draw; draw();
  openSheet(el('div',{},[el('h2',{text:'Подготовка норматива'}),field('Испытание',choice),result]));
}
