import { setLanguage } from '../i18n.mjs';
setLanguage('pt-BR', { persist: false });
import test from 'node:test';
import assert from 'node:assert/strict';
import { encodeConfig, decodeReport, validate, sameConfig, ConfigClient, isConfigDevice, DEVICE_FILTERS } from '../protocol.mjs';

const defaults = () => ({
  buttons: { green: 2, red: 3, yellow: 4, blue: 5, orange: 6, strum_up: 7, strum_down: 8,
    start: 9, back: 10, tilt: 11, guide: 12 }, mode_gpio: 13,
  whammy: { gpio: 26, enabled: false, inverted: false, min: 0, max: 4095, deadzone: 32 },
});
function response(config, status = 0, id = 2) {
  const payload = encodeConfig(config);
  payload[1] = status;
  return new DataView(Uint8Array.from([id, ...payload]).buffer);
}
function simulated(replies, send = async () => {}) {
  let time = 0;
  const device = { opened: true, sendFeatureReport: send,
    receiveFeatureReport: async id => typeof replies === 'function' ? replies(id) : replies.shift() };
  const client = new ConfigClient(device, { now: () => time, sleep: async ms => { time += ms; }, timeout: 100 });
  return { device, client };
}

test('wire bytes match firmware and no report ID is prepended to payload', () => {
  const bytes = encodeConfig(defaults());
  assert.deepEqual([...bytes], [1, 0, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 26, 0, 0, 0, 255, 15, 32, 0, 0, 0]);
  assert.deepEqual(decodeReport(bytes).config, defaults());
});
test('accepts OS report ID and preserves DataView offset', () => {
  const bytes = new Uint8Array(40);
  bytes.set([2, ...encodeConfig(defaults())], 7);
  assert.deepEqual(decodeReport(new DataView(bytes.buffer, 7, 25)).config, defaults());
  const payloadView = new DataView(bytes.buffer, 8, 24);
  assert.deepEqual(decodeReport(payloadView).config, defaults());
  assert.deepEqual(decodeReport(response(defaults(), 0, 3), 3).config, defaults());
});
test('rejects duplicate/reserved pins, invalid calibration, types and schema', () => {
  for (const mutate of [
    c => { c.buttons.red = 2; }, c => { c.mode_gpio = 2; }, c => { c.buttons.green = 23; },
    c => { c.whammy.gpio = 29; }, c => { c.whammy.max = 4096; },
    c => { c.whammy.min = c.whammy.max; }, c => { c.whammy.deadzone = 4095; },
    c => { c.whammy.enabled = 'yes'; }, c => { c.buttons.red = '3'; },
    c => { c.buttons.other = 17; }, c => { c.whammy.extra = 0; }, c => { c.extra = 0; },
  ]) {
    const config = defaults(); mutate(config);
    assert.ok(validate(config).length > 0);
    assert.throws(() => encodeConfig(config));
  }
  assert.ok(validate(null).length > 0);
});
test('rejects truncated and unsupported reports and nonzero reserved bytes', () => {
  assert.throws(() => decodeReport(new Uint8Array(23)));
  assert.throws(() => decodeReport(response(defaults(), 0, 4)));
  for (const [offset, value] of [[0, 2], [1, 4], [15, 4], [23, 1]]) {
    const bytes = encodeConfig(defaults()); bytes[offset] = value;
    assert.throws(() => decodeReport(bytes));
  }
});
test('handles non-default ADC endpoints and inversion without truncation', () => {
  const config = defaults();
  config.whammy = { gpio: 28, enabled: true, inverted: true, min: 237, max: 3815, deadzone: 50 };
  assert.deepEqual(decodeReport(encodeConfig(config)).config, config);
  assert.equal(encodeConfig(config)[15], 3);
});
test('saves using WebHID conventions and waits for Ready matching the request', async () => {
  const target = defaults(); target.whammy.min = 180;
  let sent;
  const { client } = simulated([response(defaults()), response(defaults(), 1), response(target)],
    async (id, payload) => { sent = { id, payload }; });
  assert.deepEqual(await client.save(target), target);
  assert.equal(sent.id, 2);
  assert.equal(sent.payload.byteLength, 24);
  assert.deepEqual([...sent.payload], [...encodeConfig(target)]);
});
test('reset reads actual compiled defaults then confirms those values', async () => {
  const actualDefaults = defaults(); actualDefaults.buttons.green = 0;
  const requests = [];
  let configReads = 0;
  const { client } = simulated(id => id === 3 ? response(actualDefaults, 0, 3) :
    response(++configReads === 1 ? defaults() : actualDefaults),
    async (id, data) => { requests.push({ id, data: [...data] }); });
  assert.deepEqual(await client.reset(), actualDefaults);
  assert.deepEqual(requests, [{ id: 2, data: [1, 1, ...Array(22).fill(0)] }]);
});
test('flash error and invalid status never become success', async () => {
  for (const status of [2, 3]) {
    const { client } = simulated([response(defaults(), status)]);
    await assert.rejects(() => client.save(defaults()), status === 2 ? /rejeitada/ : /flash/);
  }
});
test('times out if the Pico keeps its previous configuration', async () => {
  const { client } = simulated(() => response(defaults()));
  const changed = defaults(); changed.mode_gpio = 14;
  await assert.rejects(() => client.save(changed), /não foi confirmada/);
});
test('disconnect and concurrent operations are rejected', async () => {
  let finish;
  const { device, client } = simulated(() => new Promise(resolve => { finish = resolve; }));
  const pending = client.read();
  await assert.rejects(() => client.save(defaults()), /Aguarde/);
  client.cancel(); device.opened = false; finish(response(defaults()));
  await assert.rejects(() => pending, /desconectado/);
  assert.equal(client.busy, false);
});
test('hung transfer times out and requires reconnection', async () => {
  const device = { opened: true, receiveFeatureReport: () => new Promise(() => {}) };
  const client = new ConfigClient(device, { transferTimeout: 10 });
  await assert.rejects(() => client.read(), /não respondeu/);
  assert.equal(client.cancelled, true);
  await assert.rejects(() => client.read(), /desconectado/);
});
test('selects only the supported vendor configuration collection', () => {
  const device = { vendorId: 0xcafe, productId: 0x4005,
    collections: [{ usagePage: 0xff00, usage: 1, featureReports: [{ reportId: 2 }] }] };
  assert.ok(isConfigDevice(device));
  assert.equal(isConfigDevice({ ...device, productId: 0x4004 }), false);
  assert.equal(isConfigDevice({ ...device, collections: [{ usagePage: 1, usage: 5 }] }), false);
});
test('sameConfig compares fields independent of JSON key order', () => {
  const config = defaults();
  const reordered = { whammy: config.whammy, mode_gpio: config.mode_gpio, buttons: config.buttons };
  assert.ok(sameConfig(config, reordered));
  assert.equal(sameConfig(config, null), false);
});

