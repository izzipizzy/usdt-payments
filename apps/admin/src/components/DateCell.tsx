import { Tooltip } from 'antd';
import dayjs from 'dayjs';
import localizedFormat from 'dayjs/plugin/localizedFormat';
import relativeTime from 'dayjs/plugin/relativeTime';
import { useTranslation } from 'react-i18next';

dayjs.extend(relativeTime);
dayjs.extend(localizedFormat);

export const DateCell = ({ value, relative = false }: { value: string | null | undefined; relative?: boolean }) => {
  // Subscribing to the language makes the cell re-render when dayjs' global locale changes.
  const { i18n } = useTranslation();
  if (!value) return <span>—</span>;
  const d = dayjs(value).locale(i18n.language);
  if (!d.isValid()) return <span>{value}</span>;
  const abs = d.format('L LTS');
  return (
    <Tooltip title={`${d.toISOString()} (${d.fromNow()})`}>
      <span style={{ whiteSpace: 'nowrap', fontVariantNumeric: 'tabular-nums' }}>{relative ? d.fromNow() : abs}</span>
    </Tooltip>
  );
};
