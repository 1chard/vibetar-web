import { translate as tr, translatedValues } from './i18n.mjs';
export const DEVICE_FILTER = { vendorId: 0xcafe, productId: 0x4005, usagePage: 0xff00, usage: 1 };
// Match both identifiers in the browser chooser; filters are ORed, so a
// collection-only fallback would also expose unrelated vendor HID devices.
export const DEVICE_FILTERS = [DEVICE_FILTER];
export const CONFIG_REPORT = 2;
export const DEFAULTS_REPORT = 3;
export const PAYLOAD_SIZE = 24;
export const BUTTONS = [
  { key: 'green', labelKey: "common.green", get label() { return tr("common.green"); }, color: '#34a66b', group: 'frets' },
  { key: 'red', labelKey: "common.red", get label() { return tr("common.red"); }, color: '#df5655', group: 'frets' },
  { key: 'yellow', labelKey: "common.yellow", get label() { return tr("common.yellow"); }, color: '#d8a02d', group: 'frets' },
  { key: 'blue', labelKey: "common.blue", get label() { return tr("common.blue"); }, color: '#4984da', group: 'frets' },
  { key: 'orange', labelKey: "common.orange", get label() { return tr("common.orange"); }, color: '#e68a3f', group: 'frets' },
  { key: 'strum_up', labelKey: "controls.strumUp", get label() { return tr("controls.strumUp"); }, group: 'controls' },
  { key: 'strum_down', labelKey: "controls.strumDown", get label() { return tr("controls.strumDown"); }, group: 'controls' },
  { key: 'start', labelKey: "controls.start", get label() { return tr("controls.start"); }, group: 'controls' },
  { key: 'back', labelKey: "controls.back", get label() { return tr("controls.back"); }, group: 'controls' },
  { key: 'tilt', labelKey: "controls.tilt", get label() { return tr("controls.tilt"); }, group: 'controls' },
  { key: 'guide', labelKey: "controls.guide", get label() { return tr("controls.guide"); }, group: 'controls' },
];
export const STATUS = translatedValues(["status.ready", "status.writing", "status.rejected", "status.flashError"]);

export function validate(config) {
  const errors = [];
  if (!config || typeof config !== 'object' || Array.isArray(config) ||
      Object.keys(config).sort().join(',') !== 'buttons,mode_gpio,whammy') {
    return [tr("validation.configSchema")];
  }
  if (!config.buttons || typeof config.buttons !== 'object' || Array.isArray(config.buttons) ||
      Object.keys(config.buttons).sort().join(',') !== BUTTONS.map(b => b.key).sort().join(',')) {
    return [tr("validation.buttonSchema")];
  }
  const pins = new Map();
  for (const { key, label } of [...BUTTONS, { key: 'mode_gpio', label: tr("controls.switchMode") }]) {
    const value = key === 'mode_gpio' ? config.mode_gpio : config.buttons[key];
    if (key === 'tilt' && value === 255) continue;
    if (!Number.isInteger(value) || value < 0 || value > 22) errors.push(tr("validation.digitalGpio", label));
    else if (pins.has(value)) errors.push(tr("validation.duplicateGpio", value, pins.get(value), label));
    else pins.set(value, label);
  }
  const w = config.whammy;
  if (!w || typeof w !== 'object' || Array.isArray(w) || Object.keys(w).sort().join(',') !== 'deadzone,enabled,gpio,inverted,max,min') {
    errors.push(tr("validation.whammySchema"));
    return errors;
  }
  if (!Number.isInteger(w.gpio) || w.gpio < 26 || w.gpio > 28) errors.push(tr("validation.whammyGpio"));
  if (typeof w.enabled !== 'boolean' || typeof w.inverted !== 'boolean') errors.push(tr("validation.whammyBooleans"));
  for (const [key, label] of [['min', tr("common.minimum")], ['max', tr("common.maximum")], ['deadzone', tr("common.deadZone")]]) {
    if (!Number.isInteger(w[key]) || w[key] < 0 || w[key] > 4095) errors.push(tr("validation.adcInteger", label));
  }
  if (w.min >= w.max) errors.push(tr("validation.whammyRange"));
  if (w.deadzone >= w.max - w.min) errors.push(tr("validation.whammyDeadZone"));
  return errors;
}

export function encodeConfig(config) {
  const errors = validate(config);
  if (errors.length) throw new Error(errors.join(' '));
  const data = new Uint8Array(PAYLOAD_SIZE);
  const view = new DataView(data.buffer);
  data[0] = 1;
  BUTTONS.forEach(({ key }, i) => { data[2 + i] = config.buttons[key]; });
  data[13] = config.mode_gpio;
  data[14] = config.whammy.gpio;
  data[15] = Number(config.whammy.enabled) | Number(config.whammy.inverted) << 1;
  view.setUint16(16, config.whammy.min, true);
  view.setUint16(18, config.whammy.max, true);
  view.setUint16(20, config.whammy.deadzone, true);
  return data; // WebHID takes report ID separately; never prepend it when sending.
}

