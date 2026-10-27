import test, { beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';
import { catalogs, LANGUAGE_KEY, supportedLanguage, resolveLanguage, getLanguage, setLanguage,
  translate, translatedValues, onLanguageChange, bindText, applyTranslations } from '../i18n.mjs';
import { BUTTONS, STATUS, validate, encodeConfig } from '../protocol.mjs';
import { EXTRA_LABELS } from '../webhid-extras.mjs';
import { bluetoothStatusText, bluetoothDiagnosticText } from '../webhid-bluetooth.mjs';

beforeEach(() => setLanguage('en', { persist: false }));

test('saved choice wins; otherwise use the first supported browser language and fall back to English', () => {
  assert.equal(getLanguage(), 'en');
  assert.equal(supportedLanguage('en-GB'), 'en');
  assert.equal(supportedLanguage('pt-PT'), 'pt-BR');
  assert.equal(supportedLanguage('pt_BR'), 'pt-BR');
  assert.equal(supportedLanguage('es'), null);
  assert.equal(resolveLanguage('en', ['pt-BR']), 'en');
  assert.equal(resolveLanguage(null, ['fr-FR', 'pt-BR', 'en-US']), 'pt-BR');
  assert.equal(resolveLanguage('unknown', ['en-US', 'pt-BR']), 'en');
  assert.equal(resolveLanguage(null, ['es-ES', 'de-DE']), 'en');
  assert.equal(resolveLanguage(null, []), 'en');
});

let moduleId = 0;
async function inBrowser({ storage, navigator }, action) {
  const original = Object.fromEntries(['window', 'localStorage', 'navigator'].map(key => [key, Object.getOwnPropertyDescriptor(globalThis, key)]));
  try {
    Object.defineProperty(globalThis, 'window', { configurable: true, value: {} });
    Object.defineProperty(globalThis, 'navigator', { configurable: true, value: navigator });
    Object.defineProperty(globalThis, 'localStorage', { configurable: true, get: () => typeof storage === 'function' ? storage() : storage });
    await action(await import(`../i18n.mjs?browser-test=${moduleId++}`));
  } finally {
    for (const [key, descriptor] of Object.entries(original)) {
      if (descriptor) Object.defineProperty(globalThis, key, descriptor);
      else delete globalThis[key];
    }
  }
}

test('browser initialization, saved preference, and blocked storage work without hardware access', async () => {
  const values = new Map();
  const storage = { getItem: key => values.get(key), setItem: (key, value) => values.set(key, value) };
  await inBrowser({ storage, navigator: { languages: ['fr', 'pt-PT', 'en'] } }, async module => {
    assert.equal(module.getLanguage(), 'pt-BR');
    module.setLanguage('en');
    assert.equal(values.get(LANGUAGE_KEY), 'en');
  });
  await inBrowser({ storage, navigator: { languages: ['pt-BR'] } }, async module => assert.equal(module.getLanguage(), 'en'));
  await inBrowser({ storage: () => { throw new Error('Storage blocked'); }, navigator: { language: 'pt-BR' } }, async module => {
    assert.equal(module.getLanguage(), 'pt-BR');
    assert.doesNotThrow(() => module.setLanguage('en'));
  });
});

test('both catalogs cover the same messages and preserve interpolation placeholders', () => {
  assert.deepEqual(Object.keys(catalogs.en).sort(), Object.keys(catalogs['pt-BR']).sort());
  const placeholders = value => [...value.matchAll(/\{\d+\}/g)].map(match => match[0]).sort();
  for (const key of Object.keys(catalogs.en)) {
    assert.ok(catalogs.en[key].trim(), key);
    assert.match(key, /^[a-z][a-zA-Z0-9]*(\.[a-z][a-zA-Z0-9]*)+$/, key);
    assert.ok(catalogs['pt-BR'][key].trim(), key);
    assert.deepEqual(placeholders(catalogs.en[key]), placeholders(catalogs['pt-BR'][key]), key);
  }
  assert.equal(translate("validation.outputConfig", 3), 'LED 3: review GPIO, event, and polarity.');
  assert.equal(translate('missing.key'), 'missing.key');
  assert.equal(translate('toString'), 'toString');
});

test('literal message references and HTML bindings use registered compact IDs', async () => {
  const root = new URL('../', import.meta.url);
  const files = ['index.html', ...(await readdir(root)).filter(file => file.endsWith('.mjs'))];
  const assertKey = (key, file) => {
    if (key.includes('${')) return; // Dynamic bindings use keys from the control/event definitions.
    assert.match(key, /^[a-z][a-zA-Z0-9]*(\.[a-z][a-zA-Z0-9]*)+$/, `${file}: ${key}`);
    assert.ok(Object.hasOwn(catalogs.en, key), `${file}: missing ${key}`);
  };
  for (const file of files) {
    const source = await readFile(new URL(file, root), 'utf8');
    for (const match of source.matchAll(/\b(?:tr|translate)\(\s*(['"])([^'"]+)\1/g)) assertKey(match[2], file);
    for (const match of source.matchAll(/data-i18n(?:-aria-label|-title|-placeholder|-content)?="([^"]+)"/g)) assertKey(match[1], file);
  }
  for (const button of BUTTONS) assertKey(button.labelKey, 'BUTTONS');
});

test('status labels, validation, and Bluetooth diagnostics switch languages while wire data stays unchanged', () => {
  const labels = translatedValues(["common.green", "common.disabled"]);
  assert.deepEqual([...labels], ['Green', 'Disabled']);
  assert.equal(BUTTONS[0].label, 'Green');
  assert.equal(EXTRA_LABELS[0], 'D-pad left');
  assert.equal(STATUS[2], 'Configuration rejected by Pico');
  assert.match(validate(null)[0], /JSON must contain only/);
  assert.match(bluetoothStatusText({ enabled: false }), /disabled/);
  const config = structuredClone(configFixture);
  const englishBytes = encodeConfig(config);
  setLanguage('pt-BR', { persist: false });
  assert.deepEqual([...labels], ['Verde', 'Desativado']);
  assert.equal(BUTTONS[0].label, 'Verde');
  assert.equal(EXTRA_LABELS[0], 'D-pad esquerda');
  assert.equal(STATUS[2], 'Configuração rejeitada pelo Pico');
  assert.match(validate(null)[0], /JSON deve conter somente/);
  assert.match(bluetoothStatusText({ enabled: false }), /desativado/);
  assert.deepEqual(encodeConfig(config), englishBytes);
  const diagnostic = { connected: false, diagnostics: { connection_status: null, pairing_status: 5, pairing_reason: 6, disconnect_reason: 0 } };
  assert.match(bluetoothDiagnosticText(diagnostic), /tamanho da chave/);
  setLanguage('en', { persist: false });
  assert.match(bluetoothDiagnosticText(diagnostic), /key size/);
});
const configFixture = {
  buttons: { green: 2, red: 3, yellow: 4, blue: 5, orange: 6, strum_up: 7, strum_down: 8, start: 9, back: 10, tilt: 11, guide: 12 },
  mode_gpio: 13, whammy: { gpio: 26, enabled: false, inverted: false, min: 0, max: 4095, deadzone: 32 },
};

test('updating translated text and accessibility labels retains form nodes and unsaved values', () => {
  const element = (dataset = {}) => ({ dataset, attributes: {}, textContent: '',
    getAttribute(key) { return this.attributes[key] ?? null; },
    setAttribute(key, value) { this.attributes[key] = value; },
  });
  const label = bindText(element(), "extras.positionAdc", 3);
  const input = { ...element(), value: '237', checked: true };
  input.setAttribute('data-i18n-aria-label', "common.minimum");
  const root = { documentElement: {}, querySelectorAll: () => [label, input] };
  applyTranslations(root);
  assert.equal(label.textContent, 'Position 3 · ADC');
  assert.equal(input.getAttribute('aria-label'), 'Minimum');
  let calls = 0;
  const unsubscribe = onLanguageChange(() => { calls++; applyTranslations(root); });
  setLanguage('pt-BR', { persist: false });
  assert.equal(label.textContent, 'Posição 3 · ADC');
  assert.equal(root.documentElement.lang, 'pt-BR');
  assert.equal(input.getAttribute('aria-label'), 'Mínimo');
  assert.equal(input.value, '237');
  assert.equal(input.checked, true);
  assert.equal(root.querySelectorAll()[1], input);
  assert.equal(calls, 1);
  unsubscribe();
});
