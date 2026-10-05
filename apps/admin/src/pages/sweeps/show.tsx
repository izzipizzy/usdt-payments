import { Show } from '@refinedev/antd';
import { useOne } from '@refinedev/core';
import { Alert, Card, Descriptions, Space, Table, Typography } from 'antd';
import type { ColumnsType } from 'antd/es/table';
import type { TFunction } from 'i18next';
import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { Link, useParams } from 'react-router';
import type { DepositDto, ResourceOpDto } from '@usdt-trx/shared';
import type { SweepShowDto } from '../../api/types';
import { DateCell } from '../../components/DateCell';
import { Ellipsis } from '../../components/Ellipsis';
import { ExplorerLink } from '../../components/ExplorerLink';
import { Money } from '../../components/Money';
import { StatusTag } from '../../components/StatusTag';
import { enumLabel } from '../../i18n/labels';
import { formatInt, sunToTrx } from '../../utils/format';
import { SweepActions } from './actions';
import { sweepCost } from './columns';

export const resourceOpColumns = (t: TFunction): ColumnsType<ResourceOpDto> => [
  { title: t('fields.id'), dataIndex: 'id', key: 'id', width: 90 },
  { title: t('fields.kind'), dataIndex: 'kind', key: 'kind', render: (v: string) => enumLabel(t, 'resourceKind', v) },
  { title: t('fields.provider'), dataIndex: 'provider', key: 'provider' },
  { title: t('fields.status'), dataIndex: 'status', key: 'status', render: (v: string) => <StatusTag kind="resource" value={v} /> },
  { title: t('fields.target'), dataIndex: 'targetAddress', key: 'targetAddress', width: 190, render: (v: string) => <ExplorerLink kind="address" value={v} /> },
  { title: t('fields.energy'), dataIndex: 'energyAmount', key: 'energyAmount', align: 'right', render: formatInt },
  { title: t('fields.bandwidth'), dataIndex: 'bandwidthAmount', key: 'bandwidthAmount', align: 'right', render: formatInt },
  { title: t('fields.cost'), dataIndex: 'costSun', key: 'costSun', align: 'right', render: (v: string | null) => <Money value={sunToTrx(v)} /> },
  { title: t('fields.order'), dataIndex: 'externalOrderId', key: 'externalOrderId', render: (v: string | null) => v ?? '—' },
  { title: t('fields.tx'), dataIndex: 'txId', key: 'txId', width: 190, render: (v: string | null) => <ExplorerLink kind="tx" value={v} /> },
  { title: t('fields.expires'), dataIndex: 'expiresAt', key: 'expiresAt', width: 160, render: (v: string | null) => <DateCell value={v} /> },
  { title: t('fields.error'), dataIndex: 'lastError', key: 'lastError', width: 200, ellipsis: true, render: (v: string | null) => <Ellipsis value={v} width={180} /> },
  { title: t('fields.created'), dataIndex: 'createdAt', key: 'createdAt', width: 160, render: (v: string) => <DateCell value={v} /> },
];

const depositColumns = (t: TFunction): ColumnsType<DepositDto> => [
  { title: t('fields.tx'), dataIndex: 'txId', key: 'txId', render: (v: string, r) => <ExplorerLink kind="tx" value={v} explorerUrl={r.explorerUrl} /> },
  { title: t('fields.from'), dataIndex: 'fromAddress', key: 'fromAddress', render: (v: string) => <ExplorerLink kind="address" value={v} /> },
  { title: t('fields.amount'), dataIndex: 'amount', key: 'amount', align: 'right', render: (v: string) => <Money value={v} unit="USDT" /> },
  { title: t('fields.status'), dataIndex: 'status', key: 'status', render: (v: string) => <StatusTag kind="deposit" value={v} /> },
  { title: t('fields.confirmed'), dataIndex: 'confirmedAt', key: 'confirmedAt', render: (v: string | null) => <DateCell value={v} /> },
  { title: t('fields.swept'), dataIndex: 'sweptAt', key: 'sweptAt', render: (v: string | null) => <DateCell value={v} /> },
];

