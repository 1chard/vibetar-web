import { translate as tr, bindText, applyTranslations, getLanguage, setLanguage, onLanguageChange } from './i18n.mjs';
import { decodePreview, previewPressed } from './webhid-preview.mjs';
import { decodeDiscovery, connectGuitar, decodeReceiverHealth, receiverHealthText, decodeBluetoothLink, bluetoothLinkText } from './webhid-discovery.mjs';
import { readTransport, readRole } from './webhid-transport.mjs';
import { validateBluetooth, sameBluetooth, readBluetooth, saveBluetooth, decodeBluetoothLive, bluetoothCommand, bluetoothDiagnosticText, bluetoothStatusText } from './webhid-bluetooth.mjs';
import { validateBattery, sameBattery, readBattery, saveBattery, decodeBatteryLive } from './webhid-battery.mjs';
import { validateOutputs, sameOutputs, outputEventMask, readOutputs, saveOutputs, decodeOutputsLive } from './webhid-outputs.mjs';
import { validateHost, sameHost, readHost, saveHost, decodeHostLive } from './webhid-host.mjs';
import { TILT_DEFAULTS, validateTilt, sameTilt, readTilt, saveTilt, decodeTiltLive } from './webhid-tilt.mjs';
import { EXTRA_KEYS, EXTRA_LABELS, EXTRA_LABEL_KEYS, EXTRA_DEFAULTS, pickupIndex, validateExtras, sameExtras, readExtras, saveExtras } from './webhid-extras.mjs';
import { BUTTONS, DEVICE_FILTERS, describeHidDevice, STATUS, ConfigClient, isConfigDevice, validate, sameConfig } from './protocol.mjs';

import { readFirmwareStatus, restartDevice, enterBootsel } from './webhid-firmware.mjs';
import { readGpio } from './webhid-gpio.mjs';

const $ = id => document.getElementById(id);
let previewState=null,previewTimer=null;
const PREVIEW_FRETS=[['0',"common.green",'#35815c'],['1',"common.red",'#c45555'],['2',"common.yellow",'#ddba3a'],['3',"common.blue",'#447bb9'],['4',"common.orange",'#df853c']];
const PREVIEW_KEYS=[...PREVIEW_FRETS,['5',"preview.strumUp"],['6',"preview.strumDown"],['left',"preview.dpadLeft"],['right',"preview.dpadRight"],['7',"controls.start"],['8',"preview.back"],['9',"preview.tilt"],['10',"controls.guide"],...PREVIEW_FRETS.map(([key,label,color])=>['solo-'+key,label,color])];
for(const [key,label,color] of PREVIEW_KEYS){
  const element=document.createElement('span');element.className='preview-key';element.dataset.key=key;bindText(element,label);
  if(color)element.style.setProperty('--key-color',color);
  const group=key.startsWith('solo-')?'preview-solo':Number(key)<5?'preview-frets':'preview-controls';$(group).append(element);
}
function renderPreview(){
  const online=connected(),available=online&&hasFeature(33),state=available?previewState:null;
  $('preview-source').textContent=state?.source==='receiver'?tr("preview.bluetoothSource"):online&&firmwareRole==='receiver'?tr("common.receiver"):tr("preview.guitarInputs");
  $('preview-status').textContent=!online?tr("preview.connect"):!available?tr("preview.updateFirmware"):!state?tr("preview.waiting"):!state.fresh?tr("preview.stale"):state.source==='receiver'?tr("preview.receiverHelp"):tr("preview.guitarHelp");
  for(const element of document.querySelectorAll('#controller-preview .preview-key')){
    const pressed=previewPressed(state,element.dataset.key);element.classList.toggle('active',pressed);
    element.title=element.textContent+(pressed?tr("common.pressedSuffix"):tr("common.releasedSuffix"));
  }
  const whammy=state?.fresh?state.whammy:0;$('preview-whammy').value=whammy;$('preview-whammy-value').textContent=Math.round(whammy/65535*100)+'%';
  const pickup=state?.fresh?[23,75,121,171,224].indexOf(state.pickup)+1:0;
  $('preview-pickup').textContent=tr("preview.effectsPrefix")+(pickup?tr("common.positionPrefix")+pickup:tr("common.disabledLower"));
}
function startPreview(){
  async function poll(){
    if(!connected())return;
    const observedDevice=device;
    if(!document.hidden && !busy && !client.busy && !expectedDisconnect && hasFeature(33)){
      const owner=client,selected=device;
      try{const state=await owner.exclusive(async()=>decodePreview(await owner.transfer(()=>selected.receiveFeatureReport(33))));if(device===selected){previewState=state;renderPreview();}}
      catch{if(device===selected){previewState=null;renderPreview();}}
    }
    if(connected()&&device===observedDevice)previewTimer=setTimeout(poll,transport==='bluetooth'?200:75);
  }
  previewTimer=setTimeout(poll,0);
}
const pinFields = new Map();
let draft = null, saved = null, client = null, device = null;
let transport='usb',firmwareRole='guitar',discoveryLive=null,receiverHealth=null,bluetoothLink=null;
let hostDraft=null, hostSaved=null, hostStatus=0, hostLive=null;
let bluetoothDraft=null,bluetoothSaved=null,bluetoothStatus=0,bluetoothLive=null;
let batteryDraft=null,batterySaved=null,batteryStatus=0,batteryLive=null; bluetoothLive=null;
let outputsDraft=null, outputsSaved=null, outputsStatus=0, outputsLive=null;
let tiltDraft = null, tiltSaved = null, tiltStatus = 0, tiltLive = null;
let extrasDraft = null, extrasSaved = null, extrasStatus = 0;
let busy = false, deviceStatus = 0, activePin = null;
let firmwareInfo = null, live = null, liveRead = null, liveTimer = null, expectedDisconnect = null;
const supported = window.isSecureContext && 'hid' in navigator;

function addPinField(key, label, container, color) {
  const wrapper = document.createElement('label');
  wrapper.className = 'field';
  const heading = document.createElement('span');
  heading.className = 'field-label';
  if (color) {
    const dot = document.createElement('span');
    dot.className = 'color-dot';
    dot.style.setProperty('--fret-color', color);
    heading.append(dot);
  }
  heading.append(bindText(document.createElement('span'), label));
  const select = document.createElement('select');
  select.id = `gpio-${key}`;
  select.setAttribute('data-i18n-aria-label', label);select.setAttribute('aria-label', tr(label));
  const placeholder = new Option('—', '');
  placeholder.disabled = true;
  select.add(placeholder);
  if (key === 'tilt') select.add(bindText(new Option('', '255'), "controls.noTiltButton"));
  for (let i = 0; i <= 22; i++) select.add(new Option(`GP${i}`, String(i)));
  select.value = '';
  wrapper.append(heading, select);
  container.append(wrapper);
  pinFields.set(key, select);
  select.addEventListener('focus', () => { activePin = Number(select.value); renderMap(); });
  select.addEventListener('blur', () => { activePin = null; renderMap(); });
}

BUTTONS.forEach(({ key, labelKey, group, color }) => addPinField(key, labelKey, $(group === 'frets' ? 'frets' : 'controls'), color));
addPinField('mode_gpio', "controls.nextUsbMode", $('controls'));
for (const pin of [...Array.from({ length: 23 }, (_, i) => i), 26, 27, 28]) {
  const cell = document.createElement('span');
  cell.className = 'pin-cell';
  cell.textContent = `GP${pin}`;
  cell.dataset.pin = pin;
  $('pin-map').append(cell);
}

