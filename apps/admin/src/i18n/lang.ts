/** Pure language helpers (no browser access) so they can be unit-tested. */
export const LANG_KEY = 'usdt-trx.admin.lang';
export const LANGS = ['ru', 'en'] as const;
export type Lang = (typeof LANGS)[number];
export const DEFAULT_LANG: Lang = 'en';

export const isLang = (v: unknown): v is Lang => v === 'ru' || v === 'en';

/** Stored preference wins; otherwise a browser language starting with `ru` → ru, else en. */
export const resolveLang = (stored: string | null | undefined, browserLang: string | null | undefined): Lang => {
  if (isLang(stored)) return stored;
  return (browserLang ?? '').toLowerCase().startsWith('ru') ? 'ru' : DEFAULT_LANG;
};

/** Normalise an i18next language tag (`ru-RU`, `en-GB`) to one of ours. */
export const toLang = (tag: string | undefined): Lang => (tag && tag.toLowerCase().startsWith('ru') ? 'ru' : 'en');