export const SweepShow = () => {
  const { t } = useTranslation();
  const { id } = useParams();
  const { data, isLoading } = useOne<SweepShowDto>({ resource: 'sweeps', id: id ?? '' });
  const s = data?.data;
  const opCols = useMemo(() => resourceOpColumns(t), [t]);
  const depCols = useMemo(() => depositColumns(t), [t]);
  return (
    <Show
      title={s ? t('page.sweeps.showTitle', { id: s.id }) : t('page.sweeps.showTitleShort')}
      isLoading={isLoading}
      canEdit={false}
      canDelete={false}
      headerButtons={s ? <SweepActions sweep={s} size="middle" /> : null}
    >
      {s && (
        <Space direction="vertical" size="middle" style={{ width: '100%' }}>
          {s.lastError && <Alert type="error" showIcon message={t('page.sweeps.lastError')} description={<pre style={{ margin: 0, whiteSpace: 'pre-wrap' }}>{s.lastError}</pre>} />}
          <Descriptions size="small" bordered column={{ xs: 1, md: 2, xl: 3 }}>
            <Descriptions.Item label={t('fields.status')}>
              <StatusTag kind="sweep" value={s.status} />
            </Descriptions.Item>
            <Descriptions.Item label={t('fields.alias')}>{s.alias ?? '—'}</Descriptions.Item>
            <Descriptions.Item label={t('fields.attempt')}>{s.attempt}</Descriptions.Item>
            <Descriptions.Item label={t('fields.from')}>
              <ExplorerLink kind="address" value={s.address} short={false} />
            </Descriptions.Item>
            <Descriptions.Item label={t('page.sweeps.toCollector')}>
              <ExplorerLink kind="address" value={s.collectorAddress} short={false} />
            </Descriptions.Item>
            <Descriptions.Item label={t('fields.amount')}>
              <Money value={s.amount} unit="USDT" />
              <Typography.Text type="secondary" style={{ marginLeft: 8, fontSize: 12 }}>
                {t('common.raw')} {s.amountRaw}
              </Typography.Text>
            </Descriptions.Item>
            <Descriptions.Item label={t('fields.energySource')}>{enumLabel(t, 'energySource', s.energySource)}</Descriptions.Item>
            <Descriptions.Item label={t('fields.energyEstUsed')}>
              {formatInt(s.energyEstimated)} / {formatInt(s.energyUsed)}
            </Descriptions.Item>
            <Descriptions.Item label={t('page.sweeps.bandwidthUsed')}>{formatInt(s.bandwidthUsed)}</Descriptions.Item>
            <Descriptions.Item label={t('page.sweeps.resourceCost')}>
              <Money value={sunToTrx(s.resourceCostSun)} />
            </Descriptions.Item>
            <Descriptions.Item label={t('page.sweeps.trxBurned')}>
              <Money value={sunToTrx(s.trxFeeBurnedSun)} />
            </Descriptions.Item>
            <Descriptions.Item label={t('page.sweeps.totalCost')}>
              <Money value={sweepCost(s)} />
            </Descriptions.Item>
            <Descriptions.Item label={t('fields.tx')}>
              <ExplorerLink kind="tx" value={s.txId} explorerUrl={s.explorerUrl} short={false} />
            </Descriptions.Item>
            <Descriptions.Item label={t('fields.broadcast')}>
              <DateCell value={s.broadcastAt} />
            </Descriptions.Item>
            <Descriptions.Item label={t('fields.confirmed')}>
              <DateCell value={s.confirmedAt} />
            </Descriptions.Item>
            <Descriptions.Item label={t('fields.created')}>
              <DateCell value={s.createdAt} />
            </Descriptions.Item>
            <Descriptions.Item label={t('fields.updated')}>
              <DateCell value={s.updatedAt} />
            </Descriptions.Item>
            <Descriptions.Item label={t('fields.address')}>
              <Link to={`/addresses?filters[0][field]=search&filters[0][operator]=contains&filters[0][value]=${encodeURIComponent(s.address)}`}>
                {t('page.sweeps.findInAddresses')}
              </Link>
            </Descriptions.Item>
          </Descriptions>
          <Card size="small" title={t('page.sweeps.resourceOps', { n: s.resourceOperations.length })}>
            <Table<ResourceOpDto> size="small" rowKey="id" columns={opCols} dataSource={s.resourceOperations} pagination={false} scroll={{ x: 1600 }} />
          </Card>
          <Card size="small" title={t('page.sweeps.deposits', { n: s.deposits.length })}>
            <Table<DepositDto> size="small" rowKey="id" columns={depCols} dataSource={s.deposits} pagination={false} scroll={{ x: 800 }} />
          </Card>
        </Space>
      )}
    </Show>
  );
};
