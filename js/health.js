import { inRange } from './model.js';

const entries = [
  ['run','Любой бег'], ['sprint','Спринт','run'], ['long','Длительный бег','run'], ['shuttle','Челночный бег','run'], ['endurance','Бег на выносливость','run'],
  ['jump','Прыжковые упражнения'], ['broad','Прыжок в длину','jump'], ['high','Прыжок в высоту','jump'], ['rope','Скакалка','jump'],
  ['strength','Силовые упражнения'], ['pull','Подтягивания','strength'], ['push','Отжимания','strength'], ['squat','Приседания','strength'], ['weight','Упражнения с отягощениями','strength'],
  ['test','Все контрольные нормативы'], ['30m','Бег 30 м (норматив)','sprint','test'], ['3x10','Челночный бег 3×10 м (норматив)','shuttle','test'],
  ['standing','Прыжок в длину с места (норматив)','broad','test'], ['pullTest','Подтягивания (норматив)','pull','test'],
  ['intense','Высокоинтенсивная нагрузка'], ['speed','Скоростная нагрузка'], ['duration','Длительная нагрузка'], ['competition','Соревнования'],
  ['flex','Гибкость'], ['games','Спортивные игры'], ['volley','Волейбол','games'], ['pass','Передача мяча','volley'], ['other','Отдельные упражнения'],
];
export const catalog = entries.map(([id,name,...parents]) => ({ id,name,parents }));
export const groups = ['Основная','Подготовительная','Специальная А','Специальная Б'];
export const types = { avoid:'Не выполнять', adapt:'Адаптировать нагрузку', no_test:'Освобождён от контрольного норматива', individual:'Индивидуальные условия' };
export const alternatives = ['Адаптированное упражнение','Теоретическое задание','Разрешённая вспомогательная деятельность','Индивидуальное задание','Не выполняет конкретное упражнение','Норматив не выполнялся по ограничению'];

export function validPeriod(from, to) {
  const valid = s => /^\d{4}-\d\d-\d\d$/.test(s) && Number.isFinite(Date.parse(s)) && new Date(s).toISOString().slice(0,10) === s;
  return valid(from) && (!to || (valid(to) && to >= from));
}
export function active(record, date) {
  return Boolean(record && record.enabled !== false && validPeriod(record.dateFrom, record.dateTo) && inRange(date, record.dateFrom, record.dateTo));
}

export function ancestorIds(tag, byId) {
  let unknown = false;
  const ancestors = new Set();
  const pending = [tag];
  while (pending.length) {
    const id = pending.pop();
    if (ancestors.has(id)) continue;
    ancestors.add(id);
    const item = byId.get(id);
    if (!item) unknown = true;
    else pending.push(...item.parents);
  }
  return {ancestors,unknown};
}

export function checkLessonRestrictions({ lesson, activities, students, restrictions, date = lesson.date }) {
  const byId = new Map(activities.map(a => [a.id,a]));
  const ids = new Set(students.filter(s => s.classId === lesson.classId).map(s => s.id));
  const tags = lesson.activitiesConfirmed === false ? [] : lesson.activityIds || [];
  let needsReview = !tags.length;
  const matches = [];
  for (const tag of new Set(tags)) {
    const {ancestors,unknown} = ancestorIds(tag,byId);
    if (unknown) needsReview = true;
    for (const restriction of restrictions) {
      if (ids.has(restriction.studentId) && active(restriction,date) && byId.has(restriction.activityId)
          && ancestors.has(restriction.activityId) && (restriction.type !== 'no_test' || ancestors.has('test') || tags.includes('test'))) {
        matches.push({ studentId: restriction.studentId, activityId: tag, restriction });
      }
    }
  }
  return { matches, needsReview };
}