function message(text, kind = '') {
  $('message').hidden = !text;
  $('message').className = `message ${kind}`;
  $('message').textContent = text;
}
function connected() { return device?.opened && client && !client.cancelled; }
function dirty() { return (bluetoothDraft && !sameBluetooth(bluetoothDraft,bluetoothSaved)) || (batteryDraft && !sameBattery(batteryDraft,batterySaved)) || (outputsDraft && !sameOutputs(outputsDraft,outputsSaved)) || (draft && !sameConfig(draft, saved)) || (extrasDraft && !sameExtras(extrasDraft, extrasSaved)) || (tiltDraft && !sameTilt(tiltDraft, tiltSaved)) || (hostDraft && !sameHost(hostDraft,hostSaved)); }
function getForm() {
  if (!draft) return null;
  const buttons = Object.fromEntries(BUTTONS.map(({ key }) => [key, Number(pinFields.get(key).value)]));
  return { buttons, mode_gpio: Number(pinFields.get('mode_gpio').value), whammy: {
    gpio: Number($('whammy-gpio').value), enabled: $('whammy-enabled').checked,
    inverted: $('whammy-inverted').checked, min: $('whammy-min').valueAsNumber,
    max: $('whammy-max').valueAsNumber, deadzone: $('whammy-deadzone').valueAsNumber,
  } };
}
function fillForm(config) {
  draft = structuredClone(config);
  BUTTONS.forEach(({ key }) => { pinFields.get(key).value = config.buttons[key]; });
  pinFields.get('mode_gpio').value = config.mode_gpio;
  $('whammy-gpio').value = config.whammy.gpio;
  $('whammy-enabled').checked = config.whammy.enabled;
  $('whammy-inverted').checked = config.whammy.inverted;
  for (const key of ['min', 'max', 'deadzone']) $(`whammy-${key}`).value = config.whammy[key];
  render();
}
function renderMap() {
  const assignments = new Map();
  if (draft) {
    const add = (pin, name) => { assignments.set(pin, [...(assignments.get(pin) ?? []), name]); };
    BUTTONS.forEach(({ key, label }) => { if (draft.buttons[key] !== 255) add(draft.buttons[key], label); });
    add(draft.mode_gpio, tr("controls.switchMode"));
    outputsDraft?.rules.forEach((r,i)=>{if(r.gpio!==255)add(r.gpio,tr("outputs.numberedOutput", i+1));});
    if (draft.whammy.enabled) add(draft.whammy.gpio, tr("common.whammy"));
    if (tiltDraft?.source === 1) add(tiltDraft.adc_gpio, 'Tilt ADC');
    if (tiltDraft?.source === 2) { add(tiltDraft.sda, 'ADXL345 SDA'); add(tiltDraft.scl, 'ADXL345 SCL'); }
    if (extrasDraft) {
      EXTRA_KEYS.forEach((k, i) => { if (extrasDraft.pins[k] !== 255) add(extrasDraft.pins[k], EXTRA_LABELS[i]); });
      if (extrasDraft.pickup.gpio !== 255) add(extrasDraft.pickup.gpio, tr("extras.rockBandEffects"));
    }
  }
  document.querySelectorAll('.pin-cell').forEach(cell => {
    const pin = Number(cell.dataset.pin), labels = assignments.get(pin) ?? [];
    cell.className = `pin-cell${pin >= 26 ? ' analog' : ''}${labels.length ? ' used' : ''}${labels.length > 1 ? ' conflict' : ''}${pin === activePin ? ' highlight' : ''}${live && (live.activeMask & (1 << pin)) ? ' active' : ''}`;
    cell.title = `GP${pin}: ${labels.length ? labels.join(', ') : tr("gpio.freeLower")}${live && (live.activeMask & (1 << pin)) ? tr("gpio.lowSuffix") : ''}`;
    if (live?.fullScan && pin <= 22) {
      const level = (live.activeMask & (1 << pin)) ? 0 : 1;
      cell.title += tr("gpio.levelReadSuffix", level);
      cell.textContent = `GP${pin}`;
      const value = document.createElement('small'); value.className = 'gpio-level';
      value.textContent = tr("gpio.level", level); cell.append(value);
    } else if (live?.fullScan && pin >= 26) {
      const adc = live.adcValues[pin - 26];
      cell.title += ` · ADC ${adc}/4095`;
      cell.textContent = `GP${pin}`;
      const value = document.createElement('small'); value.className = 'gpio-level';
      value.textContent = String(adc); cell.append(value);
    } else cell.textContent = `GP${pin}`;
    cell.setAttribute('aria-label', cell.title);
  });
}
function render() {
  const online = connected();
  const errors = draft ? [...validate(draft), ...(extrasSaved ? validateExtras(extrasSaved, draft) : []), ...(tiltSaved ? validateTilt(tiltSaved, draft, extrasSaved) : []), ...(outputsSaved ? validateOutputs(outputsSaved,draft,extrasSaved,tiltSaved) : [])] : [];
  renderPreview(); renderExtras(); renderTilt(); renderHost(); renderOutputs(); renderBattery(); renderBluetooth();
  $('editor-fields').disabled = busy || Boolean(expectedDisconnect) || !draft;
  $('connect').hidden = Boolean(online);
  $('connect').disabled = busy || !supported;
  $('diagnose-hid').disabled = busy || !supported;
  $('disconnect').hidden = !online;
  $('disconnect').disabled = busy;
  $('read').disabled = !online || busy || Boolean(expectedDisconnect);
  $('save').disabled = !online || busy || Boolean(expectedDisconnect) || !draft || errors.length > 0 || sameConfig(draft, saved) || deviceStatus === 1;
  $('reset').disabled = !online || busy || Boolean(expectedDisconnect) || deviceStatus === 1;
  $('restart').disabled = !online || busy || deviceStatus === 1 || !firmwareInfo?.supportsRestart || Boolean(expectedDisconnect);
  $('bootsel').disabled = !online || busy || deviceStatus === 1 || !firmwareInfo?.supportsBootsel || Boolean(expectedDisconnect);
  $('import').disabled = busy;
  $('export').disabled = busy || !draft || errors.length > 0 || Boolean(extrasDraft && validateExtras(extrasDraft, draft).length) || Boolean(tiltDraft && validateTilt(tiltDraft,draft,extrasDraft).length) || Boolean(hostDraft && validateHost(hostDraft).length) || Boolean(outputsDraft && validateOutputs(outputsDraft,draft,extrasDraft,tiltDraft).length) || Boolean(batteryDraft && validateBattery(batteryDraft).length) || Boolean(bluetoothDraft && validateBluetooth(bluetoothDraft).length);
  $('connection-title').textContent = online ? (device.productName || tr("connection.picoConnected")) : tr("connection.title");
  $('connection-badge').textContent = online ? tr("connection.hidConnected") : tr("connection.disconnected");
  $('connection-badge').className = `status-badge${online ? ' connected' : ''}`;
  $('connection-description').textContent = online ? tr("connection.ready", transport==='bluetooth'?'Bluetooth HID':'USB HID') : tr("connection.help");
  $('validation').replaceChildren();
  $('validation').hidden = errors.length === 0;
  if (errors.length) {
    const list = document.createElement('ul');
    errors.forEach(error => { const item = document.createElement('li'); item.textContent = error; list.append(item); });
    $('validation').append(list);
  }
  let state = tr("state.waiting"), description = tr("state.readFirst");
  if (busy) { state = tr("state.busy"); description = tr("state.keepConnected"); }
  else if (errors.length) { state = tr("state.review"); description = tr("state.correctValues"); }
  else if (draft && !online) { state = tr("state.localDraft"); description = tr("state.connectToSave"); }
  else if (deviceStatus === 1 && online) { state = tr("state.writing"); description = tr("state.waitAndRead"); }
  else if (draft && !sameConfig(draft, saved)) { state = tr("state.unsaved"); description = tr("state.saveHelp"); }
  else if (extrasDraft && !sameExtras(extrasDraft, extrasSaved)) { state = tr("state.unsavedExtras"); description = tr("state.saveExtrasHelp"); }
  else if (bluetoothDraft && !sameBluetooth(bluetoothDraft,bluetoothSaved) && hasBluetooth()) {state=tr("state.unsavedBluetooth");description=tr("state.saveBluetoothHelp");}
  else if (batteryDraft && !sameBattery(batteryDraft,batterySaved)) {state=tr("state.unsavedBattery");description=tr("state.saveBatteryHelp");}
  else if (outputsDraft && !sameOutputs(outputsDraft, outputsSaved)) { state = tr("state.unsavedOutputs"); description = tr("state.saveOutputsHelp"); }
  else if (tiltDraft && !sameTilt(tiltDraft, tiltSaved)) { state = tr("state.unsavedTilt"); description = tr("state.saveTiltHelp"); }
  else if (hostDraft && !sameHost(hostDraft,hostSaved)) { state = tr("state.unsavedHost"); description = tr("state.saveHostHelp"); }
  else if (draft && online) { state = tr("state.synchronized"); description = tr("state.synchronizedHelp"); }
  $('save-state').textContent = state;
  $('save-description').textContent = description;
  const w = draft?.whammy;
  const validRange = w && Number.isFinite(w.min) && Number.isFinite(w.max) && w.min < w.max;
  $('calibration-range').style.left = validRange ? `${w.min / 4095 * 100}%` : '0';
  $('calibration-range').style.width = validRange ? `${(w.max - w.min) / 4095 * 100}%` : '0';
  renderMap();
}

