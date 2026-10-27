import { translate as tr } from './i18n.mjs';
export const TILT_DEFAULTS = { source:0, adc_gpio:28, sda:20, scl:21, address:0x53, axis:0, below:false, threshold:2000, hysteresis:100 };
export function validateTilt(t, base, extras) {
  if (!t || Object.keys(t).sort().join() !== Object.keys(TILT_DEFAULTS).sort().join()) return [tr("validation.tiltConfig")];
  const e=[], integer=(v,lo,hi)=>Number.isInteger(v)&&v>=lo&&v<=hi;
  if (!integer(t.source,0,2) || !integer(t.adc_gpio,26,28) || !integer(t.sda,0,20) || ![0,2].includes(t.sda%4) || t.scl!==t.sda+1 ||
      ![0x53,0x1d].includes(t.address) || !integer(t.axis,0,2) || typeof t.below!=='boolean') e.push(tr("validation.tiltSource"));
  const lo=t.source===2?-16000:0, hi=t.source===2?16000:4095;
  if (!integer(t.threshold,lo,hi) || !integer(t.hysteresis,0,hi-lo) ||
      (t.below?t.threshold+t.hysteresis>hi:t.threshold-t.hysteresis<lo)) e.push(tr("validation.tiltRange"));
  if (t.source===1 && ((base?.whammy.enabled && base.whammy.gpio===t.adc_gpio) || extras?.pickup.gpio===t.adc_gpio)) e.push(tr("validation.tiltAdcConflict"));
  if (t.source===2) {
    const used=[...(base?Object.values(base.buttons):[]),base?.mode_gpio,...(extras?Object.values(extras.pins):[])];
    for (const pin of [t.sda,t.scl]) if(used.includes(pin)) e.push(tr("validation.tiltI2cConflict", pin));
  }
  return e;
}
export function encodeTilt(t, base, extras) {
  const e=validateTilt(t,base,extras); if(e.length) throw new Error(e.join(' '));
  const b=Uint8Array.from([1,0,t.source,t.adc_gpio,t.sda,t.scl,t.address,t.axis,Number(t.below),0,0,0,0,0,0,0]);
  const v=new DataView(b.buffer); v.setInt16(9,t.threshold,true); v.setUint16(11,t.hysteresis,true); return b;
}
export function decodeTilt(data,id=9) {
  let b=ArrayBuffer.isView(data)?new Uint8Array(data.buffer,data.byteOffset,data.byteLength):new Uint8Array(data);
  if(b.length===17&&b[0]===id)b=b.subarray(1);
  if(b.length!==16||b[0]!==1||b[1]>3||b[8]>1||b.subarray(13).some(x=>x))throw new Error(tr("errors.tiltReport"));
  const v=new DataView(b.buffer,b.byteOffset,b.byteLength);
  const tilt={source:b[2],adc_gpio:b[3],sda:b[4],scl:b[5],address:b[6],axis:b[7],below:Boolean(b[8]),threshold:v.getInt16(9,true),hysteresis:v.getUint16(11,true)};
  const e=validateTilt(tilt); if(e.length)throw new Error(e.join(' ')); return {tilt,status:b[1]};
}
export function sameTilt(a,b) {
  if(!a||!b||validateTilt(a).length||validateTilt(b).length)return false;
  const x=encodeTilt(a),y=encodeTilt(b);return x.every((v,i)=>v===y[i]);
}
export async function readTilt(client) {
  return client.exclusive(async()=>decodeTilt(await client.transfer(()=>client.device.receiveFeatureReport(9))));
}
export async function saveTilt(client,t,base,extras) {
  const p=encodeTilt(t,base,extras),expected=decodeTilt(p).tilt;
  return client.exclusive(async()=>{
    await client.transfer(()=>client.device.sendFeatureReport(9,p));
    const end=client.now()+client.timeout;
    do{
      const r=decodeTilt(await client.transfer(()=>client.device.receiveFeatureReport(9)));
      if(r.status>=2)throw new Error(r.status===2?tr("errors.tiltRejected"):tr("errors.tiltFlash"));
      if(!r.status&&sameTilt(r.tilt,expected))return r.tilt;
      await client.sleep(30);
    }while(client.now()<end);
    throw new Error(tr("errors.tiltUnconfirmed"));
  });
}
export function decodeTiltLive(data) {
  let b=ArrayBuffer.isView(data)?new Uint8Array(data.buffer,data.byteOffset,data.byteLength):new Uint8Array(data);
  if(b.length===21&&b[0]===11)b=b.subarray(1);
  if(b.length!==20||String.fromCharCode(...b.subarray(0,4))!=='XCTL'||b[4]!==1||b[5]>2||b[6]>1||b[7]>1||b.subarray(16).some(x=>x))throw new Error(tr("errors.tiltReading"));
  const v=new DataView(b.buffer,b.byteOffset,b.byteLength);
  const value=v.getInt16(8,true),axes=[10,12,14].map(i=>v.getInt16(i,true));
  if((b[5]===1&&(value<0||value>4095))||axes.some(x=>Math.abs(x)>16000))throw new Error(tr("errors.tiltReadingInvalid"));
  return {source:b[5],valid:Boolean(b[6]),active:Boolean(b[7]),value,axes};
}
