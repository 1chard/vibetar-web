import { setLanguage } from '../i18n.mjs';
setLanguage('pt-BR', { persist: false });
import test from 'node:test';
import assert from 'node:assert/strict';
import {decodePreview,previewPressed} from '../webhid-preview.mjs';
test('Full controller preview identifies receiver inputs, whammy, solo and little-endian timestamp',()=>{
  const p=Uint8Array.from([88,67,83,84,1,1,1,2,255,7,3,31,255,255,224,0,120,86,52,18,0,0,0,0]);
  const s=decodePreview(Uint8Array.from([33,...p]));assert.equal(s.source,'receiver');assert.equal(s.whammy,65535);assert.equal(s.timestamp,0x12345678);
  for(const key of ['0','10','left','right','solo-4'])assert.equal(previewPressed(s,key),true);
  const wrapped=new Uint8Array(32);wrapped.set(p,4);assert.deepEqual(decodePreview(new DataView(wrapped.buffer,4,24)),s);
  p[6]=0;assert.throws(()=>decodePreview(p));p.fill(0,8,15);const stale=decodePreview(p);assert.equal(previewPressed(stale,'0'),false);
  p[23]=1;assert.throws(()=>decodePreview(p));
});
