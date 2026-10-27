import { translate as tr } from './i18n.mjs';
export function outputEventMask(rule){const e=rule.event??0;return e&128?e&63:[1,2,4,8,28][e]??0;}
export const OUTPUTS_DEFAULTS={rules:[{gpio:255,modes:1,active_low:false,event:0},{gpio:255,modes:2,active_low:false,event:0},{gpio:255,modes:4,active_low:false,event:0}]};
export function validateOutputs(c,base,extras,tilt){
  if(!c || Object.keys(c).join()!=='rules' || !Array.isArray(c.rules) || c.rules.length!==3) return [tr("validation.outputsCount")];
  const errors=[],used=new Set([...(base?Object.values(base.buttons):[]),base?.mode_gpio,...(extras?Object.values(extras.pins):[]),...(tilt?.source===2?[tilt.sda,tilt.scl]:[])]);
  for(const [i,r] of c.rules.entries()){
    if(!r || !['active_low,gpio,modes','active_low,event,gpio,modes'].includes(Object.keys(r).sort().join()) || !Number.isInteger(r.gpio) || (r.gpio!==255 && r.gpio!==254 && (r.gpio<0 || r.gpio>22)) || !Number.isInteger(r.modes) || r.modes<0 || r.modes>7 || (r.event!==undefined && (!Number.isInteger(r.event) || r.event<0 || r.event>255 || (r.event>4 && (!(r.event&128)||(r.event&64))))) || typeof r.active_low!=='boolean') {errors.push(tr("validation.outputConfig", i+1));continue;}
    if(r.gpio===254 && r.active_low)errors.push(tr("validation.onboardPolarity", i+1));
    if(r.gpio===255)continue;
    if(used.has(r.gpio))errors.push(tr("validation.outputConflict", r.gpio===254?tr("outputs.onboardLed"):'GP'+r.gpio));
    if((outputEventMask(r)&44) && c.rules.slice(0,i).some(other=>other.gpio!==255 && (outputEventMask(other)&44) && ((other.gpio===254?25:other.gpio)&15)===((r.gpio===254?25:r.gpio)&15)))errors.push(tr("validation.outputPwmConflict", i+1));
    used.add(r.gpio);
  }
  return errors;
}
export function encodeOutputs(c,base,extras,tilt){
  const errors=validateOutputs(c,base,extras,tilt);if(errors.length)throw new Error(errors.join(' '));
  const p=new Uint8Array(16);p[0]=1;
  c.rules.forEach((r,i)=>p.set([r.gpio,r.modes,Number(r.active_low),r.event??0],2+i*4));return p;
}
function bytes(data,id){let b=ArrayBuffer.isView(data)?new Uint8Array(data.buffer,data.byteOffset,data.byteLength):new Uint8Array(data);if(b.length===17&&b[0]===id)b=b.subarray(1);return b;}
export function decodeOutputs(data,id=15){
  const p=bytes(data,id);
  if(p.length!==16 || p[0]!==1 || p[1]>3 || p[14] || p[15] || [0,1,2].some(i=>p[4+i*4]>1 || (p[5+i*4]>4 && (!(p[5+i*4]&128)||(p[5+i*4]&64)))))throw new Error(tr("errors.outputsReport"));
  const outputs={rules:[0,1,2].map(i=>({gpio:p[2+i*4],modes:p[3+i*4],active_low:Boolean(p[4+i*4]),event:p[5+i*4]}))};
  if(validateOutputs(outputs).length)throw new Error(tr("validation.outputsConfig"));return {outputs,status:p[1]};
}
export function sameOutputs(a,b){if(!a||!b||validateOutputs(a).length||validateOutputs(b).length)return false;return a.rules.every((r,i)=>{const t=b.rules[i];return r.gpio===t.gpio&&r.modes===t.modes&&r.active_low===t.active_low&&outputEventMask(r)===outputEventMask(t);});}
export async function readOutputs(client){return client.exclusive(async()=>decodeOutputs(await client.transfer(()=>client.device.receiveFeatureReport(15))));}
export async function saveOutputs(client,c,base,extras,tilt){
  const p=encodeOutputs(c,base,extras,tilt),expected=decodeOutputs(p).outputs;
  return client.exclusive(async()=>{
    await client.transfer(()=>client.device.sendFeatureReport(15,p));const end=client.now()+client.timeout;
    do{
      const r=decodeOutputs(await client.transfer(()=>client.device.receiveFeatureReport(15)));
      if(r.status>=2)throw new Error(r.status===2?tr("errors.outputsRejected"):tr("errors.outputsFlash"));
      if(!r.status&&sameOutputs(r.outputs,expected))return r.outputs;
      await client.sleep(30);
    }while(client.now()<end);throw new Error(tr("errors.outputsUnconfirmed"));
  });
}
export function decodeOutputsLive(data){
  const p=bytes(data,17);
  if(p.length!==16 || String.fromCharCode(...p.subarray(0,4))!=='XCLS' || (p[4]!==1 && p[4]!==2) || p[5]!==3 || ((p[6]|p[7]|p[8])&~7) || (p[7]&~p[6]) || (p[8]&~p[6]) || p[9]>2 || (p[4]===1 && p.subarray(13).some(x=>x)) || [0,1,2].some(i=>p[10+i]!==255 && p[10+i]!==254 && p[10+i]>22))throw new Error(tr("errors.outputsState"));
  if([0,1,2].some(i=>Boolean(p[6]&(1<<i))!==(p[10+i]!==255)))throw new Error(tr("errors.outputsStateInvalid"));
  return {mode:p[9],rules:[0,1,2].map(i=>({gpio:p[10+i],enabled:Boolean(p[6]&(1<<i)),active:Boolean(p[7]&(1<<i)),high:Boolean(p[8]&(1<<i)),...(p[4]===2?{brightness:p[13+i]}:{})}))};
}
