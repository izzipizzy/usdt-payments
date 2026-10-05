import { describe, expect, it } from 'vitest';
import en from './en.json';
import { resolveLang, toLang } from './lang';
import ru from './ru.json';

const flatten = (obj: Record<string, unknown>, prefix = ''): string[] =>
  Object.entries(obj).flatMap(([k, v]) =>
    v && typeof v === 'object' && !Array.isArray(v) ? flatten(v as Record<string, unknown>, `${prefix}${k}.`) : [`${prefix}${k}`],
  );

const placeholders = (s: string): string[] => (s.match(/\{\{\s*[a-zA-Z0-9_]+\s*\}\}/g) ?? []).map((p) => p.replace(/\s/g, '')).sort();

const lookup = (obj: Record<string, unknown>, path: string): unknown => path.split('.').reduce<unknown>((acc, k) => (acc as Record<string, unknown>)?.[k], obj);

describe('i18n catalogs', () => {
  const enKeys = flatten(en).sort();
  const ruKeys = flatten(ru).sort();

  it('ru and en have the same keys', () => {
    expect(ruKeys).toEqual(enKeys);
  });

  it('no value is empty', () => {
    for (const k of enKeys) {
      expect(lookup(en, k), `en:${k}`).not.toBe('');
      expect(lookup(ru, k), `ru:${k}`).not.toBe('');
    }
  });

  it('interpolation placeholders match between locales', () => {
    for (const k of enKeys) {
      expect(placeholders(String(lookup(ru, k))), k).toEqual(placeholders(String(lookup(en, k))));
    }
  });

  it('covers every Refine built-in key group', () => {
    for (const k of ['buttons.save', 'buttons.logout', 'pages.error.404', 'notifications.error', 'actions.list', 'table.actions', 'warnWhenUnsavedChanges']) {
      expect(enKeys).toContain(k);
    }
  });
});

describe('language resolution', () => {
  it('prefers the stored language', () => {
    expect(resolveLang('ru', 'en-US')).toBe('ru');
    expect(resolveLang('en', 'ru-RU')).toBe('en');
  });
  it('falls back to the browser language, ru only when it starts with ru', () => {
    expect(resolveLang(null, 'ru-RU')).toBe('ru');
    expect(resolveLang(null, 'RU')).toBe('ru');
    expect(resolveLang(null, 'uk-UA')).toBe('en');
    expect(resolveLang(null, 'de')).toBe('en');
    expect(resolveLang(undefined, undefined)).toBe('en');
  });
  it('ignores junk stored values', () => {
    expect(resolveLang('fr', 'ru')).toBe('ru');
    expect(resolveLang('', 'en')).toBe('en');
  });
  it('normalises i18next tags', () => {
    expect(toLang('ru-RU')).toBe('ru');
    expect(toLang('en-GB')).toBe('en');
    expect(toLang(undefined)).toBe('en');
  });
});
