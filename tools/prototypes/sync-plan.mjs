/* Prototype only: synthetic fixtures, no network, storage, credentials or app imports. */
function canonical(value){
 if(value===null||typeof value==='string'||typeof value==='boolean')return JSON.stringify(value);
 if(typeof value==='number'&&Number.isFinite(value))return JSON.stringify(value);
 if(Array.isArray(value))return '['+value.map(canonical).join(',')+']';
 if(value&&typeof value==='object'&&Object.getPrototypeOf(value)===Object.prototype)
  return '{'+Object.keys(value).sort().map(k=>JSON.stringify(k)+':'+canonical(value[k])).join(',')+'}';
 throw Error('Expected plain JSON record');
}
function index(rows){
 if(!Array.isArray(rows))throw Error('Expected array of records');
 const result=new Map();
 for(const row of rows){
  if(!row||typeof row!=='object'||typeof row.id!=='string'||!row.id.trim()||result.has(row.id))throw Error('Missing or duplicate record ID');
  result.set(row.id,{row:structuredClone(row),key:canonical(row)});
 }
 return result;
}
const same=(a,b)=>(a?.key??null)===(b?.key??null);
const row=v=>v?.row??null;
export function planThreeWayMerge(base,local,remote){
 const b=index(base),l=index(local),r=index(remote);
 const ids=[...new Set([...b.keys(),...l.keys(),...r.keys()])].sort();
 const merged=[],conflicts=[];
 for(const id of ids){
  const before=b.get(id),left=l.get(id),right=r.get(id);
  let chosen;
  if(same(left,right))chosen=left;
  else if(same(left,before))chosen=right;
  else if(same(right,before))chosen=left;
  else{conflicts.push({id,base:row(before),local:row(left),remote:row(right)});continue;}
  if(chosen)merged.push(chosen.row);
 }
 return {candidateRecords:merged,conflicts,complete:conflicts.length===0};
}