async function confirm(title, description, button = tr("common.continue")) {
  const dialog = $('confirm-dialog');
  $('dialog-title').textContent = title;
  $('dialog-description').textContent = description;
  $('dialog-confirm').textContent = button;
  return new Promise(resolve => {
    function cleanup(answer) {
      $('dialog-cancel').removeEventListener('click', cancel);
      $('dialog-confirm').removeEventListener('click', accept);
      dialog.removeEventListener('cancel', cancel);
      dialog.close();
      resolve(answer);
    }
    const cancel = () => cleanup(false), accept = () => cleanup(true);
    $('dialog-cancel').addEventListener('click', cancel);
    $('dialog-confirm').addEventListener('click', accept);
    dialog.addEventListener('cancel', cancel);
    dialog.showModal();
  });
}
async function allowReplace() {
  return !dirty() || confirm(tr("dialog.discardTitle"), tr("dialog.discardHelp"));
}
async function operation(action) {
  if (busy) return;
  busy = true;
  message('');
  render();
  try { if (liveRead) await liveRead; await action(); }
  catch (error) {
    if (error.name === 'NotFoundError') message(tr("connection.noDevice"));
    else message(error.message || tr("errors.hidOperation"), 'error');
    if (client?.cancelled) {
      const old = device;
      client = null; device = null;
      if (old?.opened) void old.close().catch(() => {});
    }
  } finally { busy = false; render(); }
}
function acceptRead(result) {
  saved = structuredClone(result.config);
  deviceStatus = result.status;
  fillForm(result.config);
  if (result.status !== 0) message(tr("state.activeConfigWarning", STATUS[result.status]), result.status >= 2 ? 'error' : '');
}

