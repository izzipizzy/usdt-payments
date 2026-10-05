import { LinkOutlined } from '@ant-design/icons';
import { Typography } from 'antd';
import { useTranslation } from 'react-i18next';
import { useMe } from '../providers/useMe';
import { addressUrl, txUrl } from '../utils/explorer';
import { shortHash } from '../utils/format';

interface Props {
  kind: 'tx' | 'address';
  value: string | null | undefined;
  /** DTO-provided absolute URL; preferred when present. */
  explorerUrl?: string | null;
  short?: boolean;
  copyable?: boolean;
}

/** Monospace hash/address with copy + external explorer link. */
export const ExplorerLink = ({ kind, value, explorerUrl, short = true, copyable = true }: Props) => {
  const { t } = useTranslation();
  const { explorerBase } = useMe();
  if (!value) return <span>—</span>;
  const href = kind === 'tx' ? txUrl(explorerBase, value, explorerUrl) : addressUrl(explorerBase, value, explorerUrl);
  const label = short ? shortHash(value) : value;
  return (
    <Typography.Text
      code
      copyable={copyable ? { text: value, tooltips: [t('common.copy'), t('common.copied')] } : false}
      style={{ whiteSpace: 'nowrap' }}
      title={value}
    >
      {label}
      {href && (
        <a href={href} target="_blank" rel="noreferrer noopener" style={{ marginLeft: 4 }} title={t('common.openInExplorer')}>
          <LinkOutlined />
        </a>
      )}
    </Typography.Text>
  );
};
