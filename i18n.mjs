import en from './locales/en.mjs';
import ptBR from './locales/pt-BR.mjs';

export const catalogs = Object.freeze({ en, 'pt-BR': ptBR });
export const LANGUAGE_KEY = 'vibetar-language';

export function supportedLanguage(value) {
  const base = String(value ?? '').trim().toLowerCase().split(/[-_]/)[0];
  return base === 'pt' ? 'pt-BR' : base === 'en' ? 'en' : null;
}

export function resolveLanguage(saved, preferences = []) {
  return supportedLanguage(saved) || preferences.map(supportedLanguage).find(Boolean) || 'en';
}

function initialLanguage() {
  // Protocol modules also run in Node tests, where browser preferences do not apply.
  if (typeof window === 'undefined') return 'en';
  let saved;
  try { saved = globalThis.localStorage?.getItem(LANGUAGE_KEY); } catch { /* Storage may be blocked. */ }
  const browser = globalThis.navigator;
  return resolveLanguage(saved, browser?.languages?.length ? browser.languages : [browser?.language]);
}

let language = initialLanguage();
const listeners = new Set();
export const getLanguage = () => language;

export function setLanguage(value, { persist = true } = {}) {
  language = supportedLanguage(value) || 'en';
  if (persist) {
    try { if (typeof window !== 'undefined') globalThis.localStorage?.setItem(LANGUAGE_KEY, language); } catch { /* Translation still works without storage. */ }
  }
  for (const listener of listeners) listener(language);
  return language;
}

export function onLanguageChange(listener) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function translate(key, ...values) {
  const text = (Object.hasOwn(catalogs[language], key) ? catalogs[language][key] : undefined)
    ?? (Object.hasOwn(en, key) ? en[key] : key);
  return text.replace(/\{(\d+)\}/g, (token, index) => index < values.length ? String(values[index]) : token);
}

// Array access stays live when the language changes, including protocol status labels.
export function translatedValues(keys) {
  const result = [];
  keys.forEach((_, index) => {
    Object.defineProperty(result, index, { configurable: true, enumerable: true, get: () => translate(keys[index]) });
  });
  return result;
}

export function bindText(element, key, ...values) {
  element.dataset.i18n = key;
  if (values.length) element.dataset.i18nArgs = JSON.stringify(values);
  element.textContent = translate(key, ...values);
  return element;
}

export function applyTranslations(root = document) {
  if (root.documentElement) root.documentElement.lang = language;
  const elements = [root, ...root.querySelectorAll('*')];
  for (const element of elements) {
    if (!element.dataset) continue;
    if (element.dataset.i18n) element.textContent = translate(element.dataset.i18n, ...JSON.parse(element.dataset.i18nArgs || '[]'));
    for (const attr of ['aria-label', 'title', 'placeholder', 'content']) {
      const key = element.getAttribute(`data-i18n-${attr}`);
      if (key) element.setAttribute(attr, translate(key));
    }
  }
}
