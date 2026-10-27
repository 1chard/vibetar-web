import { translate as tr } from './i18n.mjs';
export function decodePreview(data){
  let p=ArrayBuffer.isView(data)?new Uint8Array(data.buffer,data.byteOffset,data.byteLength):new Uint8Array(data);
  if(p.length===25&&p[0]===33)p=p.subarray(1);
  if(p.length!==24||String.fromCharCode(...p.subarray(0,4))!=='XCST'||p[4]!==1||p[5]>1||p[6]>1||p[7]>2||(p[9]&~7)||(p[10]&~3)||(p[11]&~31)||![0,23,75,121,171,224].includes(p[14])||p[15]||p.subarray(20).some(x=>x))throw new Error(tr("errors.previewReport"));
  if(!p[6]&&p.subarray(8,15).some(x=>x))throw new Error(tr("errors.previewStale"));
  const v=new DataView(p.buffer,p.byteOffset,p.byteLength);
  return {source:p[5]?'receiver':'guitar',fresh:Boolean(p[6]),mode:p[7],buttons:v.getUint16(8,true),left:Boolean(p[10]&1),right:Boolean(p[10]&2),solo:p[11],whammy:v.getUint16(12,true),pickup:p[14],timestamp:v.getUint32(16,true)};
}
export function previewPressed(state,key){
  if(!state?.fresh)return false;
  if(key==='left'||key==='right')return state[key];
  if(key.startsWith('solo-'))return Boolean(state.solo&(1<<Number(key.slice(5))));
  return Boolean(state.buttons&(1<<Number(key)));
}