$('connect').addEventListener('click', async () => {
  if (!await allowReplace()) return;
  await operation(async () => {
    const devices = await navigator.hid.requestDevice({ filters: DEVICE_FILTERS });
    const selected = devices.find(isConfigDevice);
    if (!selected) throw new Error(tr("connection.selectCollection"));
    if (!selected.opened) await selected.open();
    device = selected;
    client = new ConfigClient(selected);
    try {
      transport=await readTransport(client);
      firmwareRole=await readRole(client);discoveryLive=null;receiverHealth=null;bluetoothLink=null;
      acceptRead(await client.read());
      expectedDisconnect = null;
      await discoverExtensions();
      await refreshExtras();
      await refreshTilt();
      await refreshHost();
      await refreshOutputs();
      await refreshBattery();
      await refreshBluetooth();
      startMonitor();
      if (deviceStatus === 0) message(tr("connection.readSuccess", transport==='bluetooth'?'Bluetooth HID':'USB HID'), 'success');
    } catch (error) {
      client?.cancel(); client = null; device = null;
      if (selected.opened) await selected.close().catch(() => {});
      throw error;
    }
  });
});
$('diagnose-hid').addEventListener('click',()=>operation(async()=>{
  // Explicit diagnostic selection. Inspect descriptors only; never open or write.
  const devices=await navigator.hid.requestDevice({filters:DEVICE_FILTERS.map(({vendorId,productId})=>({vendorId,productId}))});
  if(!devices.length){message(tr("connection.noHid"));return;}
  const reports=devices.map(describeHidDevice);
  $('hid-diagnostic').hidden=false;
  $('hid-diagnostic-output').textContent=JSON.stringify(reports,null,2);
  message(reports.some(r=>r.compatible)?tr("connection.collectionFound"):tr("connection.missingCollection"),reports.some(r=>r.compatible)?'success':'error');
}));
$('disconnect').addEventListener('click', () => operation(async () => {
  const old = device;
  stopMonitor(); firmwareInfo = null;
  client.cancel(); client = null; device = null;
  await old.close();
  message(tr("connection.draftKept"));
}));
$('read').addEventListener('click', async () => {
  if (!await allowReplace()) return;
  await operation(async () => {
    acceptRead(await client.read());
    await refreshExtras();
    await refreshTilt();
    await refreshHost();
      await refreshOutputs();
      await refreshBattery();
      await refreshBluetooth();
    if (deviceStatus === 0) message(tr("config.readSuccess"), 'success');
  });
});
$('config-form').addEventListener('input', () => { draft = getForm(); activePin = document.activeElement?.tagName === 'SELECT' ? Number(document.activeElement.value) : null; render(); });
$('config-form').addEventListener('submit', event => {
  event.preventDefault();
  if ($('save').disabled) return;
  void operation(async () => {
    const config = await client.save(draft);
    saved = structuredClone(config); deviceStatus = 0;
    fillForm(config);
    message(tr("config.saveSuccess"), 'success');
  });
});
$('reset').addEventListener('click', async () => {
  if (!await confirm(tr("dialog.resetTitle"), firmwareRole==='receiver'?tr("dialog.resetReceiverHelp"):tr("dialog.resetGuitarHelp"), tr("dialog.resetConfirm"))) return;
  await operation(async () => {
    const config = await client.reset();
    if(transport==='bluetooth'){expectBluetoothDisconnect('disabled');saved=structuredClone(config);deviceStatus=0;fillForm(config);message(tr("config.resetBluetoothOff"), 'success');return;}
    saved = structuredClone(config); deviceStatus = 0; fillForm(config);
    await refreshExtras();
    await refreshTilt();
    await refreshHost();
      await refreshOutputs();
      await refreshBattery();
      await refreshBluetooth();
    message(tr("config.resetSuccess"), 'success');
  });
});
$('import').addEventListener('click', () => { $('import-file').value = ''; $('import-file').click(); });
$('import-file').addEventListener('change', async event => {
  const file = event.target.files[0];
  if (!file || busy) return;
  try {
    if (file.size > 65536) throw new Error(tr("errors.jsonTooLarge"));
    const imported = JSON.parse(await file.text());
    const { extras, tilt, host, outputs, battery, bluetooth, ...config } = imported;
    const errors = [...validate(config), ...(extras ? validateExtras(extras, config) : []), ...(tilt ? validateTilt(tilt, config, extras) : []), ...(host ? validateHost(host) : []), ...(outputs ? validateOutputs(outputs,config,extras,tilt) : []), ...(battery ? validateBattery(battery) : []), ...(bluetooth ? validateBluetooth(bluetooth) : [])];
    if (errors.length) throw new Error(errors.join(' '));
    if(bluetooth&&!hasBluetooth()) throw new Error(tr("errors.bluetoothRequiresPicoW"));
    if (!await allowReplace()) return;
    fillForm(config);
    if (extras) fillExtras(extras);
    if (tilt) fillTilt(tilt);
    if (host) fillHost(host);
    if (outputs) fillOutputs(outputs);
    if (battery) fillBattery(battery);
    if (bluetooth) fillBluetooth(bluetooth);
    message(tr("config.importSuccess"));
  } catch (error) { message(error.message, 'error'); }
});
$('export').addEventListener('click', () => {
  const url = URL.createObjectURL(new Blob([JSON.stringify({ ...draft, ...(extrasDraft ? {extras:extrasDraft} : {}), ...(tiltDraft ? {tilt:tiltDraft} : {}), ...(hostDraft ? {host:hostDraft} : {}), ...(outputsDraft ? {outputs:outputsDraft} : {}), ...(batteryDraft ? {battery:batteryDraft} : {}), ...(bluetoothDraft && hasBluetooth() ? {bluetooth:bluetoothDraft} : {}) }, null, 2) + '\n'], { type: 'application/json' }));
  const link = document.createElement('a');
  link.href = url; link.download = 'vibetar-config.json';
  document.body.append(link); link.click(); link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
  message(tr("config.exportSuccess"));
});
if ('hid' in navigator) navigator.hid.addEventListener('disconnect', event => {
  if (event.device !== device) return;
  stopMonitor(); firmwareInfo = null;
  client?.cancel(); client = null; device = null;
  if (expectedDisconnect) {
    message(expectedDisconnect === 'restart' ? tr("device.restarting") : expectedDisconnect === 'bootsel' ? tr("device.bootselRequested") : expectedDisconnect === 'disabled' ? tr("bluetooth.disabledUseUsb") : expectedDisconnect === 'pair' ? tr("bluetooth.pairingDisconnected") : expectedDisconnect === 'forget' ? tr("bluetooth.bondsDeleted") : tr("bluetooth.reconnect"));
    expectedDisconnect = null;
  } else message(tr("connection.lost"), 'error');
  render();
});
window.addEventListener('beforeunload', event => {
  if (dirty() || busy) { event.preventDefault(); event.returnValue = ''; }
});
EXTRA_KEYS.forEach((key, i) => {
  const label = document.createElement('label'); label.className = 'field';
  label.append(bindText(document.createElement('span'), EXTRA_LABEL_KEYS[i]));
  const select = document.createElement('select'); select.id = `extra-${key}`;
  select.add(bindText(new Option('', '255'), "common.disabled"));
  for (let pin = 0; pin <= 22; ++pin) select.add(new Option(`GP${pin}`, String(pin)));
  label.append(select); $('extras-digital').append(label);
});
for (let i=0;i<5;++i) {
  const label=document.createElement('label');label.className='field';
  label.append(bindText(document.createElement('span'), "extras.positionAdc", i+1));
  const input=document.createElement('input');input.id=`pickup-value-${i}`;
  input.type='number';input.min=0;input.max=4095;input.step=1;
  input.value=[0,1024,2048,3071,4095][i];
  const button=document.createElement('button');button.type='button';button.className='button secondary';
  button.id=`pickup-capture-${i}`;bindText(button,"extras.captureAdc");
  button.addEventListener('click',()=>{
    const p=extrasDraft?.pickup;
    if(!live?.fullScan || ![26,27,28].includes(p?.gpio))return;
    input.value=live.adcValues[p.gpio-26];input.dispatchEvent(new Event('input',{bubbles:true}));
  });
  label.append(input,button);$('pickup-values').append(label);
}
function fillExtras(extras) {
  extrasDraft = structuredClone(extras);
  EXTRA_KEYS.forEach(k => { $(`extra-${k}`).value = extras.pins[k]; });
  $('pickup-gpio').value = extras.pickup.gpio; $('pickup-inverted').checked = extras.pickup.inverted;
  $('pickup-min').value = extras.pickup.min; $('pickup-max').value = extras.pickup.max;
  $('pickup-calibrated').checked=Boolean(extras.pickup.values);
  (extras.pickup.values??[0,1024,2048,3071,4095]).forEach((value,i)=>{$(`pickup-value-${i}`).value=value;});
  render();
}
async function refreshExtras() {
  if (!hasFeature(7)) { extrasDraft = null; extrasSaved = null; render(); return; }
  const result = await readExtras(client);
  extrasSaved = structuredClone(result.extras); extrasStatus = result.status; fillExtras(result.extras);
}
function renderExtras() {
  const available = connected() && hasFeature(7);
  $('extras-fields').disabled = busy || Boolean(expectedDisconnect) || !extrasDraft;
  const errors = extrasDraft ? [...validateExtras(extrasDraft, saved), ...(tiltSaved ? validateTilt(tiltSaved, saved, extrasDraft) : []), ...(outputsSaved ? validateOutputs(outputsSaved,saved,extrasDraft,tiltSaved) : [])] : [];
  $('extras-validation').hidden = !errors.length;
  $('extras-validation').textContent = errors.join(' ');
  $('extras-save').disabled = !available || busy || Boolean(expectedDisconnect) || !extrasDraft || errors.length > 0 || extrasStatus === 1;
  $('extras-clear').disabled = !available || busy || Boolean(expectedDisconnect) || extrasStatus === 1;
  $('extras-note').textContent = !available ? tr("extras.updateToSave") :
    extrasStatus ? STATUS[extrasStatus] + tr("common.readAgainSuffix") : sameExtras(extrasDraft, extrasSaved) ? tr("extras.synchronized") : tr("extras.unsaved");
  const p = extrasDraft?.pickup;
  $('pickup-values-fields').hidden=!$('pickup-calibrated').checked;
  $('pickup-min').disabled=$('pickup-calibrated').checked;
  $('pickup-max').disabled=$('pickup-calibrated').checked;
  for(let i=0;i<5;++i) $(`pickup-capture-${i}`).disabled=busy || Boolean(expectedDisconnect) || !live?.fullScan || ![26,27,28].includes(p?.gpio);

  if (p && p.gpio !== 255 && live?.fullScan && !validateExtras(extrasDraft).length) {
    const raw = live.adcValues[p.gpio - 26];
    $('extras-live').textContent = tr("extras.liveEffects", raw, pickupIndex(raw,p) + 1);
  } else $('extras-live').textContent = p?.gpio === 255 ? tr("extras.effectsDisabled") : tr("extras.waitingAdc");
}
$('extras-fields').addEventListener('input', () => {
  extrasDraft = { pins: Object.fromEntries(EXTRA_KEYS.map(k => [k, Number($(`extra-${k}`).value)])),
    pickup: { gpio: Number($('pickup-gpio').value), inverted: $('pickup-inverted').checked,
      min: $('pickup-min').valueAsNumber, max: $('pickup-max').valueAsNumber } };
  if($('pickup-calibrated').checked) Object.assign(extrasDraft.pickup,{
    min:0,max:4095,values:Array.from({length:5},(_,i)=>$(`pickup-value-${i}`).valueAsNumber)
  });
  render();
});
$('extras-save').addEventListener('click', () => {
  if ($('extras-save').disabled) return;
  void operation(async () => {
    const extras = await saveExtras(client, extrasDraft, saved);
    extrasSaved = structuredClone(extras); extrasStatus = 0; fillExtras(extras);
    message(tr("extras.saveSuccess"), 'success');
  });
});
$('extras-clear').addEventListener('click', () => {
  if ($('extras-clear').disabled) return;
  void operation(async () => {
    const extras = await saveExtras(client, EXTRA_DEFAULTS, saved);
    extrasSaved = structuredClone(extras); extrasStatus = 0; fillExtras(extras);
    message(tr("extras.disableSuccess"), 'success');
  });
});
for (let sda=0; sda<=20; sda+=2) $('tilt-i2c').add(new Option(`GP${sda} SDA / GP${sda+1} SCL`, String(sda)));
function fillTilt(t) {
  tiltDraft=structuredClone(t);
  for (const [id,key] of [['source','source'],['adc','adc_gpio'],['i2c','sda'],['address','address'],['axis','axis'],['threshold','threshold'],['hysteresis','hysteresis']]) $(`tilt-${id}`).value=t[key];
  $('tilt-below').value=Number(t.below); render();
}
function tiltForm() {
  const sda=Number($('tilt-i2c').value);
  return {source:Number($('tilt-source').value),adc_gpio:Number($('tilt-adc').value),sda,scl:sda+1,address:Number($('tilt-address').value),axis:Number($('tilt-axis').value),below:$('tilt-below').value==='1',threshold:$('tilt-threshold').valueAsNumber,hysteresis:$('tilt-hysteresis').valueAsNumber};
}
async function refreshTilt() {
  tiltLive=null;
  if(!hasFeature(9)){tiltDraft=null;tiltSaved=null;render();return;}
  const result=await readTilt(client);tiltSaved=structuredClone(result.tilt);tiltStatus=result.status;fillTilt(result.tilt);
}
function renderTilt() {
  const available=connected()&&hasFeature(9), t=tiltDraft;
  $('tilt-fields').disabled=busy||Boolean(expectedDisconnect)||!t;
  const errors=t?[...validateTilt(t,saved,extrasSaved), ...(outputsSaved?validateOutputs(outputsSaved,saved,extrasSaved,t):[])]:[];
  $('tilt-validation').hidden=!errors.length; $('tilt-validation').textContent=errors.join(' ');
  $('tilt-save').disabled=!available||busy||Boolean(expectedDisconnect)||!t||errors.length>0||tiltStatus===1;
  $('tilt-note').textContent=!available?tr("tilt.updateFirmware"):tiltStatus?STATUS[tiltStatus]+tr("common.readAgainSuffix"):sameTilt(t,tiltSaved)?tr("tilt.synchronized"):tr("tilt.unsaved");
  $('tilt-adc-fields').hidden=t?.source!==1;$('tilt-i2c-fields').hidden=t?.source!==2;$('tilt-threshold-fields').hidden=!t||t.source===0;
  const mg=t?.source===2;
  $('tilt-unit').textContent=mg?tr("tilt.thresholdMg"):tr("tilt.thresholdAdc");
  $('tilt-threshold').min=mg?-16000:0;$('tilt-threshold').max=mg?16000:4095;
  $('tilt-help').textContent=t?.source===0?tr("tilt.digitalHelp"):mg?tr("tilt.accelerometerHelp"):tr("tilt.adcHelp");
  $('tilt-live').textContent=!connected()||!tiltLive?tr("tilt.noReading"):!tiltLive.valid?tr("tilt.sensorInvalid"):tr("tilt.liveState", tiltLive.active?tr("common.activeUpper"):tr("common.inactive"), tiltLive.value, tiltLive.source===2?' mili-g':tiltLive.source===1?' ADC':'');
  renderAccelerometer();
}
let accelerometerReading=null;
function renderAccelerometer() {
  $('accelerometer-panel').hidden = !$('accelerometer-show').checked;
  const available = connected() && hasFeature(11);
  // Layout follows the saved sensor configuration, not each polling result.
  const sensor = available && tiltSaved?.source === 2;
  const valid = sensor && tiltLive?.source === 2 && tiltLive.valid;
  if(!sensor || accelerometerReading?.device!==device) accelerometerReading=null;
  if(valid) accelerometerReading={device,axes:[...tiltLive.axes],at:performance.now()};
  const recent=accelerometerReading && performance.now()-accelerometerReading.at<=1000;
  const axes=valid?tiltLive.axes:recent?accelerometerReading.axes:null;
  $('accelerometer-status').textContent = !connected()
    ? tr("accelerometer.connect")
    : !available ? tr("accelerometer.unavailable")
    : !sensor ? tr("accelerometer.selectSensor")
    : valid ? tr("accelerometer.liveSaved")
    : recent ? tr("accelerometer.interrupted")
    : !tiltLive ? tr("accelerometer.waiting")
    : tr("accelerometer.invalid");
  for (const [index, axis] of ['x', 'y', 'z'].entries()) {
    const value=axes?.[index]??null;
    $(`accelerometer-${axis}`).textContent=value===null?'—':`${value} mili-g`;
    const meter=$(`accelerometer-${axis}-meter`);
    meter.value=value??0;
    meter.hidden=!sensor;
    meter.style.opacity=valid?'1':'0.4';
    meter.title=valid?tr("accelerometer.currentReading"):recent?tr("accelerometer.lastReading"):tr("accelerometer.noValidReading");
  }
}
$('accelerometer-show').addEventListener('change', renderAccelerometer);
$('tilt-fields').addEventListener('input', event=>{
  if(event.target.id==='tilt-source'){
    $('tilt-threshold').value=Number(event.target.value)===2?600:2000;$('tilt-hysteresis').value=100;
  }
  tiltDraft=tiltForm();render();
});
$('tilt-save').addEventListener('click',()=>{
  if($('tilt-save').disabled)return;
  void operation(async()=>{
    const t=await saveTilt(client,tiltDraft,saved,extrasSaved);tiltSaved=structuredClone(t);tiltStatus=0;tiltLive=null;fillTilt(t);
    message(tr("tilt.saveSuccess"), 'success');
  });
});
function fillHost(c){hostDraft=structuredClone(c);$('host-policy').value=c.policy;$('host-boot').value=Number(c.boot_rock_band);render();}
async function refreshHost(){
  hostLive=null;
  if(!hasFeature(12)){hostDraft=null;hostSaved=null;render();return;}
  const r=await readHost(client);hostSaved=structuredClone(r.host);hostStatus=r.status;fillHost(r.host);
}
function renderHost(){
  const available=connected()&&hasFeature(12), errors=hostDraft?validateHost(hostDraft):[];
  $('host-fields').disabled=busy||Boolean(expectedDisconnect)||!hostDraft;
  $('host-save').disabled=!available||busy||Boolean(expectedDisconnect)||!hostDraft||errors.length>0||hostStatus===1;
  $('host-validation').hidden=!errors.length;$('host-validation').textContent=errors.join(' ');
  $('host-note').textContent=!available?tr("host.updateFirmware"):hostStatus?STATUS[hostStatus]+tr("common.readAgainSuffix"):sameHost(hostDraft,hostSaved)?tr("host.synchronized"):tr("host.unsaved");
  $('host-live').textContent=!connected()||!hostLive?tr("host.noReading"):tr("host.liveState", [tr("host.unknown"),tr("host.likelyWindows"),tr("host.likelyXbox")][hostLive.kind], [tr("mode.hid"),tr("mode.guitarHero"),tr("mode.rockBand")][hostLive.mode], hostLive.limited?tr("host.xinputOnlyLower"):tr("host.allModesAvailable"), hostLive.recovery?tr("host.forcedHidSuffix"):'');
}
$('host-fields').addEventListener('input',()=>{hostDraft={policy:Number($('host-policy').value),boot_rock_band:$('host-boot').value==='1'};render();});
$('host-save').addEventListener('click',()=>{
  if($('host-save').disabled)return;
  void operation(async()=>{
    const c=await saveHost(client,hostDraft);hostSaved=structuredClone(c);hostStatus=0;fillHost(c);
    message(tr("host.saveSuccess"), 'success');
  });
});


