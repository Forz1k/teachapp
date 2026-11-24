import {readMotion,applyMotion} from './motion.js';
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
export function readGymMode(storage){try{return (storage??globalThis.localStorage).getItem('teachapp.gym-mode')==='1';}catch{return false;}}
export function applyGymMode(enabled,root=document.documentElement,storage){root.dataset.gymMode=enabled?'on':'off';try{(storage??globalThis.localStorage).setItem('teachapp.gym-mode',enabled?'1':'0');}catch{}return enabled;}
export function initializeDesign(root=document.documentElement,storage){applyGymMode(readGymMode(storage),root,storage);applyMotion(readMotion(storage),root,storage);return applyAccent(readAccent(storage),root,storage);}

export const schoolRoutes=['today','classes','journal','schedule','norms','analytics','settings'];
export const coachRoutes=['home','roster','trainings','matches','analytics'];
const routeKey='teachapp.design.navigation';
export function normalizeNavigation(v={}){
 return {workspace:v?.workspace==='coach'?'coach':'school',school:schoolRoutes.includes(v?.school)?v.school:'today',coach:coachRoutes.includes(v?.coach)?v.coach:'home'};
}
export function readNavigation(storage){try{return normalizeNavigation(JSON.parse((storage??globalThis.localStorage).getItem(routeKey)||'{}'));}catch{return normalizeNavigation();}}
export function saveNavigation(v,storage){const next=normalizeNavigation(v);try{(storage??globalThis.localStorage).setItem(routeKey,JSON.stringify(next));}catch{}return next;}
