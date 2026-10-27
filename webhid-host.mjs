import { translate as tr } from './i18n.mjs';
export const HOST_DEFAULTS={policy:0,boot_rock_band:false};
export function validateHost(c){
  return c && Object.keys(c).sort().join()==='boot_rock_band,policy' && Number.isInteger(c.policy) && c.policy>=0 && c.policy<=2 && typeof c.boot_rock_band==='boolean' ? [] : [tr("validation.hostConfig")];
}
export function encodeHost(c){
  if(validateHost(c).length)throw new Error(tr("validation.hostConfig"));
  return Uint8Array.from([1,0,c.policy,Number(c.boot_rock_band),0,0,0,0]);
}
export function decodeHost(data,id=12){
  let b=ArrayBuffer.isView(data)?new Uint8Array(data.buffer,data.byteOffset,data.byteLength):new Uint8Array(data);
  if(b.length===9&&b[0]===id)b=b.subarray(1);
  if(b.length!==8||b[0]!==1||b[1]>3||b[3]>1||b.subarray(4).some(x=>x))throw new Error(tr("errors.hostReport"));
  const host={policy:b[2],boot_rock_band:Boolean(b[3])};if(validateHost(host).length)throw new Error(tr("validation.hostConfig"));
  return {host,status:b[1]};
}
export function sameHost(a,b){return a && b && !validateHost(a).length && !validateHost(b).length && a.policy===b.policy && a.boot_rock_band===b.boot_rock_band;}
export async function readHost(client){return client.exclusive(async()=>decodeHost(await client.transfer(()=>client.device.receiveFeatureReport(12))));}
export async function saveHost(client,c){
  const p=encodeHost(c),expected=decodeHost(p).host;
  return client.exclusive(async()=>{
    await client.transfer(()=>client.device.sendFeatureReport(12,p));const end=client.now()+client.timeout;
    do{
      const r=decodeHost(await client.transfer(()=>client.device.receiveFeatureReport(12)));
      if(r.status>=2)throw new Error(r.status===2?tr("errors.hostRejected"):tr("errors.hostFlash"));
      if(!r.status&&sameHost(r.host,expected))return r.host;
      await client.sleep(30);
    }while(client.now()<end);
    throw new Error(tr("errors.hostUnconfirmed"));
  });
}
export function decodeHostLive(data){
  let b=ArrayBuffer.isView(data)?new Uint8Array(data.buffer,data.byteOffset,data.byteLength):new Uint8Array(data);
  if(b.length===17&&b[0]===14)b=b.subarray(1);
  if(b.length!==16||String.fromCharCode(...b.subarray(0,4))!=='XCHS'||b[4]!==1||b[5]>2||b[6]>2||(b[7]&~3)||b[8]>2||b[9]>1||(b[10]&~7)||b.subarray(11).some(x=>x))throw new Error(tr("errors.hostState"));
  return {kind:b[5],mode:b[6],recovery:Boolean(b[7]&1),limited:Boolean(b[7]&2),policy:b[8],boot_rock_band:Boolean(b[9]),evidence:b[10]};
}
