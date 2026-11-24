export const accents={default:'По режиму (синий / фиолетовый)',orange:'Оранжевый'};
const key='teachapp.design.accent';
export function readAccent(storage){
 try{const value=(storage??globalThis.localStorage).getItem(key);return Object.hasOwn(accents,value)?value:'default';}catch{return 'default';}
}
export function applyAccent(value,root=document.documentElement,storage){
 const accent=Object.hasOwn(accents,value)?value:'default';
 root.dataset.accent=accent;
 try{(storage??globalThis.localStorage).setItem(key,accent);}catch{}
 return accent;
}
export function initializeDesign(root=document.documentElement,storage){return applyAccent(readAccent(storage),root,storage);}
