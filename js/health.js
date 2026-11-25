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
  const reviewReasons=[];
  if(lesson.activitiesConfirmed===false)reviewReasons.push('Виды нагрузки ещё не подтверждены');
  else if(!tags.length)reviewReasons.push('Не указаны виды нагрузки урока или темы КТП');
  const matches = [], potentialMatches = [];
  const tagSet = new Set(tags);
  const relevant = restrictions.filter(r => ids.has(r.studentId) && active(r,date));
  const graph = new Map([...byId.keys()].map(id => [id,ancestorIds(id,byId)]));
  for (const tag of tagSet) {
    const {ancestors,unknown} = ancestorIds(tag,byId);
    if (unknown) {needsReview = true;reviewReasons.push('Неизвестный или недоступный вид нагрузки: '+String(tag));}
    for (const restriction of relevant) {
      const target = graph.get(restriction.activityId);
      if (!target || (restriction.type === 'no_test' && !ancestors.has('test') && !tagSet.has('test'))) continue;
      const item = { studentId: restriction.studentId, activityId: tag, restriction };
      if (ancestors.has(restriction.activityId)) matches.push(item);
      // A broad category is not evidence that its specific descendant is planned.
      // "test" alongside an exercise denotes assessment, not every possible test.
      else if (target.ancestors.has(tag) && !(tag === 'test' && tagSet.size > 1)) {
        potentialMatches.push({...item,potential:true});
      }
    }
  }
  const unresolved = potentialMatches.filter(p => !matches.some(m => m.restriction === p.restriction));
  if (unresolved.length) {
    needsReview = true;
    reviewReasons.push('Уточните конкретные упражнения: возможны ограничения внутри общей категории нагрузки');
  }
  return { matches, potentialMatches:unresolved, needsReview, reviewReasons:[...new Set(reviewReasons)] };
}


/** Suggestions only: the teacher must confirm actual load before saving. */
export function suggestActivityIds(title){
  const name=String(title??'').toLocaleLowerCase('ru').replace(/ё/g,'е');
  const tags=new Set(),add=id=>tags.add(id);
  const norm=/норматив|контрольн[а-я]* (?:испытан|упражнен)|сдача/.test(name);
  if(/челночн/.test(name)){add('shuttle');if(norm&&/3\s*[xх×*]\s*10/.test(name))add('3x10');}
  else if(/бег|спринт|кросс/.test(name)){
    if(/спринт|(?:30|60|100)\s*м(?:етр|[ .),]|$)|коротк[а-я]* дистанц/.test(name)){add('sprint');if(norm&&/30\s*м(?:етр|[ .),]|$)/.test(name))add('30m');}
    else if(/кросс|длительн|выносливост|(?:1000|1500|2000|3000)\s*м/.test(name))add('long');
    else add('run');
  }
  if(/прыж[а-я]* в длину/.test(name)){add('broad');if(norm&&/с места/.test(name))add('standing');}
  else if(/прыж[а-я]* в высоту/.test(name))add('high');
  else if(/прыж|скакалк/.test(name))add(/скакалк/.test(name)?'rope':'jump');
  if(/подтягиван/.test(name)){add('pull');if(norm)add('pullTest');}
  if(/отжиман/.test(name))add('push');
  if(/приседан/.test(name))add('squat');
  if(/отягощен/.test(name))add('weight');
  if(/гибкост|растяжк/.test(name))add('flex');
  if(/волейбол/.test(name))add('volley');
  if(/спортивн[а-я]* игр|баскетбол|футбол|гандбол/.test(name))add('games');
  if(/соревнован/.test(name))add('competition');
  if(norm)add('test');
  return [...tags];
}