const LED_EVENTS=[[1,"outputs.usbEvent"],[2,"outputs.lowBatteryEvent"],[4,"outputs.searchingEvent"],[8,"outputs.pairingEvent"],[16,"outputs.connectedEvent"],[32,"outputs.waitingEvent"]];
for(let i=0;i<3;++i){
  const row=document.createElement('div');row.className='output-row';
  row.innerHTML=`<h3>LED ${i+1}</h3><div class="control-fields"><label class="field"><span data-i18n="outputs.gpio">GPIO de saída</span><select id="output-${i}-gpio"><option value="255" data-i18n="common.disabled">Desativado</option><option value="254" data-i18n="outputs.onboardOption">LED embutido · Pico / Pico W</option></select></label><label class="field"><span data-i18n="outputs.usbModes">Modos USB</span><select id="output-${i}-modes"><option value="1" data-i18n="mode.hid">HID</option><option value="2">Guitar Hero · XInput</option><option value="4">Rock Band · XInput</option><option value="6" data-i18n="outputs.bothXinput">Ambos os modos XInput</option><option value="7" data-i18n="outputs.allModes">Todos os modos</option><option value="0" data-i18n="outputs.noMode">Nenhum modo</option><option value="3" data-i18n="outputs.hidGuitarHero">HID e Guitar Hero</option><option value="5" data-i18n="outputs.hidRockBand">HID e Rock Band</option></select></label><label class="field"><span data-i18n="outputs.polarity">Polaridade</span><select id="output-${i}-low"><option value="0" data-i18n="outputs.activeHigh">Acende com nível alto · 3V3</option><option value="1" data-i18n="outputs.activeLow">Acende com nível baixo · GND</option></select></label></div><fieldset><legend><span data-i18n="outputs.eventsLegend">Eventos · pode marcar vários</span></legend>${LED_EVENTS.map(([bit,label])=>`<label class="checkbox-label"><input id="output-${i}-event-${bit}" type="checkbox"><span data-i18n="${label}">${tr(label)}</span></label>`).join('')}</fieldset>`;
  applyTranslations(row);$('outputs-rows').append(row);for(let pin=0;pin<=22;++pin)$(`output-${i}-gpio`).add(new Option(`GP${pin}`,String(pin)));
}
function fillOutputs(c){
  outputsDraft=structuredClone(c);
  c.rules.forEach((r,i)=>{
    $(`output-${i}-gpio`).value=r.gpio;$(`output-${i}-modes`).value=r.modes;$(`output-${i}-low`).value=Number(r.active_low);
    const mask=outputEventMask(r);for(const [bit] of LED_EVENTS)$(`output-${i}-event-${bit}`).checked=Boolean(mask&bit);
  });render();
}
async function refreshOutputs(){
  outputsLive=null;
  if(!hasFeature(15)){outputsDraft=null;outputsSaved=null;render();return;}
  const r=await readOutputs(client);outputsSaved=structuredClone(r.outputs);outputsStatus=r.status;fillOutputs(r.outputs);
}
function renderOutputs(){
  const available=connected()&&hasFeature(15),errors=outputsDraft?validateOutputs(outputsDraft,saved,extrasSaved,tiltSaved):[];
  if(outputsDraft?.rules.some(r=>Boolean(outputEventMask(r)&2))&&!hasFeature(18))errors.push(tr("outputs.updateBatteryEvent"));
  if(outputsDraft?.rules.some(r=>Boolean(outputEventMask(r)&60))&&!hasFeature(21))errors.push(tr("outputs.updateBluetoothEvents"));
  for(let i=0;i<3;++i){
    const builtin=Number($(`output-${i}-gpio`).value)===254;
    $(`output-${i}-low`).disabled=builtin;
    if(builtin)$(`output-${i}-low`).value='0';
    $(`output-${i}-event-2`).disabled=!hasFeature(18)&&!$(`output-${i}-event-2`).checked;
    for(const bit of [4,8,16,32])$(`output-${i}-event-${bit}`).disabled=!hasFeature(21)&&!$(`output-${i}-event-${bit}`).checked;
    $(`output-${i}-modes`).disabled=!$(`output-${i}-event-1`).checked;
  }
  $('outputs-fields').disabled=busy||Boolean(expectedDisconnect)||!outputsDraft;
  $('outputs-save').disabled=!available||busy||Boolean(expectedDisconnect)||!outputsDraft||errors.length>0||outputsStatus===1;
  $('outputs-validation').hidden=!errors.length;$('outputs-validation').textContent=errors.join(' ');
  $('outputs-note').textContent=!available?tr("outputs.updateFirmware"):outputsStatus?STATUS[outputsStatus]+tr("common.readAgainSuffix"):sameOutputs(outputsDraft,outputsSaved)?tr("outputs.synchronized"):tr("outputs.unsaved");
  $('outputs-live').textContent=!connected()||!outputsLive?tr("outputs.noReading"):outputsLive.rules.map((r,i)=>`LED ${i+1}: ${r.enabled?`${r.gpio===254?tr("outputs.onboardLed"):'GP'+r.gpio} · ${r.active?tr("outputs.on"):tr("outputs.off")}${r.brightness===undefined?tr("gpio.levelSuffix", r.high?1:0):tr("outputs.brightnessSuffix", Math.round(r.brightness*100/255))}`:tr("common.disabledLower")}`).join(' | ');
}
$('outputs-fields').addEventListener('input',()=>{
  outputsDraft={rules:[0,1,2].map(i=>({gpio:Number($(`output-${i}-gpio`).value),modes:Number($(`output-${i}-modes`).value),event:128|LED_EVENTS.reduce((mask,[bit])=>mask|($(`output-${i}-event-${bit}`).checked?bit:0),0),active_low:Number($(`output-${i}-gpio`).value)!==254 && $(`output-${i}-low`).value==='1'}))};render();
});
$('outputs-save').addEventListener('click',()=>{
  if($('outputs-save').disabled)return;
  void operation(async()=>{const c=await saveOutputs(client,outputsDraft,saved,extrasSaved,tiltSaved);outputsSaved=structuredClone(c);outputsStatus=0;outputsLive=null;fillOutputs(c);message(tr("outputs.saveSuccess"), 'success');});
});


