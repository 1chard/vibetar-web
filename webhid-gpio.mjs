import { translate as tr } from './i18n.mjs';
export const GPIO_REPORT = 5;
export const GPIO_SCAN_REPORT = 6;
export function decodeGpio(data) {
  let bytes = ArrayBuffer.isView(data)
    ? new Uint8Array(data.buffer, data.byteOffset, data.byteLength) : new Uint8Array(data);
  if (bytes.length === 21 && bytes[0] === GPIO_REPORT) bytes = bytes.subarray(1);
  if (bytes.length === 31 && bytes[0] === GPIO_SCAN_REPORT) bytes = bytes.subarray(1);
  const fullScan = bytes.length === 30 && bytes[4] === 2;
  if ((!fullScan && !(bytes.length === 20 && bytes[4] === 1)) || bytes[0] !== 88 || bytes[1] !== 67 || bytes[2] !== 71
      || bytes[3] !== 80 || bytes[5] > 1) throw new Error(tr("errors.gpioState"));
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const activeMask = view.getUint32(8, true), configuredMask = view.getUint32(12, true);
  if ((!fullScan && (activeMask & ~configuredMask)) || (activeMask & ~0x7fffff) ||
      (configuredMask & ~0x1c7fffff) || view.getUint16(6, true) > 0x7ff ||
      view.getUint16(16, true) > 4095) throw new Error(tr("errors.gpioStateInvalid"));
  const snapshot = { activeMask, configuredMask, buttons: view.getUint16(6, true),
    adcEnabled: Boolean(bytes[5]), rawAdc: view.getUint16(16, true), whammy: view.getUint16(18, true) };
  if (fullScan) {
    const monitoredMask = view.getUint32(20, true);
    const adcValues = [24, 26, 28].map(offset => view.getUint16(offset, true));
    if (monitoredMask !== 0x7fffff || adcValues.some(value => value > 4095)) throw new Error(tr("errors.gpioScan"));
    Object.assign(snapshot, { fullScan: true, monitoredMask, adcValues });
  }
  return snapshot;
}
export async function readGpio(device) {
  const fullScan = device.collections?.some(collection => collection.usagePage === 0xff00 && collection.usage === 1 &&
    collection.featureReports?.some(report => report.reportId === GPIO_SCAN_REPORT));
  return decodeGpio(await device.receiveFeatureReport(fullScan ? GPIO_SCAN_REPORT : GPIO_REPORT));
}
