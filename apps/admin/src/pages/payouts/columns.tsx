import type { ColumnsType } from 'antd/es/table';
import type { TFunction } from 'i18next';
import { Link } from 'react-router';
import { PayoutStatus } from '@usdt-trx/shared';
import type { PayoutDto } from '@usdt-trx/shared';
import { DateCell } from '../../components/DateCell';
import { Ellipsis } from '../../components/Ellipsis';
import { ExplorerLink } from '../../components/ExplorerLink';
import { Money } from '../../components/Money';
import { StatusTag } from '../../components/StatusTag';

/** Two-hop payout: 1 = main → hop in progress, 2 = hop → recipient. Confirmed always reads as 2/2. */
export const payoutStage = (p: Pick<PayoutDto, 'stage' | 'status'>): 1 | 2 => (p.status === PayoutStatus.confirmed || p.stage >= 2 ? 2 : 1);

/** Small «step 1» / «step 2» explorer links for the list; falls back to a dash when neither hop is broadcast. */
const HopLinks = ({ t, p }: { t: TFunction; p: PayoutDto }) => {
  const links = [
    p.hop1ExplorerUrl && { key: 'hop1', href: p.hop1ExplorerUrl, label: t('page.payouts.hop1Short'), title: p.hop1TxId },
    p.explorerUrl && { key: 'hop2', href: p.explorerUrl, label: t('page.payouts.hop2Short'), title: p.txId },
  ].filter((l): l is { key: string; href: string; label: string; title: string | null } => !!l);
  if (links.length === 0) return <span>—</span>;
  return (
    <span style={{ whiteSpace: 'nowrap', fontSize: 12 }}>
      {links.map((l, i) => (
        <a key={l.key} href={l.href} target="_blank" rel="noreferrer noopener" title={l.title ?? undefined} style={{ marginLeft: i ? 8 : 0 }}>
          {l.label}
        </a>
      ))}
    </span>
  );
};

export const payoutColumns = (t: TFunction, opts: { sortable: boolean }): ColumnsType<PayoutDto> => [
  {
    title: t('fields.externalId'),
    dataIndex: 'externalId',
    key: 'externalId',
    width: 180,
    ellipsis: true,
    render: (v: string, r) => (
      <Link to={`/payouts/${r.id}`} title={v} style={{ fontFamily: 'monospace' }}>
        {v}
      </Link>
    ),
  },
  { title: t('fields.to'), dataIndex: 'toAddress', key: 'toAddress', width: 190, render: (v: string) => <ExplorerLink kind="address" value={v} /> },
  { title: t('fields.amount'), dataIndex: 'amount', key: 'amount', sorter: opts.sortable, align: 'right', width: 140, render: (v: string) => <Money value={v} unit="USDT" /> },
  { title: t('fields.status'), dataIndex: 'status', key: 'status', sorter: opts.sortable, width: 130, render: (v: string) => <StatusTag kind="payout" value={v} /> },
  {
    title: t('fields.stage'),
    dataIndex: 'stage',
    key: 'stage',
    width: 60,
    align: 'center',
    render: (_: number, r) => <span style={{ fontVariantNumeric: 'tabular-nums' }}>{t('page.payouts.stageValue', { stage: payoutStage(r) })}</span>,
  },
  { title: t('fields.tx'), dataIndex: 'txId', key: 'txId', width: 120, render: (_: string | null, r) => <HopLinks t={t} p={r} /> },
  { title: t('fields.attemptShort'), dataIndex: 'attempt', key: 'attempt', width: 50, align: 'right' },
  { title: t('fields.lastError'), dataIndex: 'lastError', key: 'lastError', width: 220, ellipsis: true, render: (v: string | null) => <Ellipsis value={v} width={200} /> },
  { title: t('fields.created'), dataIndex: 'createdAt', key: 'createdAt', sorter: opts.sortable, width: 170, render: (v: string) => <DateCell value={v} /> },
];
