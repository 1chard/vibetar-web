import { setLanguage } from '../i18n.mjs';
setLanguage('pt-BR', { persist: false });
import test from 'node:test';
import assert from 'node:assert/strict';
import { BLUETOOTH_DEFAULTS, validateBluetooth, encodeBluetooth, decodeBluetooth, decodeBluetoothLive, saveBluetooth, bluetoothCommand, bluetoothDiagnosticText, bluetoothStatusText } from '../webhid-bluetooth.mjs';
function client(replies){let now=0;const sent=[];return {sent,timeout:100,now:()=>now,sleep:async ms=>{now+=ms;},exclusive:async f=>f(),transfer:async f=>f(),device:{sendFeatureReport:async(id,p)=>sent.push([id,[...p]]),receiveFeatureReport:async()=>replies.length>1?replies.shift():replies[0]}};}
test('Bluetooth config has safe defaults, handles HID ID and DataView offsets, rejects malformed payloads',()=>{
  assert.deepEqual(BLUETOOTH_DEFAULTS,{enabled:false,usb_priority:true});
  const c={enabled:true,usb_priority:false},p=encodeBluetooth(c);
  const full=new Uint8Array(12);full.set([21,...p],2);
  assert.deepEqual(decodeBluetooth(new DataView(full.buffer,2,9)).bluetooth,c);
  assert.equal(validateBluetooth({...c,enabled:1}).length,1);
  for(const [index,value] of [[0,2],[1,4],[2,2],[3,2],[4,1]]){const bad=p.slice();bad[index]=value;assert.throws(()=>decodeBluetooth(bad));}
});
test('Bluetooth live distinguishes USB pause, bonds, pairing window and actual connection interval',()=>{
  const p=new Uint8Array(24),v=new DataView(p.buffer);p.set([88,67,66,76,1,255,0,2,0,1]);v.setUint16(10,12,true);v.setUint16(12,119,true);
  const r=decodeBluetoothLive(p);assert.equal(r.usb_paused,true);assert.equal(r.connected,true);assert.equal(r.pairing_seconds,119);assert.equal(r.interval_ms,15);assert.equal(r.bonds,2);
  p[6]=2;assert.throws(()=>decodeBluetoothLive(p));p[6]=0;p[20]=1;assert.throws(()=>decodeBluetoothLive(p));
});
test('Bluetooth save waits for Ready with matching values and reports flash failure or stale readback',async()=>{
  const c={enabled:true,usb_priority:false},ready=encodeBluetooth(c),pending=encodeBluetooth(BLUETOOTH_DEFAULTS);pending[1]=1;
  const a=client([pending,ready]);assert.deepEqual(await saveBluetooth(a,c),c);assert.deepEqual(a.sent[0],[21,[...ready]]);
  const failure=ready.slice();failure[1]=3;await assert.rejects(saveBluetooth(client([failure]),c),/flash/);
  await assert.rejects(saveBluetooth(client([encodeBluetooth(BLUETOOTH_DEFAULTS)]),c),/não confirmada/);
});
test('Bluetooth commands wait for matching ACK and reject disabled radio and unknown commands',async()=>{
  const a=client([Uint8Array.from([1,1,2,0,0,0,0,0]),Uint8Array.from([1,0,2,0,0,0,0,0])]);await bluetoothCommand(a,2);
  assert.deepEqual(a.sent[0],[24,[1,0,2,0,0,0,0,0]]);
  await assert.rejects(bluetoothCommand(client([Uint8Array.from([1,3,0,0,0,0,0,0])]),1),/Ative/);
  await assert.rejects(bluetoothCommand(client([Uint8Array.from([1,0,1,0,0,0,0,0])]),2),/não confirmado/);
  await assert.rejects(bluetoothCommand(client([]),4),/inválido/);
});

test('v2 live includes pairing/disconnect errors and v1 stays compatible',()=>{
  const p=Uint8Array.from([88,67,66,76,2,7,1,0,0,0,0,0,60,0,0,0,0,0,0,0,0,5,6,19]);
  const r=decodeBluetoothLive(p);
  assert.deepEqual(r.diagnostics,{connection_status:0,pairing_status:5,pairing_reason:6,disconnect_reason:19});
  assert.match(bluetoothDiagnosticText(r),/tamanho da chave/);assert.match(bluetoothDiagnosticText(r),/0x13/);
  p[20]=255;p[21]=255;p[22]=0;p[23]=0;assert.match(bluetoothDiagnosticText(decodeBluetoothLive(p)),/Nenhuma tentativa/);
  p[4]=1;p[20]=0;p[21]=0;assert.equal(decodeBluetoothLive(p).diagnostics,null);
  p[4]=3;assert.throws(()=>decodeBluetoothLive(p));
});

test('A connected radio is not reported as ready HID merely because USB priority is set',()=>{
  const live={enabled:true,ready:true,connected:true,usb_paused:true,encrypted:false,subscribed:false};
  assert.match(bluetoothStatusText(live),/aguardando pareamento/);
  live.encrypted=true;assert.match(bluetoothStatusText(live),/aguardando pareamento/);
  live.subscribed=true;assert.match(bluetoothStatusText(live),/prioridade USB/);
  live.usb_paused=false;assert.match(bluetoothStatusText(live,true),/recebendo controles/);
  live.connected=false;live.advertising=true;assert.match(bluetoothStatusText(live),/Disponível/);
  assert.match(bluetoothDiagnosticText({connected:true,diagnostics:{connection_status:null,pairing_status:null,pairing_reason:0,disconnect_reason:0}}),/enlace ativo/);
});
