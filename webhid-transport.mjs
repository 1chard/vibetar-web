import { translate as tr } from './i18n.mjs';
// Report 25 exists on BLE HID only. USB/legacy firmware keeps its original map.
export function decodeTransport(data){
  let p=ArrayBuffer.isView(data)?new Uint8Array(data.buffer,data.byteOffset,data.byteLength):new Uint8Array(data);
  if(p.length===9&&p[0]===25)p=p.subarray(1);
  if(p.length!==8||String.fromCharCode(...p.subarray(0,4))!=='XCTR'||p[4]!==1||p[5]!==1||p[6]||p[7])throw new Error(tr("errors.transportIdentity"));
  return 'bluetooth';
}
export async function readTransport(client){
  const ble=client.device.collections.some(c=>c.usagePage===0xff00&&c.usage===1&&c.featureReports?.some(r=>r.reportId===25));
  if(!ble)return 'usb';
  return client.exclusive(async()=>decodeTransport(await client.transfer(()=>client.device.receiveFeatureReport(25))));
}

// USB report 28 distinguishes a local guitar from a Bluetooth receiver.
export function decodeRole(data){
  let p=ArrayBuffer.isView(data)?new Uint8Array(data.buffer,data.byteOffset,data.byteLength):new Uint8Array(data);
  if(p.length===9&&p[0]===28)p=p.subarray(1);
  if(p.length!==8||String.fromCharCode(...p.subarray(0,4))!=='XCRL'||p[4]!==1||p[5]>1||p[6]>1||p[7])throw new Error(tr("errors.firmwareIdentity"));
  return p[5]===1?'receiver':'guitar';
}
export async function readRole(client){
  const available=client.device.collections.some(c=>c.featureReports?.some(r=>r.reportId===28));
  if(!available)return 'guitar';
  return client.exclusive(async()=>decodeRole(await client.transfer(()=>client.device.receiveFeatureReport(28))));
}
