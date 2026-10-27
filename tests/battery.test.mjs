import { setLanguage } from '../i18n.mjs';
setLanguage('pt-BR', { persist: false });
import test from 'node:test';
import assert from 'node:assert/strict';
import {BATTERY_DEFAULTS,validateBattery,encodeBattery,decodeBattery,decodeBatteryLive,saveBattery} from '../webhid-battery.mjs';
import {encodeOutputs,decodeOutputs,OUTPUTS_DEFAULTS} from '../webhid-outputs.mjs';
test('Battery configuration supports report ID and offset, rejects reserved values and invalid ranges',()=>{
  const c={enabled:true,threshold_mv:3400,hysteresis_mv:200,diode_mv:300};
  const p=encodeBattery(c),b=new Uint8Array(24);b.set([18,...p],4);
  assert.deepEqual(decodeBattery(new DataView(b.buffer,4,17)).battery,c);
  for(const bad of [{...c,enabled:1},{...c,threshold_mv:4500},{...c,diode_mv:1001},{...c,hysteresis_mv:-1},{...c,unknown:0}])assert.ok(validateBattery(bad).length);
  p[10]=1;assert.throws(()=>decodeBattery(p));
});
test('Battery live distinguishes USB, estimated voltage, low flag and failed source reading',()=>{
  const p=new Uint8Array(20),v=new DataView(p.buffer);p.set([88,67,66,84,1,27]);v.setUint16(8,3200,true);v.setUint16(10,3500,true);v.setUint16(12,1324,true);
  assert.equal(decodeBatteryLive(p).low,true);
  assert.equal(decodeBatteryLive(Uint8Array.from([20,...p])).battery_mv,3500);
  p[5]=15;v.setUint16(10,0,true);assert.equal(decodeBatteryLive(p).usb,true);
  p[5]=31;assert.throws(()=>decodeBatteryLive(p));
  p[5]=33;v.setUint16(8,0,true);v.setUint16(12,0,true);assert.equal(decodeBatteryLive(p).error,true);
});
test('Low battery LED event encodes separately from USB mode and old JSON remains accepted',()=>{
  const c=structuredClone(OUTPUTS_DEFAULTS);c.rules[0]={gpio:0,modes:1,active_low:true,event:1};
  assert.equal(encodeOutputs(c)[5],1);assert.equal(decodeOutputs(encodeOutputs(c)).outputs.rules[0].event,1);
  delete c.rules[0].event;assert.equal(encodeOutputs(c)[5],0);
});
test('Battery save confirms matching Ready and rejects flash failures and stale settings',async()=>{
  const c={...BATTERY_DEFAULTS,enabled:true};
  const client=replies=>{let time=0;return {device:{sendFeatureReport:async(id,p)=>{assert.equal(id,18);assert.equal(p.length,16);},receiveFeatureReport:async()=>replies.shift()??encodeBattery(BATTERY_DEFAULTS)},exclusive:fn=>fn(),transfer:fn=>fn(),now:()=>time,timeout:60,sleep:async ms=>{time+=ms;}};};
  const pending=encodeBattery(c);pending[1]=1;
  assert.deepEqual(await saveBattery(client([pending,encodeBattery(c)]),c),c);
  for(const status of [2,3]){const p=encodeBattery(c);p[1]=status;await assert.rejects(()=>saveBattery(client([p]),c));}
  await assert.rejects(()=>saveBattery(client([]),c),/não confirmada/);
});
