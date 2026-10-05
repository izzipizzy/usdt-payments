import { Segmented } from 'antd';
import { useTranslation } from 'react-i18next';
import { setLang, toLang, type Lang } from '../i18n';

const OPTIONS: { label: string; value: Lang }[] = [
  { label: 'RU', value: 'ru' },
  { label: 'EN', value: 'en' },
];

/** RU / EN toggle; persists to localStorage via `setLang`. */
export const LangSwitch = () => {
  const { t, i18n } = useTranslation();
  return (
    <Segmented<Lang>
      size="small"
      options={OPTIONS}
      value={toLang(i18n.language)}
      onChange={(v) => void setLang(v)}
      title={t('header.language')}
      aria-label={t('header.language')}
    />
  );
};
