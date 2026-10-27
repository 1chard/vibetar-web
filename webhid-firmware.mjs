import { translate as tr } from './i18n.mjs';
// Reusable WebHID client for firmware restart and BOOTSEL commands. No external dependencies.
export const FIRMWARE_REPORT = 4;
export const FIRMWARE_PAYLOAD_SIZE = 16;
const MAGIC = [0x58, 0x43, 0x42, 0x54]; // XCBT

export function decodeFirmwareStatus(data) {
  let bytes = data instanceof DataView
    ? new Uint8Array(data.buffer, data.byteOffset, data.byteLength)
    : new Uint8Array(data);
  if (bytes.length === 17 && bytes[0] === FIRMWARE_REPORT) bytes = bytes.subarray(1);
  if (bytes.length !== 16 || MAGIC.some((value, index) => bytes[index] !== value)
      || bytes[4] !== 1 || bytes[5] !== 0 || bytes[6] > 4 || ![1, 3].includes(bytes[7])
      || bytes.slice(10).some(value => value !== 0)) {
    throw new Error(tr("errors.firmwareReport"));
  }
  const delayMs = bytes[8] | bytes[9] << 8;
  if (delayMs !== 1000) throw new Error(tr("errors.restartDelay"));
  return { status: bytes[6], supportsBootsel: true, supportsRestart: Boolean(bytes[7] & 2), delayMs };
}

export function encodeBootselCommand() {
  const bytes = new Uint8Array(FIRMWARE_PAYLOAD_SIZE);
  bytes.set(MAGIC);
  bytes[4] = 1;
  bytes[5] = 1;
  return bytes;
}

export async function readFirmwareStatus(device) {
  if (!device?.opened) throw new Error(tr("errors.connectFirst"));
  return decodeFirmwareStatus(await device.receiveFeatureReport(FIRMWARE_REPORT));
}

// Call only from an explicit UI action, after finishing configuration writes.
// Resolves on PendingBootsel, not on successful firmware programming.
export async function enterBootsel(device) {
  return requestReboot(device, 1);
}

export async function restartDevice(device) {
  return requestReboot(device, 2);
}

async function requestReboot(device, command) {
  const before = await readFirmwareStatus(device);
  if ([1, 4].includes(before.status)) throw new Error(tr("errors.alreadyRestarting"));
  if (command === 2 && !before.supportsRestart) throw new Error(tr("errors.restartUnsupported"));
  const payload = encodeBootselCommand();
  payload[5] = command;
  await device.sendFeatureReport(FIRMWARE_REPORT, payload);
  const deadline = performance.now() + 700;
  while (performance.now() < deadline) {
    const response = await readFirmwareStatus(device);
    if (response.status === (command === 1 ? 1 : 4)) return response;
    if (response.status === 2) throw new Error(tr("errors.bootselRejected"));
    if (response.status === 3) throw new Error(tr("errors.writePending"));
    await new Promise(resolve => setTimeout(resolve, 20));
  }
  throw new Error(tr("errors.bootselUnconfirmed"));
}
