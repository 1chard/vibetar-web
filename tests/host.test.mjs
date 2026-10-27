import { setLanguage } from '../i18n.mjs';
setLanguage('pt-BR', { persist: false });
import test from 'node:test';
import assert from 'node:assert/strict';
import {HOST_DEFAULTS,encodeHost,decodeHost,saveHost,decodeHostLive} from '../webhid-host.mjs';
test('policy payload roundtrip, report ID and offset',()=>{
  const c={policy:2,boot_rock_band:true};const p=encodeHost(c);assert.deepEqual([...p],[1,0,2,1,0,0,0,0]);
  const b=new Uint8Array(12);b[2]=12;b.set(p,3);assert.deepEqual(decodeHost(new DataView(b.buffer,2,9)).host,c);
  assert.throws(()=>encodeHost({policy:3,boot_rock_band:false}));p[4]=1;assert.throws(()=>decodeHost(p));
});
test('live host distinction, limited cycle and recovery override',()=>{
  const b=Uint8Array.from([88,67,72,83,1,2,1,2,0,0,4,0,0,0,0,0]);
  assert.deepEqual(decodeHostLive(b),{kind:2,mode:1,recovery:false,limited:true,policy:0,boot_rock_band:false,evidence:4});
  b[7]=1;b[6]=0;assert.equal(decodeHostLive(b).recovery,true);assert.equal(decodeHostLive(b).limited,false);
  b[7]=4;assert.throws(()=>decodeHostLive(b));
});
function client(status=0,stale=false){let stored=encodeHost(HOST_DEFAULTS),reads=0,now=0;return {
  exclusive:fn=>fn(),transfer:fn=>fn(),now:()=>now,timeout:100,sleep:async ms=>{now+=ms;},
  device:{async sendFeatureReport(id,p){assert.equal(id,12);if(!stale)stored=p.slice();},async receiveFeatureReport(){const b=stored.slice();b[1]=reads++===0?1:status;return b;}}
};}
test('policy save requires matching Ready, rejects flash error and stale config',async()=>{
  const c={policy:2,boot_rock_band:true};assert.deepEqual(await saveHost(client(),c),c);
  await assert.rejects(saveHost(client(3),c),/flash/);await assert.rejects(saveHost(client(2),c),/rejeitada/);
  await assert.rejects(saveHost(client(0,true),c),/não confirmada/);
});