function fillBattery(c){
  batteryDraft=structuredClone(c);$('battery-enabled').checked=c.enabled;
  for(const [id,key] of [['threshold','threshold_mv'],['hysteresis','hysteresis_mv'],['diode','diode_mv']])$(`battery-${id}`).value=c[key];render();
}
async function refreshBattery(){
  batteryLive=null; bluetoothLive=null;
  if(!hasFeature(18)){batteryDraft=null;batterySaved=null;render();return;}
  const r=await readBattery(client);batterySaved=structuredClone(r.battery);batteryStatus=r.status;fillBattery(r.battery);
}
function renderBattery(){
  const available=connected()&&hasFeature(18),errors=batteryDraft?validateBattery(batteryDraft):[];
  $('battery-fields').disabled=busy||Boolean(expectedDisconnect)||!batteryDraft;
  $('battery-save').disabled=!available||busy||Boolean(expectedDisconnect)||!batteryDraft||errors.length>0||batteryStatus===1;
  $('battery-validation').hidden=!errors.length;$('battery-validation').textContent=errors.join(' ');
  $('battery-note').textContent=!available?tr("battery.updateFirmware"):batteryStatus?STATUS[batteryStatus]+tr("common.readAgainSuffix"):sameBattery(batteryDraft,batterySaved)?tr("battery.synchronized"):tr("battery.unsaved");
  const r=connected()?batteryLive:null,volts=mv=>(mv/1000).toFixed(3)+' V';
  $('battery-live-status').textContent=!r?tr("battery.noReading"):!r.enabled?tr("battery.monitorDisabled"):r.error||!r.source_known?tr("battery.readingUnavailable"):r.usb?tr("battery.usbPresent"):!r.valid?tr("battery.waiting"):r.low?tr("battery.lowWarning"):tr("battery.aboveThreshold");
  $('battery-live-voltage').textContent=tr("battery.liveVoltage", r?.valid?volts(r.vsys_mv):'—', r?.valid&&r.source_known&&!r.usb?volts(r.battery_mv):'—');
}
$('battery-fields').addEventListener('input',()=>{
  batteryDraft={enabled:$('battery-enabled').checked,threshold_mv:$('battery-threshold').valueAsNumber,hysteresis_mv:$('battery-hysteresis').valueAsNumber,diode_mv:$('battery-diode').valueAsNumber};render();
});
$('battery-save').addEventListener('click',()=>{
  if($('battery-save').disabled)return;
  void operation(async()=>{const c=await saveBattery(client,batteryDraft);batterySaved=structuredClone(c);batteryStatus=0;batteryLive=null; bluetoothLive=null;fillBattery(c);message(tr("battery.saveSuccess"), 'success');});
});

if (!supported) {
  $('compatibility').hidden = false;
  $('compatibility').textContent = !window.isSecureContext ? tr("compatibility.secureContext") : tr("compatibility.unsupportedBrowser");
}
render();


