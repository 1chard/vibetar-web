import { translate as tr } from './i18n.mjs';
export const BATTERY_DEFAULTS={enabled:false,threshold_mv:3500,hysteresis_mv:150,diode_mv:0};
export function validateBattery(c){
  if(!c || Object.keys(c).sort().join()!=='diode_mv,enabled,hysteresis_mv,threshold_mv' || typeof c.enabled!=='boolean')return [tr("validation.batteryConfig")];
  const integer=(v,min,max)=>Number.isInteger(v)&&v>=min&&v<=max;
  return integer(c.threshold_mv,2000,4500)&&integer(c.hysteresis_mv,0,1000)&&c.threshold_mv+c.hysteresis_mv<=4500&&integer(c.diode_mv,0,1000)?[]:[tr("validation.batteryRange")];
}
export function encodeBattery(c){
  const errors=validateBattery(c);if(errors.length)throw new Error(errors.join(' '));
  const p=new Uint8Array(16),v=new DataView(p.buffer);p[0]=1;p[2]=Number(c.enabled);
  v.setUint16(4,c.threshold_mv,true);v.setUint16(6,c.hysteresis_mv,true);v.setUint16(8,c.diode_mv,true);return p;
}
function bytes(data,id,length){let p=ArrayBuffer.isView(data)?new Uint8Array(data.buffer,data.byteOffset,data.byteLength):new Uint8Array(data);if(p.length===length+1&&p[0]===id)p=p.subarray(1);return p;}
export function decodeBattery(data,id=18){
  const p=bytes(data,id,16);
  if(p.length!==16||p[0]!==1||p[1]>3||p[2]>1||p[3]||p.subarray(10).some(x=>x))throw new Error(tr("errors.batteryReport"));
  const v=new DataView(p.buffer,p.byteOffset,p.byteLength),battery={enabled:Boolean(p[2]),threshold_mv:v.getUint16(4,true),hysteresis_mv:v.getUint16(6,true),diode_mv:v.getUint16(8,true)};
  if(validateBattery(battery).length)throw new Error(tr("validation.batteryConfig"));return {battery,status:p[1]};
}
export function sameBattery(a,b){if(!a||!b||validateBattery(a).length||validateBattery(b).length)return false;const x=encodeBattery(a),y=encodeBattery(b);return x.every((v,i)=>v===y[i]);}
export async function readBattery(client){return client.exclusive(async()=>decodeBattery(await client.transfer(()=>client.device.receiveFeatureReport(18))));}
export async function saveBattery(client,c){
  const p=encodeBattery(c),expected=decodeBattery(p).battery;
  return client.exclusive(async()=>{
    await client.transfer(()=>client.device.sendFeatureReport(18,p));const end=client.now()+client.timeout;
    do{
      const r=decodeBattery(await client.transfer(()=>client.device.receiveFeatureReport(18)));
      if(r.status>=2)throw new Error(r.status===2?tr("errors.batteryRejected"):tr("errors.batteryFlash"));
      if(!r.status&&sameBattery(r.battery,expected))return r.battery;
      await client.sleep(30);
    }while(client.now()<end);throw new Error(tr("errors.batteryUnconfirmed"));
  });
}
export function decodeBatteryLive(data){
  const p=bytes(data,20,20);
  if(p.length!==20||String.fromCharCode(...p.subarray(0,4))!=='XCBT'||p[4]!==1||(p[5]&~63)||p[6]||p[7]||p.subarray(14).some(x=>x))throw new Error(tr("errors.batteryState"));
  const v=new DataView(p.buffer,p.byteOffset,p.byteLength),r={enabled:Boolean(p[5]&1),valid:Boolean(p[5]&2),usb:Boolean(p[5]&4),source_known:Boolean(p[5]&8),low:Boolean(p[5]&16),error:Boolean(p[5]&32),vsys_mv:v.getUint16(8,true),battery_mv:v.getUint16(10,true),raw:v.getUint16(12,true)};
  if(r.raw>4095||r.vsys_mv>9900||r.battery_mv>6500||(r.usb&&!r.source_known)||(r.low&&(!r.enabled||!r.valid||!r.source_known||r.usb))||((!r.valid||!r.source_known||r.usb)&&r.battery_mv))throw new Error(tr("errors.batteryStateInvalid"));return r;
}
