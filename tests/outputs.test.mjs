import { setLanguage } from '../i18n.mjs';
setLanguage('pt-BR', { persist: false });
import test from 'node:test';
import assert from 'node:assert/strict';
import {OUTPUTS_DEFAULTS,encodeOutputs,decodeOutputs,validateOutputs,saveOutputs,decodeOutputsLive} from '../webhid-outputs.mjs';
test('LED rules roundtrip, HID report ID, offset and reserved bytes',()=>{
  const c={rules:[{gpio:0,modes:1,active_low:false},{gpio:1,modes:2,active_low:true},{gpio:14,modes:6,active_low:false}]};
  const b=encodeOutputs(c);assert.deepEqual([...b],[1,0,0,1,0,0,1,2,1,0,14,6,0,0,0,0]);
  const wrapped=new Uint8Array(24);wrapped.set([15,...b],3);assert.deepEqual(decodeOutputs(new DataView(wrapped.buffer,3,17)).outputs,{rules:c.rules.map(r=>({...r,event:0}))});
  for(const [offset,value] of [[4,2],[5,5],[14,1],[3,8]]){const bad=b.slice();bad[offset]=value;assert.throws(()=>decodeOutputs(bad));}
});
test('LED GPIO conflicts include buttons, MODE, I2C, extras and other outputs',()=>{
  const c=structuredClone(OUTPUTS_DEFAULTS);c.rules[0].gpio=0;
  for(const [base,extra,tilt] of [[{buttons:{green:0},mode_gpio:13}], [{buttons:{},mode_gpio:0}], [null,{pins:{left:0}}], [null,null,{source:2,sda:0,scl:1}]])assert.ok(validateOutputs(c,base,extra,tilt).length);
  c.rules[1].gpio=0;assert.ok(validateOutputs(c).length);c.rules[1].gpio=255;
  assert.deepEqual(validateOutputs(c,{buttons:{tilt:255},mode_gpio:13}),[]);
  c.rules[0].gpio=26;assert.ok(validateOutputs(c).length);
});
test('LED live snapshot separates active LED and electrical level',()=>{
  const b=Uint8Array.from([88,67,76,83,1,3,3,1,3,0,0,1,255,0,0,0]);
  assert.deepEqual(decodeOutputsLive(b),{mode:0,rules:[{gpio:0,enabled:true,active:true,high:true},{gpio:1,enabled:true,active:false,high:true},{gpio:255,enabled:false,active:false,high:false}]});
  assert.deepEqual(decodeOutputsLive(Uint8Array.from([17,...b])),decodeOutputsLive(b));
  b[7]=4;assert.throws(()=>decodeOutputsLive(b));b[7]=1;b[13]=1;assert.throws(()=>decodeOutputsLive(b));
});
test('LED saving confirms matching Ready and rejects error and stale settings',async()=>{
  const c=structuredClone(OUTPUTS_DEFAULTS);c.rules[0].gpio=0;
  let sent;
  const client=(replies)=>{let now=0;return {device:{sendFeatureReport:async(id,p)=>{assert.equal(id,15);sent=p;},receiveFeatureReport:async()=>replies.shift()??encodeOutputs(OUTPUTS_DEFAULTS)},exclusive:fn=>fn(),transfer:fn=>fn(),now:()=>now,timeout:60,sleep:async ms=>{now+=ms;}};};
  const pending=encodeOutputs(OUTPUTS_DEFAULTS);pending[1]=1;
  assert.deepEqual(await saveOutputs(client([pending,encodeOutputs(c)]),c),c);assert.equal(sent.length,16);
  for(const status of [2,3]){const p=encodeOutputs(c);p[1]=status;await assert.rejects(()=>saveOutputs(client([p]),c));}
  await assert.rejects(()=>saveOutputs(client([]),c),/não confirmada/);
});

test('Bluetooth LED events persist, validate PWM aliases and expose dim brightness',()=>{
  const c=structuredClone(OUTPUTS_DEFAULTS);c.rules[0]={gpio:0,modes:1,active_low:true,event:4};
  for(const event of [2,3,4]){c.rules[0].event=event;assert.equal(decodeOutputs(encodeOutputs(c)).outputs.rules[0].event,event);}
  c.rules[1]={gpio:16,modes:1,active_low:false,event:2};assert.ok(validateOutputs(c).length);
  c.rules[1].event=0;assert.deepEqual(validateOutputs(c),[]);
  const live=Uint8Array.from([88,67,76,83,2,3,1,1,1,0,0,255,255,32,0,0]);
  assert.equal(decodeOutputsLive(live).rules[0].brightness,32);
  live[4]=1;assert.throws(()=>decodeOutputsLive(live));
});

test('Onboard LED target persists, has fixed polarity, validates PWM and decodes live status',()=>{
  const c=structuredClone(OUTPUTS_DEFAULTS);c.rules[0]={gpio:254,modes:1,event:4,active_low:false};
  assert.equal(decodeOutputs(encodeOutputs(c)).outputs.rules[0].gpio,254);
  c.rules[1]={gpio:254,modes:1,event:0,active_low:false};assert.ok(validateOutputs(c).length);
  c.rules[1]={gpio:14,modes:1,event:2,active_low:false};assert.deepEqual(validateOutputs(c),[]);
  c.rules[1].gpio=9;assert.ok(validateOutputs(c).length);c.rules[1].gpio=255;
  c.rules[0].active_low=true;assert.throws(()=>encodeOutputs(c));c.rules[0].active_low=false;
  c.rules[0].gpio=25;assert.throws(()=>encodeOutputs(c));
  const p=Uint8Array.from([88,67,76,83,2,3,1,1,1,0,254,255,255,255,0,0]);
  assert.equal(decodeOutputsLive(p).rules[0].gpio,254);assert.equal(decodeOutputsLive(p).rules[0].brightness,255);
});

test('Combined events roundtrip and legacy status maps to independent Bluetooth states',()=>{
  const c=structuredClone(OUTPUTS_DEFAULTS);c.rules[0]={gpio:254,modes:1,active_low:false,event:128|4|8|16|32};
  assert.equal(decodeOutputs(encodeOutputs(c)).outputs.rules[0].event,188);
  c.rules[0].event=192;assert.throws(()=>encodeOutputs(c));
  c.rules[0].event=128;assert.equal(decodeOutputs(encodeOutputs(c)).outputs.rules[0].event,128);
});