function hasFeature(id) {
  return device?.collections.some(collection => collection.usagePage === 0xff00 && collection.usage === 1 && collection.featureReports?.some(report => report.reportId === id));
}
function firmwareAdapter() {
  const owner = client, selected = device;
  return {
    get opened() { return selected?.opened && !owner.cancelled; },
    receiveFeatureReport(id) { return owner.transfer(() => selected.receiveFeatureReport(id)); },
    sendFeatureReport(id, data) { return owner.transfer(() => selected.sendFeatureReport(id, data)); },
  };
}
async function discoverExtensions() {
  firmwareInfo = null;
  if (hasFeature(4)) {
    try { firmwareInfo = await client.exclusive(() => readFirmwareStatus(firmwareAdapter())); }
    catch (error) { $('device-tools-note').textContent = error.message; }
  }
  if (firmwareInfo) {
    $('device-tools-note').textContent = tr("device.commandsHelp");
    if ([1, 4].includes(firmwareInfo.status)) expectedDisconnect = firmwareInfo.status === 1 ? 'bootsel' : 'restart';
  } else $('device-tools-note').textContent = tr("device.updateFirmware");
}
function stopMonitor() {
  clearTimeout(previewTimer);previewTimer=null;previewState=null;renderPreview();
  clearTimeout(liveTimer); liveTimer = null; live = null; tiltLive = null; hostLive=null; outputsLive=null; batteryLive=null; bluetoothLive=null; renderTilt(); renderHost(); renderOutputs(); renderBattery(); renderBluetooth();
  $('live-status').textContent = tr("gpio.noReading");
  $('live-active').textContent = tr("gpio.connect");
  $('live-adc').textContent = tr("gpio.emptyAdc"); $('adc-meter').value = 0;
  renderMap();
}
function showLive(snapshot) {
  live = snapshot; renderExtras(); renderTilt(); renderHost(); renderOutputs(); renderBattery(); renderBluetooth();
  $('live-status').textContent = snapshot.fullScan ? tr("gpio.allPins", transport==='bluetooth'?'Bluetooth':'USB') : tr("gpio.mappedOnly");
  const pins = Array.from({ length: 23 }, (_, pin) => pin).filter(pin => snapshot.activeMask & (1 << pin));
  $('live-active').textContent = pins.length ? tr("gpio.lowPrefix") + pins.map(pin => `GP${pin}`).join(' · ') : (snapshot.fullScan ? tr("gpio.allHigh") : tr("gpio.nonePressed"));
  $('live-adc').textContent = snapshot.adcEnabled ? `ADC: ${snapshot.rawAdc} / 4095 · Whammy: ${Math.round(snapshot.whammy / 65535 * 100)}%` : tr("gpio.whammyDisabled");
  $('adc-meter').value = snapshot.rawAdc;
  renderMap();
}
function startMonitor() {
  stopMonitor();
  startPreview();
  if (!hasFeature(5) && !hasFeature(6)) {
    $('live-status').textContent = tr("gpio.updateFirmware");
    return;
  }
  async function poll() {
    if (!connected()) return;
    if (!busy && !client.busy && !expectedDisconnect && !document.hidden) {
      const owner = client, selected = device;
      liveRead = owner.exclusive(async () => {
          const snapshot=await owner.transfer(() => readGpio(selected));
          if(hasFeature(14)) hostLive=decodeHostLive(await owner.transfer(()=>selected.receiveFeatureReport(14)));
          if(hasFeature(32))bluetoothLink=decodeBluetoothLink(await owner.transfer(()=>selected.receiveFeatureReport(32)));
          if(firmwareRole==='receiver' && hasFeature(31))receiverHealth=decodeReceiverHealth(await owner.transfer(()=>selected.receiveFeatureReport(31)));
          if(firmwareRole==='receiver' && hasFeature(29))discoveryLive=decodeDiscovery(await owner.transfer(()=>selected.receiveFeatureReport(29)));
          if(hasBluetooth()) bluetoothLive=decodeBluetoothLive(await owner.transfer(()=>selected.receiveFeatureReport(23)));
          if(hasFeature(20)) batteryLive=decodeBatteryLive(await owner.transfer(()=>selected.receiveFeatureReport(20)));
          if(hasFeature(17)) outputsLive=decodeOutputsLive(await owner.transfer(()=>selected.receiveFeatureReport(17)));
          if(hasFeature(11)) tiltLive=decodeTiltLive(await owner.transfer(()=>selected.receiveFeatureReport(11)));
          return snapshot;
        })
        .then(snapshot => { if (device === selected) showLive(snapshot); })
        .catch(error => {
          if (device === selected) {
            previewState=null;renderPreview();live = null; tiltLive = null; hostLive=null; outputsLive=null; batteryLive=null; bluetoothLive=null; renderTilt(); renderHost(); renderOutputs(); renderBattery(); renderBluetooth(); renderMap();
            $('live-status').textContent = error.message;
            $('live-active').textContent = tr("gpio.readingUnavailable");
            $('live-adc').textContent = tr("gpio.emptyAdc"); $('adc-meter').value = 0;
          }
        });
      await liveRead; liveRead = null;
      if (device !== selected) return;
      if (owner.cancelled) { stopMonitor(); render(); return; }
    }
    liveTimer = setTimeout(poll, transport==='bluetooth'?500:200);
  }
  liveTimer = setTimeout(poll, 0);
}
async function reboot(kind) {
  if ($(kind === 'restart' ? 'restart' : 'bootsel').disabled) return;
  // The editor's saved values stay on the Pico; local drafts stay in the page.
  await operation(async () => {
    const target = device;
    await client.exclusive(() => kind === 'restart' ? restartDevice(firmwareAdapter()) : enterBootsel(firmwareAdapter()));
    expectedDisconnect = kind;
    clearTimeout(liveTimer); live = null; tiltLive = null; hostLive=null; outputsLive=null; batteryLive=null; bluetoothLive=null; renderTilt(); renderHost(); renderOutputs(); renderBattery(); renderBluetooth(); renderMap();
    message(kind === 'restart' ? tr("device.restartConfirmed") : tr("device.bootselConfirmed"), 'success');
    // Release editor state after the reboot window, even without a disconnect event.
    setTimeout(() => {
      if (device !== target || expectedDisconnect !== kind) return;
      stopMonitor(); firmwareInfo = null; expectedDisconnect = null;
      client?.cancel(); client = null; device = null;
      if (target.opened) void target.close().catch(() => {});
      render();
    }, 1800);
  });
}
$('restart').addEventListener('click', () => void reboot('restart'));
$('bootsel').addEventListener('click', () => void reboot('bootsel'));

document.addEventListener('visibilitychange', () => {
  if (document.hidden && connected()) {
    previewState=null;renderPreview();live = null; tiltLive = null; hostLive=null; outputsLive=null; batteryLive=null; bluetoothLive=null; renderTilt(); renderHost(); renderOutputs(); renderBattery(); renderBluetooth(); renderMap();
    $('live-status').textContent = tr("gpio.monitorPaused");
    $('live-active').textContent = tr("gpio.waiting");
    $('live-adc').textContent = tr("gpio.emptyAdc"); $('adc-meter').value = 0;
  }
});

function hasBluetooth(){return connected()&&[21,22,23,24].every(hasFeature);}
function fillBluetooth(c){bluetoothDraft=structuredClone(c);$('bluetooth-enabled').checked=c.enabled;$('bluetooth-priority').checked=c.usb_priority;render();}
async function refreshBluetooth(){bluetoothLive=null;if(!hasBluetooth()){bluetoothDraft=null;bluetoothSaved=null;render();return;}const r=await readBluetooth(client);bluetoothSaved=structuredClone(r.bluetooth);bluetoothStatus=r.status;fillBluetooth(r.bluetooth);}
function renderBluetooth(){
  const available=hasBluetooth();$('bluetooth-card').hidden=!available;
  const receiver=connected()&&firmwareRole==='receiver';
  $('bluetooth-heading').textContent=receiver?tr("bluetooth.receiverTitle"):tr("bluetooth.title");
  $('receiver-note').hidden=!receiver;
  renderDiscovery(receiver);
  $('bluetooth-priority').closest('label').hidden=receiver;
  $('bluetooth-help').hidden=receiver;$('bluetooth-usb-help').hidden=receiver;
  const locked=!available||busy||Boolean(expectedDisconnect)||bluetoothStatus===1;
  $('bluetooth-fields').disabled=locked||!bluetoothDraft;
  $('bluetooth-save').disabled=locked||!bluetoothDraft||validateBluetooth(bluetoothDraft).length>0;
  const live=available?bluetoothLive:null;
  $('bluetooth-copy').disabled=!live;
  for(const id of ['pair','forget','disconnect'])$(`bluetooth-${id}`).disabled=locked||!bluetoothSaved?.enabled||!live?.ready||live.command_status===1;
  $('bluetooth-disconnect').disabled ||= !live?.connected;
  $('bluetooth-note').textContent=bluetoothStatus?STATUS[bluetoothStatus]+tr("common.rereadSuffix"):sameBluetooth(bluetoothDraft,bluetoothSaved)?tr("bluetooth.synchronized"):tr("bluetooth.unsaved");
  $('bluetooth-link').textContent=available?bluetoothLinkText(bluetoothLink):'';
  $('bluetooth-live').textContent=receiver&&live?.error&&receiverHealthText(receiverHealth)?receiverHealthText(receiverHealth):bluetoothStatusText(live,receiver);
  $('bluetooth-details').textContent=live?tr("bluetooth.liveDetails", live.bonds, live.pairing?tr("bluetooth.pairingCountdown", live.pairing_seconds):tr("bluetooth.pairingClosed"), live.interval_ms?tr("bluetooth.intervalSuffix", live.interval_ms):'', bluetoothDiagnosticText(live)?` · ${bluetoothDiagnosticText(live)}`:'', !receiver&&live.connected?tr("bluetooth.linkOccupiedSuffix"):''):'';
}