export function decodeReport(buffer, reportId = CONFIG_REPORT) {
  let bytes;
  if (ArrayBuffer.isView(buffer)) bytes = new Uint8Array(buffer.buffer, buffer.byteOffset, buffer.byteLength);
  else if (buffer instanceof ArrayBuffer) bytes = new Uint8Array(buffer);
  else throw new Error(tr("errors.hidResponse"));
  // receiveFeatureReport preserves OS bytes; some platforms include the report ID.
  if (bytes.length === PAYLOAD_SIZE + 1 && bytes[0] === reportId) bytes = bytes.subarray(1);
  if (bytes.length !== PAYLOAD_SIZE || bytes[0] !== 1 || bytes[1] > 3 ||
      (bytes[15] & ~3) || bytes[22] || bytes[23]) throw new Error(tr("errors.firmwareVersion"));
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const config = {
    buttons: Object.fromEntries(BUTTONS.map(({ key }, i) => [key, bytes[2 + i]])),
    mode_gpio: bytes[13],
    whammy: { gpio: bytes[14], enabled: Boolean(bytes[15] & 1), inverted: Boolean(bytes[15] & 2),
      min: view.getUint16(16, true), max: view.getUint16(18, true), deadzone: view.getUint16(20, true) },
  };
  const errors = validate(config);
  if (errors.length) throw new Error(errors.join(' '));
  return { config, status: bytes[1] };
}

export function sameConfig(a, b) {
  if (!a || !b || validate(a).length || validate(b).length) return false;
  const first = encodeConfig(a), second = encodeConfig(b);
  return first.every((byte, i) => byte === second[i]);
}

export function isConfigDevice(device) {
  if(device.vendorId!==DEVICE_FILTER.vendorId || device.productId!==DEVICE_FILTER.productId)return false;
  return device.collections?.some(c => c.usagePage === DEVICE_FILTER.usagePage && c.usage === DEVICE_FILTER.usage &&
    c.featureReports?.some(r => r.reportId === CONFIG_REPORT)) ?? false;
}
export function describeHidDevice(device){
  return {name:device.productName || tr("diagnostics.unnamed"),
    vendorId:device.vendorId,productId:device.productId,
    collections:(device.collections||[]).map(c=>({usagePage:c.usagePage,usage:c.usage,
      inputReports:(c.inputReports||[]).map(r=>r.reportId),
      featureReports:(c.featureReports||[]).map(r=>r.reportId)})),
    compatible:isConfigDevice(device)};
}

export class ConfigClient {
  constructor(device, { now = () => performance.now(), sleep = ms => new Promise(resolve => setTimeout(resolve, ms)),
    timeout = 4000, transferTimeout = 3000 } = {}) {
    this.device = device;
    this.now = now;
    this.sleep = sleep;
    this.timeout = timeout;
    this.transferTimeout = transferTimeout;
    this.busy = false;
    this.cancelled = false;
  }
  assertConnected() {
    if (this.cancelled || !this.device.opened) throw new Error(tr("errors.disconnected"));
  }
  cancel() { this.cancelled = true; }
  async transfer(operation) {
    this.assertConnected();
    let timer;
    try {
      const result = await Promise.race([operation(), new Promise((_, reject) => {
        timer = setTimeout(() => {
          this.cancelled = true; // Do not overlap a timed-out HID request with another operation.
          reject(new Error(tr("errors.transferTimeout")));
        }, this.transferTimeout);
      })]);
      this.assertConnected();
      return result;
    } finally { clearTimeout(timer); }
  }
  async exclusive(operation) {
    if (this.busy) throw new Error(tr("errors.operationBusy"));
    this.busy = true;
    try { this.assertConnected(); return await operation(); }
    finally { this.busy = false; }
  }
  async readRaw(reportId = CONFIG_REPORT) {
    return decodeReport(await this.transfer(() => this.device.receiveFeatureReport(reportId)), reportId);
  }
  async read() { return this.exclusive(() => this.readRaw()); }
  async confirm(expected) {
    const deadline = this.now() + this.timeout;
    do {
      const result = await this.readRaw();
      if (result.status >= 2) throw new Error(STATUS[result.status]);
      if (result.status === 0 && sameConfig(result.config, expected)) return result.config;
      await this.sleep(30);
    } while (this.now() < deadline);
    throw new Error(tr("errors.configUnconfirmed"));
  }
  async save(config) {
    // Snapshot before async I/O so editing the form cannot change verification.
    const payload = encodeConfig(config);
    const expected = decodeReport(payload).config;
    return this.exclusive(async () => {
      await this.transfer(() => this.device.sendFeatureReport(CONFIG_REPORT, payload));
      return this.confirm(expected);
    });
  }
  async reset() {
    return this.exclusive(async () => {
      const { config: defaults } = await this.readRaw(DEFAULTS_REPORT);
      const payload = new Uint8Array(PAYLOAD_SIZE);
      payload[0] = 1;
      payload[1] = 1;
      await this.transfer(() => this.device.sendFeatureReport(CONFIG_REPORT, payload));
      return this.confirm(defaults);
    });
  }
}
