import { Tag } from 'antd';
import { useTranslation } from 'react-i18next';
import { statusLabel, type StatusKind } from '../i18n/labels';
import { addressStatusColor, depositStatusColor, onchainStatusColor, payoutStatusColor, resourceOpStatusColor, sweepStatusColor } from '../utils/status';

const COLOR: Record<StatusKind, (s: string) => string> = {
  sweep: sweepStatusColor,
  payout: payoutStatusColor,
  deposit: depositStatusColor,
  address: addressStatusColor,
  onchain: onchainStatusColor,
  resource: resourceOpStatusColor,
};

export const StatusTag = ({ kind, value }: { kind: StatusKind; value: string | null | undefined }) => {
  const { t } = useTranslation();
  if (!value) return <span>—</span>;
  return (
    <Tag color={COLOR[kind](value)} style={{ marginInlineEnd: 0 }} title={value}>
      {statusLabel(t, kind, value)}
    </Tag>
  );
};
