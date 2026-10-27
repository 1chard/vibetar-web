import { setLanguage } from '../i18n.mjs';
setLanguage('pt-BR', { persist: false });
import test from 'node:test';
import assert from 'node:assert/strict';
import {decodeTransport,readTransport} from '../webhid-transport.mjs';
const report=Uint8Array.from([88,67,84,82,1,1,0,0]);
test('BLE transport decodes with or without OS report ID',()=>{
  assert.equal(decodeTransport(report),'bluetooth');
  assert.equal(decodeTransport(Uint8Array.from([25,...report])),'bluetooth');
  for(const index of [0,4,5,6,7]){const invalid=report.slice();invalid[index]=255;assert.throws(()=>decodeTransport(invalid));}
});
test('legacy USB never requests unknown feature',async()=>{
  const client={device:{collections:[]},exclusive(){throw Error('unexpected transfer');}};
  assert.equal(await readTransport(client),'usb');
});
test('BLE uses feature transfer through serialized WebHID client',async()=>{
  const requests=[];
  const client={device:{collections:[{usagePage:0xff00,usage:1,featureReports:[{reportId:25}]}],async receiveFeatureReport(id){requests.push(id);return report;}},async exclusive(fn){return fn();},async transfer(fn){return fn();}};
  assert.equal(await readTransport(client),'bluetooth');assert.deepEqual(requests,[25]);
});

test('an unknown device cannot impersonate BLE using report IDs alone',async()=>{
  const client={device:{collections:[{usagePage:0xff00,usage:1,featureReports:[{reportId:25}]}],async receiveFeatureReport(){return new Uint8Array(8);}},async exclusive(fn){return fn();},async transfer(fn){return fn();}};
  await assert.rejects(()=>readTransport(client),/incompatível/);
});


import { decodeRole, readRole } from '../webhid-transport.mjs';
test('USB role distinguishes receiver, rejects malformed data and accepts report prefix',async()=>{
  const p=Uint8Array.from([88,67,82,76,1,1,1,0]);
  assert.equal(decodeRole(p),'receiver');
  assert.equal(decodeRole(Uint8Array.from([28,...p])),'receiver');
  p[5]=0;assert.equal(decodeRole(p),'guitar');
  p[5]=2;assert.throws(()=>decodeRole(p));
  assert.equal(await readRole({device:{collections:[]}}),'guitar');
});
