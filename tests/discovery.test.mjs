import { setLanguage } from '../i18n.mjs';
setLanguage('pt-BR', { persist: false });
import test from 'node:test';
import assert from 'node:assert/strict';
import {decodeDiscovery,encodeConnect,connectGuitar} from '../webhid-discovery.mjs';
const candidate={address:[1,2,3,4,5,6],type:1};
test('Discovery decodes addresses, signal and diagnostic flags with report ID and offset',()=>{
  const p=new Uint8Array(32);p.set([88,67,68,86,1,1,255,67,1,2,3,4,5,6,1,196]);
  const d=decodeDiscovery(p);assert.equal(d.devices[0].rssi,-60);assert.equal(d.devices[0].label,'01:02:03:04:05:06');
  assert.equal(d.advertisements,true);assert.equal(d.manual,true);assert.equal(d.scanning,true);
  const wrapped=new Uint8Array(40);wrapped.set([29,...p],3);
  assert.deepEqual(decodeDiscovery(new DataView(wrapped.buffer,3,33)),d);
  for(const [offset,value] of [[5,4],[7,128],[14,2],[20,1]]){const bad=p.slice();bad[offset]=value;assert.throws(()=>decodeDiscovery(bad));}
});
test('Explicit connection confirms the requested address and distinguishes acceptance from link completion',async()=>{
  const request=encodeConnect(candidate);assert.equal(request.length,16);
  assert.throws(()=>encodeConnect({...candidate,address:[1]}));
  let now=0,sent;
  const pending=request.slice();pending[5]=1;
  const stale=encodeConnect({...candidate,type:0});
  const replies=[pending,stale,request];
  const client={exclusive:fn=>fn(),transfer:fn=>fn(),now:()=>now,timeout:100,sleep:async ms=>{now+=ms;},device:{sendFeatureReport:async(id,p)=>{assert.equal(id,30);sent=p;},receiveFeatureReport:async()=>replies.shift()??stale}};
  await connectGuitar(client,candidate);assert.deepEqual(sent,request);assert.equal(now,60);
  for(const status of [2,3]){client.device.receiveFeatureReport=async()=>{const p=request.slice();p[5]=status;return p;};await assert.rejects(()=>connectGuitar(client,candidate));}
  client.device.receiveFeatureReport=async()=>stale;await assert.rejects(()=>connectGuitar(client,candidate),/não confirmada/);
});

import {decodeReceiverHealth,receiverHealthText} from '../webhid-discovery.mjs';
test('Receiver reports distinguish successful pairing from ATT discovery and data timeouts',()=>{
  const p=Uint8Array.from([88,67,82,68,1,1,5,3,1,0,0,0,0,0,0,0]);
  assert.match(receiverHealthText(decodeReceiverHealth(p)),/ATT: 0x05.*mapa de reports/);
  p[5]=4;p[6]=0;p[7]=7;p[9]=1;p[11]=26;p[12]=17;p[13]=20;p[14]=0;
  assert.match(receiverHealthText(decodeReceiverHealth(Uint8Array.from([31,...p]))),/Reports recebidos: 20, válidos: 0/);
  p[15]=1;assert.throws(()=>decodeReceiverHealth(p));
});

import {decodeBluetoothLink,bluetoothLinkText} from '../webhid-discovery.mjs';
test('Link identifies the actual peer and detects stale application handles without exposing keys',()=>{
  const p=Uint8Array.from([88,67,76,80,1,7,0,0,1,2,3,4,5,6,6,5,4,3,2,1,64,0,0,0]);
  const link=decodeBluetoothLink(p);assert.equal(link.peer,'06:05:04:03:02:01');assert.equal(link.handle,64);
  assert.match(bluetoothLinkText(link),/Endereço local: 01:02:03:04:05:06/);
  p[5]=9;p[6]=255;assert.match(bluetoothLinkText(decodeBluetoothLink(Uint8Array.from([32,...p]))),/inconsistente/);
  p[23]=1;assert.throws(()=>decodeBluetoothLink(p));
});
