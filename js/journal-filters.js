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

/** Paste a rectangular TSV block into visible, explicitly ordered journal rows/columns. */
export function planJournalPaste(text,students,lessons,{studentId,lessonId}={}){
 if(typeof text!=='string'||text.length>20000)throw Error('Вставьте блок до 20 000 символов');
 const startRow=students.findIndex(s=>s.id===studentId),startCol=lessons.findIndex(l=>l.id===lessonId);
 if(startRow<0||startCol<0)throw Error('Выберите начальную ячейку');
 const rows=text.replace(/\r\n|\r/g,'\n').replace(/\n$/,'').split('\n').map(r=>r.split('\t'));
 const width=rows[0]?.length??0;if(!width||rows.some(r=>r.length!==width))throw Error('Вставьте прямоугольный блок из таблицы');
 if(rows.length*width>500||startRow+rows.length>students.length||startCol+width>lessons.length)throw Error('Блок выходит за видимые границы журнала или превышает 500 ячеек');
 const entries=[];for(let i=0;i<rows.length;i++)for(let j=0;j<width;j++){const value=rows[i][j].trim();if(!value)continue;if(!['1','2','3','4','5','Н'].includes(value))throw Error('Строка '+(i+1)+', столбец '+(j+1)+': допустимы 1–5, Н или пусто');const s=students[startRow+i],l=lessons[startCol+j];entries.push({studentId:s.id,studentName:s.fullName,lessonId:l.id,date:l.date,slot:l.slot??null,time:l.time||'',value});}
 if(!entries.length)throw Error('В блоке нет отметок');return {entries,rows:rows.length,columns:width};
}


/** Coordinates refer to visible rows and lesson columns only (never totals). */
export function journalNavigation(row,col,rows,cols,key,whole=false){
 if(![row,col,rows,cols].every(Number.isSafeInteger)||rows<1||cols<1||row<0||row>=rows||col<0||col>=cols)return null;
 let r=row,c=col;
 switch(key){
  case 'ArrowLeft':c=Math.max(0,c-1);break;
  case 'ArrowRight':c=Math.min(cols-1,c+1);break;
  case 'ArrowUp':r=Math.max(0,r-1);break;
  case 'ArrowDown':r=Math.min(rows-1,r+1);break;
  case 'Home':c=0;if(whole)r=0;break;
  case 'End':c=cols-1;if(whole)r=rows-1;break;
  default:return null;
 }
 return {row:r,col:c};
}
export function journalRectangle(a,b,rows,cols){
 if(![a,b].every(p=>p&&[p.row,p.col].every(Number.isSafeInteger)&&p.row>=0&&p.row<rows&&p.col>=0&&p.col<cols)||!Number.isSafeInteger(rows)||!Number.isSafeInteger(cols))throw Error('Выберите видимые ячейки');
 const top=Math.min(a.row,b.row),bottom=Math.max(a.row,b.row),left=Math.min(a.col,b.col),right=Math.max(a.col,b.col);
 if((bottom-top+1)*(right-left+1)>500)throw Error('Не более 500 ячеек');
 const result=[];for(let row=top;row<=bottom;row++)for(let col=left;col<=right;col++)result.push({row,col});return result;
}
