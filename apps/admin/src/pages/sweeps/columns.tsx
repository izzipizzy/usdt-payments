import type { ColumnsType } from 'antd/es/table';
import type { TFunction } from 'i18next';
import { Link } from 'react-router';
import type { SweepDto } from '@usdt-trx/shared';
import { DateCell } from '../../components/DateCell';
import { Ellipsis } from '../../components/Ellipsis';
import { ExplorerLink } from '../../components/ExplorerLink';
import { Money } from '../../components/Money';
import { StatusTag } from '../../components/StatusTag';
import { enumLabel } from '../../i18n/labels';
import { formatInt, sumSun, sunToTrx } from '../../utils/format';

export const sweepCost = (s: Pick<SweepDto, 'resourceCostSun' | 'trxFeeBurnedSun'>): string | null =>
  s.resourceCostSun === null && s.trxFeeBurnedSun === null ? null : sunToTrx(sumSun(s.resourceCostSun, s.trxFeeBurnedSun));

export const sweepColumns = (t: TFunction, opts: { sortable: boolean }): ColumnsType<SweepDto> => [
  { title: t('fields.id'), dataIndex: 'id', key: 'id', width: 90, render: (v: string) => <Link to={`/sweeps/${v}`}>{v}</Link> },
  { title: t('fields.alias'), dataIndex: 'alias', key: 'alias', width: 150, render: (v: string | null, r) => v ?? <ExplorerLink kind="address" value={r.address} /> },
  { title: t('fields.amount'), dataIndex: 'amount', key: 'amount', sorter: opts.sortable, align: 'right', width: 140, render: (v: string) => <Money value={v} unit="USDT" /> },
  { title: t('fields.status'), dataIndex: 'status', key: 'status', sorter: opts.sortable, width: 130, render: (v: string) => <StatusTag kind="sweep" value={v} /> },
  { title: t('fields.energySrc'), dataIndex: 'energySource', key: 'energySource', width: 110, render: (v: string) => enumLabel(t, 'energySource', v) },
  {
    title: t('fields.energyEstUsed'),
    key: 'energy',
    align: 'right',
    width: 160,
    render: (_, r) => (
      <span style={{ fontVariantNumeric: 'tabular-nums', whiteSpace: 'nowrap' }}>
        {formatInt(r.energyEstimated)} / {formatInt(r.energyUsed)}
      </span>
    ),
  },
  { title: t('fields.cost'), key: 'cost', align: 'right', width: 120, render: (_, r) => <Money value={sweepCost(r)} /> },
  { title: t('fields.tx'), dataIndex: 'txId', key: 'txId', width: 200, render: (v: string | null, r) => <ExplorerLink kind="tx" value={v} explorerUrl={r.explorerUrl} /> },
  { title: t('fields.attemptShort'), dataIndex: 'attempt', key: 'attempt', width: 50, align: 'right' },
  { title: t('fields.lastError'), dataIndex: 'lastError', key: 'lastError', width: 220, ellipsis: true, render: (v: string | null) => <Ellipsis value={v} width={200} /> },
  { title: t('fields.created'), dataIndex: 'createdAt', key: 'createdAt', sorter: opts.sortable, width: 170, render: (v: string) => <DateCell value={v} /> },
  { title: t('fields.broadcast'), dataIndex: 'broadcastAt', key: 'broadcastAt', width: 160, render: (v: string | null) => <DateCell value={v} /> },
  { title: t('fields.confirmed'), dataIndex: 'confirmedAt', key: 'confirmedAt', width: 160, render: (v: string | null) => <DateCell value={v} /> },
];