test('Tilt button can be disabled without disabling other required buttons', () => {
  const c=defaults(); c.buttons.tilt=255;
  assert.deepEqual(validate(c), []);
  assert.deepEqual(decodeReport(encodeConfig(c)).config, c);
  c.buttons.green=11;
  assert.deepEqual(validate(c), []); // Released tilt GPIO can be reused.
  c.buttons.green=255;
  assert.ok(validate(c).length);
});

test('device chooser and validation only accept CAFE:4005, including Bluetooth',()=>{
  assert.deepEqual(DEVICE_FILTERS,[{vendorId:0xcafe,productId:0x4005,usagePage:0xff00,usage:1}]);
  const ble={vendorId:0,productId:0,collections:[{usagePage:0xff00,usage:1,featureReports:Array.from({length:24},(_,i)=>({reportId:i+2}))}]};
  assert.equal(isConfigDevice(ble),false);
  assert.equal(isConfigDevice({...ble,vendorId:0xcafe,productId:0x4005}),true);
  assert.equal(isConfigDevice({...ble,vendorId:0x046d,productId:0xc53f}),false);
  assert.equal(isConfigDevice({...ble,vendorId:0xcafe,productId:0x4004}),false);
  assert.equal(isConfigDevice({...ble,vendorId:0xbeef,productId:0x4005}),false);
  assert.equal(isConfigDevice({...ble,collections:[{usagePage:1,usage:5,inputReports:[{reportId:1}]}]}),false);
  assert.equal(isConfigDevice({...ble,collections:[{...ble.collections[0],featureReports:[{reportId:2},{reportId:25}]}]}),false);
});
