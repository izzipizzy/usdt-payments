import dayjs from 'dayjs';
import 'dayjs/locale/en';
import 'dayjs/locale/ru';
import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';
import en from './en.json';
import { LANG_KEY, resolveLang, toLang, type Lang } from './lang';
import ru from './ru.json';

export { LANG_KEY, LANGS, toLang, type Lang } from './lang';

const readStored = (): string | null => {
  try {
    return localStorage.getItem(LANG_KEY);
  } catch {
    return null;
  }
};

const initial = resolveLang(readStored(), typeof navigator !== 'undefined' ? navigator.language : undefined);

void i18n.use(initReactI18next).init({
  resources: { en: { translation: en }, ru: { translation: ru } },
  lng: initial,
  fallbackLng: 'en',
  supportedLngs: ['en', 'ru'],
  interpolation: { escapeValue: false },
  returnNull: false,
});

const applyLocale = (lang: Lang) => {
  dayjs.locale(lang);
  if (typeof document !== 'undefined') document.documentElement.lang = lang;
};
applyLocale(initial);
i18n.on('languageChanged', (l) => applyLocale(toLang(l)));

/** Switch UI language and persist the choice. */
export const setLang = async (lang: Lang): Promise<void> => {
  try {
    localStorage.setItem(LANG_KEY, lang);
  } catch {
    /* private mode */
  }
  await i18n.changeLanguage(lang);
};

export const currentLang = (): Lang => toLang(i18n.language);

export default i18n;
