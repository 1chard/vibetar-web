import { setLanguage } from '../i18n.mjs';
setLanguage('pt-BR', { persist: false });
import test from 'node:test';
import assert from 'node:assert/strict';
import { decodeFirmwareStatus, encodeBootselCommand, enterBootsel, restartDevice } from '../webhid-firmware.mjs';

function status(value = 0) {
  return Uint8Array.from([0x58, 0x43, 0x42, 0x54, 1, 0, value, 1, 0xe8, 3, 0, 0, 0, 0, 0, 0]);
}

test('WebHID format, optional report ID and DataView offset', () => {
  assert.deepEqual(decodeFirmwareStatus(status()), { status: 0, supportsBootsel: true, supportsRestart: false, delayMs: 1000 });
  assert.equal(decodeFirmwareStatus(Uint8Array.from([4, ...status(1)])).status, 1);
  const backing = Uint8Array.from([99, 99, ...status(), 99]);
  assert.equal(decodeFirmwareStatus(new DataView(backing.buffer, 2, 16)).status, 0);
  assert.deepEqual([...encodeBootselCommand()], [88, 67, 66, 84, 1, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0]);
});

test('reject malformed status, legacy firmware and unknown version', () => {
  assert.throws(() => decodeFirmwareStatus(new Uint8Array(24)));
  assert.throws(() => decodeFirmwareStatus(Uint8Array.from([5, ...status()])));
  for (const index of [0, 4, 5, 6, 7, 8, 10, 15]) {
    const invalid = status();
    invalid[index] = 0xff;
    assert.throws(() => decodeFirmwareStatus(invalid));
  }
});

test('confirm bootloader command separately from firmware programming', async () => {
  const replies = [status(), status(1)];
  const device = {
    opened: true,
    async receiveFeatureReport(id) { assert.equal(id, 4); return replies.shift(); },
    async sendFeatureReport(id, payload) {
      assert.equal(id, 4);
      assert.deepEqual(payload, encodeBootselCommand());
    },
  };
  assert.equal((await enterBootsel(device)).status, 1);
});

test('busy, invalid and connection loss do not announce success', async () => {
  for (const failure of [2, 3, 'disconnect']) {
    let reads = 0;
    const device = {
      opened: true,
      async sendFeatureReport() {},
      async receiveFeatureReport() {
        if (!reads++) return status();
        if (failure === 'disconnect') throw new Error('disconnected');
        return status(failure);
      },
    };
    await assert.rejects(enterBootsel(device));
  }
  await assert.rejects(enterBootsel({ opened: false }));
});
test('restart requires capability and sends command 2, awaiting status 4', async () => {
  const replies = [status(), status(4)];
  replies.forEach(reply => { reply[7] = 3; });
  const device = { opened: true,
    async receiveFeatureReport() { return replies.shift(); },
    async sendFeatureReport(id, payload) { assert.equal(id, 4); assert.equal(payload[5], 2); },
  };
  assert.equal((await restartDevice(device)).status, 4);
  await assert.rejects(restartDevice({ opened: true, async receiveFeatureReport() { return status(); } }));
});