$('bluetooth-copy').addEventListener('click',async()=>{
  if($('bluetooth-copy').disabled)return;
  const receiver=firmwareRole==='receiver';
  const lines=[
    $('bluetooth-heading').textContent,
    tr("diagnostics.device", device?.productName||tr("brand.name")),
    `Editor: ${transport==='bluetooth'?'Bluetooth HID':'USB HID'}`,
    $('bluetooth-live').textContent,
    $('bluetooth-details').textContent,
    $('bluetooth-link').textContent,
    tr("diagnostics.copiedAt", new Date().toISOString()),
    ...(receiver?[$('receiver-scan-status').textContent]:[]),
    ...(receiver&&receiverHealth?[tr("diagnostics.hidDetails", receiverHealth.security_ready?tr("common.complete"):tr("common.pending"), receiverHealth.hid_ready?tr("common.readyLower"):tr("common.pending"), receiverHealth.reports, receiverHealth.valid_reports, receiverHealth.last_report, receiverHealth.report_length)]:[])
  ];
  // Capture once: live polling must not change the text during clipboard access.
  const snapshot=lines.filter(Boolean).join('\n');
  $('bluetooth-copy-fallback').hidden=true;
  try{
    if(!navigator.clipboard?.writeText)throw new Error('Clipboard unavailable');
    await navigator.clipboard.writeText(snapshot);
    $('bluetooth-copy-status').textContent=tr("diagnostics.copySuccess");
  }catch{
    $('bluetooth-copy-text').value=snapshot;
    $('bluetooth-copy-fallback').hidden=false;
    $('bluetooth-copy-text').focus();$('bluetooth-copy-text').select();
    $('bluetooth-copy-status').textContent=tr("diagnostics.copyManually");
  }
});
$('bluetooth-fields').addEventListener('input',()=>{bluetoothDraft={enabled:$('bluetooth-enabled').checked,usb_priority:$('bluetooth-priority').checked};render();});
$('bluetooth-save').addEventListener('click',()=>{if($('bluetooth-save').disabled)return;void operation(async()=>{const c=await saveBluetooth(client,bluetoothDraft);bluetoothSaved=structuredClone(c);bluetoothStatus=0;fillBluetooth(c);if(transport==='bluetooth'&&!c.enabled)expectBluetoothDisconnect('disabled');message(c.enabled?(firmwareRole==='receiver'?tr("bluetooth.receiverEnabled"):tr("bluetooth.saveEnabled")):tr("bluetooth.saveDisabled"), 'success');});});
for(const [id,command] of [['pair',1],['forget',2],['disconnect',3]])$('bluetooth-'+id).addEventListener('click',async()=>{
  if($('bluetooth-'+id).disabled)return;
  if(command===2&&!await confirm(tr("dialog.forgetBondsTitle"), firmwareRole==='receiver'?tr("dialog.forgetReceiverHelp"):tr("dialog.forgetGuitarHelp"), tr("bluetooth.forgetBonds")))return;
  void operation(async()=>{await bluetoothCommand(client,command);if(transport==='bluetooth'&&(command!==1||bluetoothLive?.connected))expectBluetoothDisconnect(command===1?'pair':command===2?'forget':'bluetooth');message(command===1?(firmwareRole==='guitar'&&bluetoothLive?.connected?tr("bluetooth.pairAfterDisconnect"):tr("bluetooth.pairingOpened")):command===2?tr("bluetooth.forgetConfirmed"):tr("bluetooth.disconnectConfirmed"), 'success');});
});
renderBluetooth();


function renderDiscovery(receiver){
  const available=receiver&&hasFeature(29)&&hasFeature(30);
  $('receiver-discovery').hidden=!receiver;
  const blocked=busy||Boolean(expectedDisconnect)||!bluetoothSaved?.enabled||!bluetoothLive?.ready;
  $('receiver-search').disabled=!available||blocked||Boolean(bluetoothLive?.connected)||Boolean(discoveryLive?.connecting);
  const info=discoveryLive;
  $('receiver-scan-status').textContent=!available?tr("discovery.updateFirmware"):!info?tr("discovery.startHelp"):info.connecting?tr("discovery.connecting"):info.connected?(info.ready?tr("discovery.hidReady"):tr("discovery.preparingHid")):info.scanning?(info.devices.length?tr("discovery.selectGuitar"):info.advertisements?tr("discovery.noCompatibleGuitar"):tr("discovery.searching")):tr("discovery.stopped");
  if(info?.gatt_status!==null && info?.gatt_status!==undefined && info.gatt_status!==0)$('receiver-scan-status').textContent+=tr("discovery.failureSuffix", info.gatt_status.toString(16).padStart(2,'0').toUpperCase());
  const list=$('receiver-devices');list.replaceChildren();
  for(const candidate of available?info?.devices??[]:[]){
    const row=document.createElement('div');row.className='save-actions';
    const label=document.createElement('span');label.textContent=`Vibetar Guitar · ${candidate.label} · ${candidate.rssi} dBm`;
    const button=document.createElement('button');button.type='button';button.className='button secondary';button.textContent=tr("discovery.connect");
    button.disabled=blocked||Boolean(info?.connected)||Boolean(info?.connecting)||!bluetoothLive?.pairing;
    button.addEventListener('click',()=>void operation(async()=>{
      await connectGuitar(client,candidate);
      discoveryLive=decodeDiscovery(await client.transfer(()=>device.receiveFeatureReport(29)));
      message(tr("discovery.connectStarted"), 'success');
    }));
    row.append(label,button);list.append(row);
  }
}
$('receiver-search').addEventListener('click',()=>void operation(async()=>{
  await bluetoothCommand(client,1);
  discoveryLive=decodeDiscovery(await client.transfer(()=>device.receiveFeatureReport(29)));
  message(tr("discovery.searchOpened"), 'success');
}));
function expectBluetoothDisconnect(reason){
  expectedDisconnect=reason;
  clearTimeout(liveTimer);
  const target=device;
  // Release WebHID even on platforms that omit the OS disconnect event.
  setTimeout(()=>{
    if(device!==target||expectedDisconnect!==reason)return;
    stopMonitor();firmwareInfo=null;expectedDisconnect=null;
    client?.cancel();client=null;device=null;
    if(target.opened)void target.close().catch(()=>{});
    render();
  },4500);
}

function refreshLanguage() {
  applyTranslations(document);
  $('language-select').value = getLanguage();
  render();
  if (live) showLive(live);
  if (!supported) $('compatibility').textContent = !window.isSecureContext
    ? tr("compatibility.secureContext")
    : tr("compatibility.unsupportedBrowser");
  if (firmwareInfo) $('device-tools-note').textContent = tr("device.commandsHelp");
}
$('language-select').addEventListener('change', event => setLanguage(event.target.value));
onLanguageChange(() => {
  message('');
  $('bluetooth-copy-status').textContent = '';
  refreshLanguage();
});
refreshLanguage();
