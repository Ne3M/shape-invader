/**
 * Translations.
 *
 * Every player-facing text lives in a locale file (src/locales/<code>.ts) under a key.
 * English (en.ts) defines the keys; each other language must provide all of them, which
 * TypeScript checks. To add a language: create src/locales/<code>.ts typed as `Messages`,
 * then add it to LANGUAGES below. The language switch on the title screen lists it automatically.
 *
 * Usage: t('hud.wave', { n: 3 }) → "Wave 3" / "Vague 3".
 * Static HTML uses attributes, applied by applyStaticText():
 *   data-i18n="key" (text), data-i18n-aria="key" (aria-label), data-i18n-title="key" (title).
 */
import { en } from './locales/en';
import { fr } from './locales/fr';
import type { ShapeId } from './shapes';

export type MessageKey = keyof typeof en;
export type Messages = Record<MessageKey, string>;

/** Available languages, in the order shown in the switch. */
export const LANGUAGES = { en, fr } satisfies Record<string, Messages>;
export type Lang = keyof typeof LANGUAGES;
export const LANG_CODES = Object.keys(LANGUAGES) as Lang[];

let current: Lang = 'en';
const listeners: (() => void)[] = [];

export function isLang(v: unknown): v is Lang {
  return typeof v === 'string' && v in LANGUAGES;
}

/** The saved choice if any, otherwise the device language when supported, otherwise English. */
export function detectLang(saved?: string | null): Lang {
  if (isLang(saved)) return saved;
  for (const pref of navigator.languages ?? [navigator.language]) {
    const code = pref?.slice(0, 2).toLowerCase();
    if (isLang(code)) return code;
  }
  return 'en';
}

export function getLang(): Lang {
  return current;
}

export function setLang(lang: Lang): void {
  current = lang;
  if (typeof document !== 'undefined') applyStaticText();
  listeners.forEach((fn) => fn());
}

/** Runs `fn` whenever the language changes. */
export function onLangChange(fn: () => void): void {
  listeners.push(fn);
}

/** Translated text for `key`, with `{name}` placeholders filled from `params`. */
export function t(key: MessageKey, params?: Record<string, string | number>): string {
  const text = LANGUAGES[current][key] ?? en[key];
  return params ? text.replace(/\{(\w+)\}/g, (m, name: string) => (name in params ? String(params[name]) : m)) : text;
}

/** Number formatted for the current language (e.g. 12,900 / 12 900). */
export function fmt(n: number): string {
  return n.toLocaleString(t('lang.locale'));
}

export function shapeName(id: ShapeId): string {
  return t(`shape.${id}.name`);
}

export function levelName(index: number): string {
  return t(`level.${index}.name` as MessageKey);
}

/** Special rule shown on a level's intro card, if it has one. */
export function levelTwist(index: number): string | undefined {
  const key = `level.${index}.twist`;
  return key in en ? t(key as MessageKey) : undefined;
}

/** Translates the static HTML (elements with data-i18n, data-i18n-aria, data-i18n-title). */
export function applyStaticText(root: ParentNode = document): void {
  root.querySelectorAll<HTMLElement>('[data-i18n]').forEach((el) => (el.textContent = t(el.dataset.i18n as MessageKey)));
  root.querySelectorAll<HTMLElement>('[data-i18n-aria]').forEach((el) => el.setAttribute('aria-label', t(el.dataset.i18nAria as MessageKey)));
  root.querySelectorAll<HTMLElement>('[data-i18n-title]').forEach((el) => (el.title = t(el.dataset.i18nTitle as MessageKey)));
  document.documentElement.lang = current;
}
