import { setLanguage } from '../i18n.mjs';
setLanguage('pt-BR', { persist: false });
import test from 'node:test';
import assert from 'node:assert/strict';
import {TILT_DEFAULTS,encodeTilt,decodeTilt,validateTilt,saveTilt,decodeTiltLive} from '../webhid-tilt.mjs';
const base={buttons:{green:2,tilt:11},mode_gpio:13,whammy:{gpio:26,enabled:true}};
const extras={pins:{left:0},pickup:{gpio:27}};
test('signed milli-g thresholds roundtrip with HID ID and DataView offset',()=>{
  const t={...TILT_DEFAULTS,source:2,axis:1,below:true,threshold:-600,hysteresis:125};
  const p=encodeTilt(t,base,extras);assert.equal(p.length,16);assert.equal(p[9],168);assert.equal(p[10],253);
  const b=new Uint8Array(20);b[2]=9;b.set(p,3);
  assert.deepEqual(decodeTilt(new DataView(b.buffer,2,17)).tilt,t);
});
test('reject shared ADC, I2C button conflicts, invalid pair, sensor range and release threshold',()=>{
  assert.ok(validateTilt({...TILT_DEFAULTS,source:1,adc_gpio:26},base,extras).length);
  assert.ok(validateTilt({...TILT_DEFAULTS,source:1,adc_gpio:27},base,extras).length);
  assert.equal(validateTilt({...TILT_DEFAULTS,source:1},base,extras).length,0);
  assert.ok(validateTilt({...TILT_DEFAULTS,source:2,sda:0,scl:1},base,extras).length);
  assert.ok(validateTilt({...TILT_DEFAULTS,source:2,sda:2,scl:3},base,extras).length);
  assert.ok(validateTilt({...TILT_DEFAULTS,sda:3,scl:4}).length);
  assert.ok(validateTilt({...TILT_DEFAULTS,threshold:10,hysteresis:100}).length);
  assert.ok(validateTilt({...TILT_DEFAULTS,source:2,threshold:-16000,hysteresis:1}).length);
  const p=encodeTilt(TILT_DEFAULTS);p[13]=1;assert.throws(()=>decodeTilt(p));
});
test('live snapshot reports signed axes, validity and actual activation',()=>{
  const b=new Uint8Array(20);b.set([88,67,84,76,1,2,1,1]);
  const v=new DataView(b.buffer);v.setInt16(8,-600,true);v.setInt16(10,1000,true);v.setInt16(12,-600,true);
  assert.deepEqual(decodeTiltLive(v),{source:2,valid:true,active:true,value:-600,axes:[1000,-600,0]});
  b[6]=0;b[7]=0;assert.equal(decodeTiltLive(v).valid,false);
  b[4]=2;assert.throws(()=>decodeTiltLive(v));
});
function client(status=0,stale=false){
  let stored=encodeTilt(TILT_DEFAULTS),reads=0,now=0;
  return {exclusive:fn=>fn(),transfer:fn=>fn(),now:()=>now,timeout:100,sleep:async ms=>{now+=ms;},
    device:{async sendFeatureReport(id,p){assert.equal(id,9);if(!stale)stored=p.slice();},async receiveFeatureReport(){const b=stored.slice();b[1]=reads++===0?1:status;return new DataView(b.buffer);}}};
}
test('confirm matching Ready and reject flash errors / stale values',async()=>{
  const t={...TILT_DEFAULTS,source:1,threshold:2500};
  assert.deepEqual(await saveTilt(client(),t,base,extras),t);
  await assert.rejects(saveTilt(client(3),t,base,extras),/flash/);
  await assert.rejects(saveTilt(client(2),t,base,extras),/rejeitado/);
  await assert.rejects(saveTilt(client(0,true),t,base,extras),/não confirmada/);
});
