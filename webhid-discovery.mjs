import { translate as tr } from './i18n.mjs';
function bytes(data,id,size){let p=ArrayBuffer.isView(data)?new Uint8Array(data.buffer,data.byteOffset,data.byteLength):new Uint8Array(data);if(p.length===size+1&&p[0]===id)p=p.subarray(1);return p;}
export function decodeDiscovery(data){
  const p=bytes(data,29,32);
  if(p.length!==32 || String.fromCharCode(...p.subarray(0,4))!=='XCDV' || p[4]!==1 || p[5]>3 || (p[7]&128))throw new Error(tr("errors.discoveryReport"));
  const devices=[];
  for(let i=0;i<p[5];i++){
    const offset=8+8*i;if(p[offset+6]>1)throw new Error(tr("errors.bluetoothAddress"));
    const address=[...p.subarray(offset,offset+6)];
    devices.push({address,type:p[offset+6],rssi:p[offset+7]<128?p[offset+7]:p[offset+7]-256,label:address.map(x=>x.toString(16).padStart(2,'0')).join(':').toUpperCase()});
  }
  if(p.subarray(8+8*p[5]).some(x=>x))throw new Error(tr("errors.discoveryList"));
  return {devices,gatt_status:p[6]===255?null:p[6],manual:Boolean(p[7]&1),scanning:Boolean(p[7]&2),connecting:Boolean(p[7]&4),connected:Boolean(p[7]&8),ready:Boolean(p[7]&16),error:Boolean(p[7]&32),advertisements:Boolean(p[7]&64)};
}
export function encodeConnect(device){
  if(!device || !Array.isArray(device.address) || device.address.length!==6 || device.address.some(x=>!Number.isInteger(x)||x<0||x>255) || ![0,1].includes(device.type))throw new Error(tr("errors.selectGuitar"));
  return Uint8Array.from([88,67,67,78,1,0,device.type,0,...device.address,0,0]);
}
export async function connectGuitar(client,device){
  const request=encodeConnect(device);
  return client.exclusive(async()=>{
    await client.transfer(()=>client.device.sendFeatureReport(30,request));
    const end=client.now()+client.timeout;
    do{
      const p=bytes(await client.transfer(()=>client.device.receiveFeatureReport(30)),30,16);
      if(p.length!==16 || String.fromCharCode(...p.subarray(0,4))!=='XCCN' || p[4]!==1 || p[5]>3 || p[6]>1 || p[7] || p[14] || p[15])throw new Error(tr("errors.connectionReport"));
      if(p[5]>=2)throw new Error(p[5]===2?tr("errors.guitarExpired"):tr("errors.discoveryNotReady"));
      if(!p[5] && p.every((x,i)=>i===5 || x===request[i]))return;
      await client.sleep(30);
    }while(client.now()<end);
    throw new Error(tr("errors.connectionUnconfirmed"));
  });
}

export function decodeReceiverHealth(data){
  const p=bytes(data,31,16);
  if(p.length!==16||String.fromCharCode(...p.subarray(0,4))!=='XCRD'||p[4]!==1||p[5]>8||p[7]>8||p[8]>1||p[9]>1||p[10]>1||p[15])throw new Error(tr("errors.receiverDiagnostics"));
  return {reason:p[5],att_status:p[6]===255?null:p[6],stage:p[7],security_ready:Boolean(p[8]),hid_ready:Boolean(p[9]),valid_state:Boolean(p[10]),last_report:p[11],report_length:p[12],reports:p[13],valid_reports:p[14]};
}
export function receiverHealthText(health){
  if(!health)return '';
  const reasons=['',tr("receiver.discoveryFailed"),tr("receiver.securityTimeout"),tr("receiver.discoveryTimeout"),tr("receiver.noValidState"),tr("receiver.transmissionLost"),tr("receiver.feedbackTimeout"),tr("receiver.encryptionLost"),tr("receiver.pairingFailed")];
  const stages=['',tr("receiver.stageService"),tr("receiver.stageCharacteristics"),tr("receiver.stageReportMap"),tr("receiver.stageMapDescriptors"),tr("receiver.stageReportDescriptors"),tr("receiver.stageReportIds"),tr("receiver.stageNotifications"),tr("receiver.stageFeedback")];
  return [reasons[health.reason],health.att_status?`ATT: 0x${health.att_status.toString(16).padStart(2,'0').toUpperCase()}${stages[health.stage]?tr("diagnostics.stageSuffix", stages[health.stage]):''}`:'',health.reason===4?tr("diagnostics.reportCounts", health.reports, health.valid_reports, health.last_report, health.report_length):''].filter(Boolean).join(' · ');
}

export function decodeBluetoothLink(data){
  const p=bytes(data,32,24);
  if(p.length!==24||String.fromCharCode(...p.subarray(0,4))!=='XCLP'||p[4]!==1||(p[5]&~15)||(p[6]>3&&p[6]!==255)||p[7]||p[22]>1||p[23])throw new Error(tr("errors.linkIdentity"));
  const address=offset=>[...p.subarray(offset,offset+6)].map(x=>x.toString(16).padStart(2,'0')).join(':').toUpperCase();
  return {connected:Boolean(p[5]&1),encrypted:Boolean(p[5]&2),hid:Boolean(p[5]&4),stale:Boolean(p[5]&8),local:address(8),peer:p[6]===255?null:address(14),handle:p[20]|p[21]<<8,role:p[22]};
}
export function bluetoothLinkText(link){
  if(!link)return '';
  return tr("diagnostics.peerAddresses", link.local, link.peer??tr("common.none"), link.stale?tr("diagnostics.staleHandleSuffix"):'');
}
