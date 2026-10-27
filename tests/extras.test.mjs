import { setLanguage } from '../i18n.mjs';
setLanguage('pt-BR', { persist: false });
import test from 'node:test';
import assert from 'node:assert/strict';
import { EXTRA_DEFAULTS, encodeExtras, decodeExtras, validateExtras, readExtras, saveExtras } from '../webhid-extras.mjs';
const base = { buttons: Object.fromEntries(Array.from({length:11}, (_,i) => [String(i), i+2])), mode_gpio:13, whammy:{gpio:26,enabled:true} };
test('optional report roundtrip, report ID and offset; inactive by default', () => {
  const e = structuredClone(EXTRA_DEFAULTS); e.pins.left=0; e.pins.solo_modifier=14; e.pickup={gpio:27,inverted:true,min:125,max:3900};
  const payload=encodeExtras(e,base); assert.equal(payload.length,24); assert.equal(payload[2],0); assert.equal(payload[11],1);
  const os=new Uint8Array(28); os[2]=7; os.set(payload,3);
  assert.deepEqual(decodeExtras(new DataView(os.buffer,2,25)).extras,e);
  assert.deepEqual(decodeExtras(encodeExtras(EXTRA_DEFAULTS)).extras,EXTRA_DEFAULTS);
});
test('reject pin conflicts, internal GPIO, ADC collisions, calibration and malformed bytes', () => {
  let e=structuredClone(EXTRA_DEFAULTS); e.pins.left=2; assert.ok(validateExtras(e,base).length);
  e.pins.left=0; e.pins.right=0; assert.ok(validateExtras(e,base).length);
  e.pins.right=23; assert.ok(validateExtras(e,base).length);
  e.pins.right=255; e.pickup.gpio=26; assert.ok(validateExtras(e,base).length);
  e.pickup.gpio=27; e.pickup.min=e.pickup.max; assert.ok(validateExtras(e,base).length);
  const bytes=encodeExtras(EXTRA_DEFAULTS); bytes[16]=1; assert.throws(()=>decodeExtras(bytes));
  bytes[16]=0; bytes[11]=2; assert.throws(()=>decodeExtras(bytes));
  assert.throws(()=>decodeExtras(bytes.subarray(0,23)));
});
function mock({status=0,stale=false}={}) {
  let stored=encodeExtras(EXTRA_DEFAULTS), reads=0;
  const device={ async sendFeatureReport(id,p){assert.equal(id,7); if(!stale) stored=p.slice();},
    async receiveFeatureReport(id){assert.equal(id,7); const b=stored.slice(); b[1]=reads++===0?1:status; return new DataView(b.buffer);} };
  let now=0;
  return {device,exclusive:fn=>fn(),transfer:fn=>fn(),now:()=>now,timeout:100,sleep:async ms=>{now+=ms;}};
}
test('save confirms flash status AND values after Pending', async () => {
  const client=mock(), e=structuredClone(EXTRA_DEFAULTS); e.pins.left=0;
  assert.deepEqual(await saveExtras(client,e,base),e);
  assert.deepEqual((await readExtras(client)).extras,e);
});
test('flash errors, rejected config and stale Ready cannot announce success', async () => {
  const e=structuredClone(EXTRA_DEFAULTS); e.pins.right=1;
  await assert.rejects(saveExtras(mock({status:3}),e,base),/flash/);
  await assert.rejects(saveExtras(mock({status:2}),e,base),/rejeitada/);
  await assert.rejects(saveExtras(mock({stale:true}),e,base),/não confirmada/);
});
