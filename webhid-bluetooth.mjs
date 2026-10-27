import { translate as tr } from './i18n.mjs';
export const BLUETOOTH_DEFAULTS={enabled:false,usb_priority:true};
export function validateBluetooth(c){return c&&Object.keys(c).sort().join()==='enabled,usb_priority'&&typeof c.enabled==='boolean'&&typeof c.usb_priority==='boolean'?[]:[tr("validation.bluetoothConfig")];}
export function encodeBluetooth(c){if(validateBluetooth(c).length)throw new Error(tr("validation.bluetoothConfig"));return Uint8Array.from([1,0,Number(c.enabled),Number(c.usb_priority),0,0,0,0]);}
function bytes(data,id,size){let p=ArrayBuffer.isView(data)?new Uint8Array(data.buffer,data.byteOffset,data.byteLength):new Uint8Array(data);if(p.length===size+1&&p[0]===id)p=p.subarray(1);return p;}
export function decodeBluetooth(data,id=21){const p=bytes(data,id,8);if(p.length!==8||p[0]!==1||p[1]>3||p[2]>1||p[3]>1||p.subarray(4).some(x=>x))throw new Error(tr("errors.bluetoothReport"));return {bluetooth:{enabled:Boolean(p[2]),usb_priority:Boolean(p[3])},status:p[1]};}
export function sameBluetooth(a,b){return Boolean(a&&b&&!validateBluetooth(a).length&&!validateBluetooth(b).length&&a.enabled===b.enabled&&a.usb_priority===b.usb_priority);}
export async function readBluetooth(client){return client.exclusive(async()=>decodeBluetooth(await client.transfer(()=>client.device.receiveFeatureReport(21))));}
export async function saveBluetooth(client,c){const p=encodeBluetooth(c),expected=decodeBluetooth(p).bluetooth;return client.exclusive(async()=>{await client.transfer(()=>client.device.sendFeatureReport(21,p));const end=client.now()+client.timeout;do{const r=decodeBluetooth(await client.transfer(()=>client.device.receiveFeatureReport(21)));if(r.status>=2)throw new Error(r.status===2?tr("errors.bluetoothRejected"):tr("errors.bluetoothFlash"));if(!r.status&&sameBluetooth(r.bluetooth,expected))return r.bluetooth;await client.sleep(30);}while(client.now()<end);throw new Error(tr("errors.bluetoothUnconfirmed"));});}
export function decodeBluetoothLive(data){const p=bytes(data,23,24);if(p.length!==24||String.fromCharCode(...p.subarray(0,4))!=='XCBL'||(p[4]!==1&&p[4]!==2)||(p[6]&~1)||p[7]>4||p[8]>3||p[9]>3||(p[4]===1&&p.subarray(20).some(x=>x)))throw new Error(tr("errors.bluetoothState"));const v=new DataView(p.buffer,p.byteOffset,p.byteLength),f=v.getUint16(5,true);return {enabled:Boolean(f&1),ready:Boolean(f&2),advertising:Boolean(f&4),connected:Boolean(f&8),encrypted:Boolean(f&16),subscribed:Boolean(f&32),usb_paused:Boolean(f&64),pairing:Boolean(f&128),error:Boolean(f&256),bonds:p[7],command_status:p[8],last_command:p[9],interval_ms:v.getUint16(10,true)*1.25,pairing_seconds:v.getUint16(12,true),diagnostics:p[4]===2?{connection_status:p[20]===255?null:p[20],pairing_status:p[21]===255?null:p[21],pairing_reason:p[22],disconnect_reason:p[23]}:null,address:[...p.subarray(14,20)].map(x=>x.toString(16).padStart(2,'0')).join(':').toUpperCase()};}
export function decodeBluetoothCommand(data){const p=bytes(data,24,8);if(p.length!==8||p[0]!==1||p[1]>3||p[2]>3||p.subarray(3).some(x=>x))throw new Error(tr("errors.bluetoothCommandResponse"));return {status:p[1],command:p[2]};}
export async function bluetoothCommand(client,command){if(!Number.isInteger(command)||command<1||command>3)throw new Error(tr("errors.bluetoothCommandInvalid"));return client.exclusive(async()=>{await client.transfer(()=>client.device.sendFeatureReport(24,Uint8Array.from([1,0,command,0,0,0,0,0])));const end=client.now()+client.timeout;do{const r=decodeBluetoothCommand(await client.transfer(()=>client.device.receiveFeatureReport(24)));if(r.status>=2)throw new Error(r.status===2?tr("errors.bluetoothCommandRejected"):tr("errors.bluetoothNotReady"));if(!r.status&&r.command===command)return;await client.sleep(30);}while(client.now()<end);throw new Error(tr("errors.bluetoothCommandUnconfirmed"));});}

export function bluetoothDiagnosticText(live){
  const d=live?.diagnostics;if(!d)return '';
  const hex=n=>'0x'+n.toString(16).padStart(2,'0').toUpperCase();
  const reasons={3:tr("bluetooth.authRequirements"),4:tr("bluetooth.invalidConfirmation"),5:tr("bluetooth.pairingUnsupported"),6:tr("bluetooth.keySize"),8:tr("bluetooth.unspecifiedFailure"),9:tr("bluetooth.repeatedAttempts"),10:tr("bluetooth.invalidParameters"),11:tr("bluetooth.dhKeyCheck")};
  const parts=[];
  if(d.connection_status!==null)parts.push(`Link: ${hex(d.connection_status)}`);
  if(d.pairing_status!==null)parts.push(tr("diagnostics.pairingStatus", hex(d.pairing_status), d.pairing_reason?tr("diagnostics.reasonSuffix", hex(d.pairing_reason), reasons[d.pairing_reason]?` (${reasons[d.pairing_reason]})`:''):''));
  if(d.disconnect_reason)parts.push(tr("diagnostics.lastDisconnect", hex(d.disconnect_reason)));
  return parts.length?parts.join(' · '):live.connected?tr("diagnostics.activeLinkNoResult"):tr("diagnostics.noAttempt");
}

export function bluetoothStatusText(live,receiver=false){
  if(!live)return tr("bluetooth.noReading");
  if(!live.enabled)return tr("bluetooth.disabled");
  if(live.error)return tr("bluetooth.radioError");
  if(!live.ready)return tr("bluetooth.starting");
  if(live.connected){
    if(!live.encrypted || !live.subscribed)return tr("bluetooth.waitingSecureHid");
    if(live.usb_paused)return tr("bluetooth.usbPaused");
    return receiver?tr("bluetooth.receiving"):tr("bluetooth.sending");
  }
  return receiver?(live.advertising?tr("bluetooth.searchingGuitar"):tr("bluetooth.waitingGuitar")):
    live.advertising?tr("bluetooth.available"):tr("bluetooth.notAdvertising");
}
