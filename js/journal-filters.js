export const lessonFilterLabels={all:'Все уроки',held:'Проведённые',pending:'Не подтверждённые',future:'Будущие',today:'Сегодня',unthemed:'Без темы'};
export function filterJournalLessons(lessons,{status='all',from='',to='',query=''}={}, {today,topics=new Map(),held=l=>!!l.held}={}){
 const q=String(query).trim().toLocaleLowerCase('ru');
 if(from&&to&&from>to)return [];
 return lessons.filter(l=>(!from||l.date>=from)&&(!to||l.date<=to)&&(!q||String(topics.get(l.topicId)?.name||'').toLocaleLowerCase('ru').includes(q))&&(
 status==='all'||status==='today'&&l.date===today||status==='future'&&l.date>today||status==='unthemed'&&!l.topicId||status==='held'&&l.date<=today&&held(l)||status==='pending'&&l.date<=today&&!held(l)));
}
export function periodMarks(lessons,marks,studentId){let sum=0,count=0;for(const l of lessons){const mark=marks.get(l.id+'|'+studentId);if(mark?.value){sum+=Number(mark.value);count++;}}return count?sum/count:null;}

export const journalDensityLabels={standard:'Стандартно',compact:'Компактно',comfortable:'Крупно'};
const densityKey='teachapp.journal.density';
export function readJournalDensity(storage){try{const value=(storage??globalThis.localStorage).getItem(densityKey);return Object.hasOwn(journalDensityLabels,value)?value:'standard';}catch{return 'standard';}}
export function saveJournalDensity(value,storage=globalThis.localStorage){if(!Object.hasOwn(journalDensityLabels,value))throw Error('Некорректный масштаб журнала');storage.setItem(densityKey,value);if(readJournalDensity(storage)!==value)throw Error('Не удалось сохранить масштаб');return value;}
