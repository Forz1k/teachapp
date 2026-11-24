/* Motion never delays an action or changes data. No animation library. */
export const motionModes={full:'Выразительные',subtle:'Сдержанные',off:'Выключены'};
const key='teachapp.motion.v1';
export function normalizeMotion(v){return Object.hasOwn(motionModes,v)?v:'full';}
export function readMotion(storage){try{return normalizeMotion((storage??globalThis.localStorage).getItem(key));}catch{return 'full';}}
export function applyMotion(value,root=document.documentElement,storage){const v=normalizeMotion(value);root.dataset.motion=v;try{(storage??globalThis.localStorage).setItem(key,v);}catch{}return v;}
export function motionAllowed(root=document.documentElement,media=globalThis.matchMedia){return root.dataset.motion!=='off'&&!(typeof media==='function'&&media.call(globalThis,'(prefers-reduced-motion: reduce)').matches);}
export function animateOnce(node,kind,options={}){if(!node||!motionAllowed(node.ownerDocument.documentElement)||typeof node.animate!=='function')return null;
 const subtle=node.ownerDocument.documentElement.dataset.motion==='subtle';
 const frames={enter:[{opacity:.55,transform:'translateY(8px)'},{opacity:1,transform:'none'}],score:[{transform:'translateY(5px) scale(.93)',opacity:.65},{transform:'scale(1.055)',opacity:1,offset:.6},{transform:'none',opacity:1}],correction:[{opacity:.55},{opacity:1}],pulse:[{transform:'scale(.97)'},{transform:'scale(1.025)'},{transform:'none'}],slide:[{opacity:.55,transform:'translateX(8px)'},{opacity:1,transform:'none'}]};
 const k=subtle&&kind!=='correction'?'correction':kind;if(!frames[k])return null;
 try{return node.animate(frames[k],{duration:subtle?120:options.duration||240,easing:'cubic-bezier(.2,.75,.25,1)',...('delay' in options&&!subtle?{delay:options.delay}:{})});}catch{return null;}}
/** Compare by stable match/set key, never animate initial snapshot, undo as correction. */
export function scoreChanges(before,after){if(!before||!after||before.id!==after.id||before.set!==after.set||!before.score||!after.score)return {};
 return Object.fromEntries(['ours','theirs'].filter(s=>Number.isFinite(before.score[s])&&Number.isFinite(after.score[s])&&before.score[s]!==after.score[s]).map(s=>[s,after.score[s]>before.score[s]?'score':'correction']));}
export function enterGroup(nodes){Array.from(nodes).slice(0,6).forEach((n,i)=>animateOnce(n,'enter',{duration:240,delay:i*24}));}
