import { translate as tr, translatedValues } from './i18n.mjs';
export const EXTRA_KEYS = ['left', 'right', 'solo_modifier', 'solo_green', 'solo_red', 'solo_yellow', 'solo_blue', 'solo_orange'];
export const EXTRA_LABEL_KEYS = ["extras.dpadLeft", "extras.dpadRight", "extras.soloModifier", "extras.soloGreen", "extras.soloRed", "extras.soloYellow", "extras.soloBlue", "extras.soloOrange"];
export const EXTRA_LABELS = translatedValues(EXTRA_LABEL_KEYS);
export const EXTRA_DEFAULTS = { pins: Object.fromEntries(EXTRA_KEYS.map(k => [k, 255])), pickup: { gpio: 255, inverted: false, min: 0, max: 4095 } };
export function validateExtras(e, base) {
  if (!e || Object.keys(e).sort().join() !== 'pickup,pins' || !e.pins || Object.keys(e.pins).sort().join() !== [...EXTRA_KEYS].sort().join() ||
      !e.pickup || !['gpio,inverted,max,min','gpio,inverted,max,min,values'].includes(Object.keys(e.pickup).sort().join())) return [tr("validation.extrasSchema")];
  const errors = [], used = new Map();
  if (base) {
    for (const [name, pin] of Object.entries(base.buttons)) used.set(pin, name);
    used.set(base.mode_gpio, 'MODE');
  }
  EXTRA_KEYS.forEach((key, i) => {
    const pin = e.pins[key]; if (pin === 255) return;
    if (!Number.isInteger(pin) || pin < 0 || pin > 22) errors.push(tr("validation.optionalGpio", EXTRA_LABELS[i]));
    else if (used.has(pin)) errors.push(tr("validation.gpioConflict", pin, used.get(pin), EXTRA_LABELS[i]));
    else used.set(pin, EXTRA_LABELS[i]);
  });
  const p = e.pickup;
  if (p.values !== undefined && (!Array.isArray(p.values) || p.values.length !== 5 ||
      p.values.some(x => !Number.isInteger(x) || x < 0 || x > 4095) || new Set(p.values).size !== 5))
    errors.push(tr("validation.effectsReferences"));
  if (![255,26,27,28].includes(p.gpio)) errors.push(tr("validation.effectsGpio"));
  if (p.gpio !== 255 && base?.whammy.enabled && base.whammy.gpio === p.gpio) errors.push(tr("validation.effectsWhammyConflict"));
  if (typeof p.inverted !== 'boolean' || !Number.isInteger(p.min) || !Number.isInteger(p.max) || p.min < 0 || p.max > 4095 || p.min >= p.max)
    errors.push(tr("validation.effectsRange"));
  return errors;
}
export function encodeExtras(e, base) {
  const errors = validateExtras(e, base); if (errors.length) throw new Error(errors.join(' '));
  const b = new Uint8Array(24), v = new DataView(b.buffer); b[0] = 1;
  EXTRA_KEYS.forEach((k, i) => { b[2 + i] = e.pins[k]; });
  b[10] = e.pickup.gpio; b[11] = Number(e.pickup.inverted);
  v.setUint16(12, e.pickup.min, true); v.setUint16(14, e.pickup.max, true);
  if (e.pickup.values) { b[0]=2; e.pickup.values.forEach((value,i)=>v.setUint16(12+i*2,value,true)); }
  return b;
}
export function decodeExtras(data, id = 7) {
  let b = ArrayBuffer.isView(data) ? new Uint8Array(data.buffer, data.byteOffset, data.byteLength) : new Uint8Array(data);
  if (b.length === 25 && b[0] === id) b = b.subarray(1);
  if (b.length !== 24 || ![1,2].includes(b[0]) || b[1] > 3 || b[11] > 1 || b.subarray(b[0]===2?22:16).some(x => x)) throw new Error(tr("errors.extrasReport"));
  const v = new DataView(b.buffer, b.byteOffset, b.byteLength);
  const extras = { pins: Object.fromEntries(EXTRA_KEYS.map((k, i) => [k, b[2 + i]])),
    pickup: { gpio: b[10], inverted: Boolean(b[11]), min: v.getUint16(12, true), max: v.getUint16(14, true) } };
  if(b[0]===2) Object.assign(extras.pickup,{min:0,max:4095,values:Array.from({length:5},(_,i)=>v.getUint16(12+i*2,true))});
  const errors = validateExtras(extras); if (errors.length) throw new Error(errors.join(' '));
  return { extras, status: b[1] };
}
export function pickupIndex(raw, p) {
  if (p.values) {
    let nearest=0;
    for(let i=1;i<5;++i) if(Math.abs(raw-p.values[i])<Math.abs(raw-p.values[nearest])) nearest=i;
    return p.inverted ? 4-nearest : nearest;
  }
  const value=Math.max(p.min,Math.min(p.max,raw));
  const normalized=Math.floor((p.inverted?p.max-value:value-p.min)*65535/(p.max-p.min));
  return Math.min(4,Math.floor(normalized*5/65536));
}
export function sameExtras(a, b) {
  if (!a || !b || validateExtras(a).length || validateExtras(b).length) return false;
  const x = encodeExtras(a), y = encodeExtras(b); return x.every((v, i) => v === y[i]);
}
export async function readExtras(client) {
  return client.exclusive(async () => decodeExtras(await client.transfer(() => client.device.receiveFeatureReport(7))));
}
export async function saveExtras(client, extras, base) {
  const payload = encodeExtras(extras, base), expected = decodeExtras(payload).extras;
  return client.exclusive(async () => {
    await client.transfer(() => client.device.sendFeatureReport(7, payload));
    const deadline = client.now() + client.timeout;
    do {
      const result = decodeExtras(await client.transfer(() => client.device.receiveFeatureReport(7)));
      if (result.status >= 2) throw new Error(result.status === 2 ? tr("errors.extrasRejected") : tr("errors.flashWrite"));
      if (!result.status && sameExtras(result.extras, expected)) return result.extras;
      await client.sleep(30);
    } while (client.now() < deadline);
    throw new Error(tr("errors.extrasUnconfirmed"));
  });
}
