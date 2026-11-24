import {el,icon} from './ui.js';
export function metric(label,value,glyph,detail=''){
 return el('div',{class:'dashboard-metric'},[el('span',{class:'metric-icon','aria-hidden':'true'},[icon(glyph)]),el('span',{class:'metric-value',text:String(value)}),el('span',{class:'metric-label',text:label}),detail?el('small',{text:detail}):null]);
}
export function actionTile(label,glyph,onclick){return el('button',{class:'dashboard-action',type:'button',onclick},[el('span',{class:'metric-icon','aria-hidden':'true'},[icon(glyph)]),el('span',{text:label}),icon('chevron')]);}
export function dashboardHeading(title,description=''){return el('div',{class:'dashboard-heading'},[el('h2',{text:title}),description?el('p',{text:description}):null]);}
export function lessonOverview(rows,held){return {total:rows.length,done:rows.filter(r=>r.lesson&&held(r.lesson)).length,next:rows.find(r=>!r.lesson||!held(r.lesson))||null};}

export function curriculumProgress(topics,classes,lessons,held){
 const ids=new Set(topics.map(t=>t.id)),classIds=new Set(classes),done=new Set();
 for(const l of lessons)if(ids.has(l.topicId)&&classIds.has(l.classId)&&held(l))done.add(JSON.stringify([l.classId,l.topicId]));
 return {done:done.size,total:ids.size*classIds.size};
}

export function trendDomain(values,{min,max}={}){
 const valid=values.filter(Number.isFinite);
 let low=Number.isFinite(min)?min:Math.min(0,...valid),high=Number.isFinite(max)?max:Math.max(0,...valid);
 if(high<=low)high=low+1;return {low,high};
}
export function trendChart(entries,{unit='',min,max,label='Динамика'}={}){
 const rows=entries.filter(r=>Number.isFinite(r.value)),wrap=el('div',{class:'trend-chart'});
 if(!rows.length)return el('p',{class:'profile-note',text:'Нет сопоставимых записей для графика.'});
 const {low,high}=trendDomain(rows.map(r=>r.value),{min,max}),ns='http://www.w3.org/2000/svg';
 const node=(tag,props={})=>{const n=document.createElementNS(ns,tag);for(const [k,v] of Object.entries(props))n.setAttribute(k,String(v));return n;};
 const svg=node('svg',{viewBox:'0 0 320 124',role:'img','aria-label':label+' · '+rows.map(r=>r.value+' '+unit).join(', ')});
 const x=i=>rows.length===1?174:36+i*272/(rows.length-1),y=v=>104-(v-low)*88/(high-low);
 for(const v of [low,(low+high)/2,high]){
  svg.append(node('line',{x1:36,y1:y(v),x2:308,y2:y(v),class:'trend-grid'}));
  const t=node('text',{x:2,y:y(v)+4,class:'trend-tick'});t.textContent=String(Math.round(v*10)/10);svg.append(t);
 }
 if(rows.length>1)svg.append(node('polyline',{points:rows.map((r,i)=>x(i)+','+y(r.value)).join(' '),class:'trend-line',fill:'none'}));
 rows.forEach((r,i)=>svg.append(node('circle',{cx:x(i),cy:y(r.value),r:3.4,class:'trend-dot'})));
 wrap.append(svg,el('div',{class:'trend-caption'},[el('span',{text:rows[0].date||'Первая запись'}),el('span',{text:rows.at(-1).date||'Последняя запись'})]),el('small',{text:'По порядку записей · '+rows.length+' · '+(unit||'значения')}));
 return wrap;
}
