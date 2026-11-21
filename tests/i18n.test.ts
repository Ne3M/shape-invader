import { describe, expect, it } from 'vitest';
import { LANGUAGES, LANG_CODES, fmt, levelName, levelTwist, setLang, shapeName, t } from '../src/i18n';
import { en } from '../src/locales/en';
import { LEVEL_COUNT } from '../src/levels';
import { SHAPE_ORDER } from '../src/shapes';

const placeholders = (s: string) => [...s.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort();

describe('translations', () => {
  it('every language has exactly the English keys, none empty', () => {
    for (const code of LANG_CODES) {
      const msgs = LANGUAGES[code] as Record<string, string>;
      expect(Object.keys(msgs).sort(), code).toEqual(Object.keys(en).sort());
      for (const [k, v] of Object.entries(msgs)) expect(v.trim().length, `${code}:${k}`).toBeGreaterThan(0);
    }
  });

  it('every language uses the same {placeholders} as English', () => {
    for (const code of LANG_CODES) {
      const msgs = LANGUAGES[code] as Record<string, string>;
      for (const [k, v] of Object.entries(en)) expect(placeholders(msgs[k]), `${code}:${k}`).toEqual(placeholders(v));
    }
  });

  it('fills placeholders and switches language', () => {
    setLang('en');
    expect(t('hud.waveOf', { n: 3, total: 10 })).toBe('Wave 3/10');
    expect(shapeName('square')).toBe('Square');
    setLang('fr');
    expect(t('hud.waveOf', { n: 3, total: 10 })).toBe('Vague 3/10');
    expect(shapeName('square')).toBe('Carré');
    expect(levelName(0)).toBe('Premier contact');
    expect(fmt(12900).replace(/\s/g, ' ')).toBe('12 900');
    setLang('en');
  });

  it('every shape and level has its texts', () => {
    for (const code of LANG_CODES) {
      setLang(code);
      for (const s of SHAPE_ORDER) expect(shapeName(s)).not.toMatch(/^shape\./);
      for (let i = 0; i < LEVEL_COUNT; i++) expect(levelName(i)).not.toMatch(/^level\./);
    }
    expect(levelTwist(9)).toBeTruthy();
    expect(levelTwist(2)).toBeUndefined();
    setLang('en');
  });
});
