import {el,icon} from './ui.js';
export function metric(label,value,glyph,detail=''){
 return el('div',{class:'dashboard-metric'},[el('span',{class:'metric-icon','aria-hidden':'true'},[icon(glyph)]),el('span',{class:'metric-value',text:String(value)}),el('span',{class:'metric-label',text:label}),detail?el('small',{text:detail}):null]);
}
export function actionTile(label,glyph,onclick){return el('button',{class:'dashboard-action',type:'button',onclick},[el('span',{class:'metric-icon','aria-hidden':'true'},[icon(glyph)]),el('span',{text:label}),icon('chevron')]);}
export function dashboardHeading(title,description=''){return el('div',{class:'dashboard-heading'},[el('h2',{text:title}),description?el('p',{text:description}):null]);}
export function lessonOverview(rows,held){return {total:rows.length,done:rows.filter(r=>r.lesson&&held(r.lesson)).length,next:rows.find(r=>!r.lesson||!held(r.lesson))||null};}
