import { setLanguage } from '../i18n.mjs';
setLanguage('pt-BR', { persist: false });
import test from 'node:test';
import assert from 'node:assert/strict';
import { decodeGpio, readGpio } from '../webhid-gpio.mjs';
function snapshot() {
  const bytes = new Uint8Array(20), view = new DataView(bytes.buffer);
  bytes.set([88, 67, 71, 80, 1, 1, 1, 0]);
  view.setUint32(8, (1 << 22) | (1 << 13), true);
  view.setUint32(12, (1 << 22) | (1 << 13) | (1 << 26), true);
  view.setUint16(16, 4095, true); view.setUint16(18, 65535, true);
  return bytes;
}
test('decode live pins and ADC with optional ID and nonzero offset', () => {
  const bytes = snapshot(), data = Uint8Array.from([5, ...bytes]);
  assert.deepEqual(decodeGpio(data), { activeMask: (1 << 22) | (1 << 13),
    configuredMask: (1 << 22) | (1 << 13) | (1 << 26), buttons: 1,
    adcEnabled: true, rawAdc: 4095, whammy: 65535 });
  const padded = Uint8Array.from([99, ...bytes, 99]);
  assert.equal(decodeGpio(new DataView(padded.buffer, 1, 20)).rawAdc, 4095);
});
function fullSnapshot() {
  const bytes = new Uint8Array(30), view = new DataView(bytes.buffer);
  bytes.set(snapshot()); bytes[4] = 2;
  view.setUint32(8, 1, true); // unassigned GP0 grounded
  view.setUint32(20, 0x7fffff, true);
  view.setUint16(24, 0, true); view.setUint16(26, 2048, true); view.setUint16(28, 4095, true);
  return bytes;
}
test('full scan accepts unassigned digital pins and all ADCs, preserving view offset', () => {
  const bytes = fullSnapshot();
  const padded = Uint8Array.from([99, 6, ...bytes, 99]);
  const scan = decodeGpio(new DataView(padded.buffer, 1, 31));
  assert.equal(scan.activeMask, 1);
  assert.equal(scan.configuredMask & 1, 0);
  assert.equal(scan.fullScan, true);
  assert.equal(scan.monitoredMask, 0x7fffff);
  assert.deepEqual(scan.adcValues, [0, 2048, 4095]);
  for (const offset of [11, 23, 25, 27, 29]) {
    const invalid = bytes.slice(); invalid[offset] = 255;
    assert.throws(() => decodeGpio(invalid));
  }
});
test('prefer full scan report, fall back to legacy report for old firmware', async () => {
  const device = { collections: [{ usagePage: 0xff00, usage: 1, featureReports: [{ reportId: 6 }] }],
    async receiveFeatureReport(id) { assert.equal(id, 6); return fullSnapshot(); } };
  assert.equal((await readGpio(device)).fullScan, true);
  delete device.collections;
  device.receiveFeatureReport = async id => { assert.equal(id, 5); return snapshot(); };
  assert.equal((await readGpio(device)).fullScan, undefined);
});
test('reject truncation, invalid headers, and activity outside configured GPIO', () => {
  assert.throws(() => decodeGpio(new Uint8Array(19)));
  for (const index of [0, 4, 5, 9, 15, 17]) {
    const bytes = snapshot(); bytes[index] = 255;
    assert.throws(() => decodeGpio(bytes));
  }
});
