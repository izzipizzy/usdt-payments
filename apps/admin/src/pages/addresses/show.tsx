import { Show } from '@refinedev/antd';
import { useOne } from '@refinedev/core';
import { Card, Descriptions, Space, Table, Typography } from 'antd';
import type { ColumnsType } from 'antd/es/table';
import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { Link, useParams } from 'react-router';
import type { DepositDto, SweepDto } from '@usdt-trx/shared';
import type { AddressShowDto } from '../../api/types';
import { DateCell } from '../../components/DateCell';
import { Ellipsis } from '../../components/Ellipsis';
import { ExplorerLink } from '../../components/ExplorerLink';
import { Money } from '../../components/Money';
import { StatusTag } from '../../components/StatusTag';
import { enumLabel } from '../../i18n/labels';
import { sumSun, sunToTrx } from '../../utils/format';

export const AddressShow = () => {
  const { t } = useTranslation();
  const { id } = useParams();
  const { data, isLoading } = useOne<AddressShowDto>({ resource: 'addresses', id: id ?? '' });
  const a = data?.data;

  const depositColumns = useMemo<ColumnsType<DepositDto>>(
    () => [
      { title: t('fields.tx'), dataIndex: 'txId', key: 'txId', render: (v: string, r) => <ExplorerLink kind="tx" value={v} explorerUrl={r.explorerUrl} /> },
      { title: t('fields.from'), dataIndex: 'fromAddress', key: 'fromAddress', render: (v: string) => <ExplorerLink kind="address" value={v} /> },
      { title: t('fields.amount'), dataIndex: 'amount', key: 'amount', align: 'right', render: (v: string) => <Money value={v} unit="USDT" /> },
      { title: t('fields.status'), dataIndex: 'status', key: 'status', render: (v: string) => <StatusTag kind="deposit" value={v} /> },
      { title: t('fields.block'), dataIndex: 'blockNumber', key: 'blockNumber', align: 'right' },
      { title: t('fields.confirmed'), dataIndex: 'confirmedAt', key: 'confirmedAt', render: (v: string | null) => <DateCell value={v} /> },
      { title: t('fields.swept'), dataIndex: 'sweptAt', key: 'sweptAt', render: (v: string | null) => <DateCell value={v} /> },
      { title: t('fields.sweep'), dataIndex: 'sweepId', key: 'sweepId', render: (v: string | null) => (v ? <Link to={`/sweeps/${v}`}>{v}</Link> : '—') },
    ],
    [t],
  );

  const sweepColumns = useMemo<ColumnsType<SweepDto>>(
    () => [
      { title: t('fields.id'), dataIndex: 'id', key: 'id', render: (v: string) => <Link to={`/sweeps/${v}`}>{v}</Link> },
      { title: t('fields.amount'), dataIndex: 'amount', key: 'amount', align: 'right', render: (v: string) => <Money value={v} unit="USDT" /> },
      { title: t('fields.status'), dataIndex: 'status', key: 'status', render: (v: string) => <StatusTag kind="sweep" value={v} /> },
      { title: t('fields.energy'), dataIndex: 'energySource', key: 'energySource', render: (v: string) => enumLabel(t, 'energySource', v) },
      { title: t('fields.cost'), key: 'cost', align: 'right', render: (_, r) => <Money value={sunToTrx(sumSun(r.resourceCostSun, r.trxFeeBurnedSun))} /> },
      { title: t('fields.tx'), dataIndex: 'txId', key: 'txId', render: (v: string | null, r) => <ExplorerLink kind="tx" value={v} explorerUrl={r.explorerUrl} /> },
      { title: t('fields.attempt'), dataIndex: 'attempt', key: 'attempt', align: 'right' },
      { title: t('fields.error'), dataIndex: 'lastError', key: 'lastError', width: 200, ellipsis: true, render: (v: string | null) => <Ellipsis value={v} width={180} /> },
      { title: t('fields.created'), dataIndex: 'createdAt', key: 'createdAt', width: 160, render: (v: string) => <DateCell value={v} /> },
    ],
    [t],
  );

  return (
    <Show
      title={a ? t('page.addresses.showTitle', { name: a.alias ?? a.address }) : t('page.addresses.showTitleShort')}
      isLoading={isLoading}
      canEdit={false}
      canDelete={false}
    >
      {a && (
        <Space direction="vertical" size="middle" style={{ width: '100%' }}>
          <Descriptions size="small" bordered column={{ xs: 1, md: 2, xl: 3 }}>
            <Descriptions.Item label={t('fields.alias')}>{a.alias ?? '—'}</Descriptions.Item>
            <Descriptions.Item label={t('fields.address')}>
              <ExplorerLink kind="address" value={a.address} explorerUrl={a.explorerUrl} short={false} />
            </Descriptions.Item>
            <Descriptions.Item label={t('fields.hex')}>
              <Typography.Text code copyable={{ tooltips: [t('common.copy'), t('common.copied')] }}>
                {a.addressHex}
              </Typography.Text>
            </Descriptions.Item>
            <Descriptions.Item label={t('fields.status')}>
              <StatusTag kind="address" value={a.status} />
            </Descriptions.Item>
            <Descriptions.Item label={t('fields.onchain')}>
              <StatusTag kind="onchain" value={a.onchainStatus} />
            </Descriptions.Item>
            <Descriptions.Item label={t('fields.derivationIndex')}>{a.derivationIndex}</Descriptions.Item>
            <Descriptions.Item label={t('fields.usdtBalance')}>
              <Money value={a.usdtBalance} unit="USDT" />
              <Typography.Text type="secondary" style={{ marginLeft: 8, fontSize: 12 }}>
                {t('common.raw')} {a.usdtBalanceRaw}
              </Typography.Text>
            </Descriptions.Item>
            <Descriptions.Item label={t('fields.balanceChecked')}>
              <DateCell value={a.balanceCheckedAt} />
            </Descriptions.Item>
            <Descriptions.Item label={t('fields.lastDeposit')}>
              <DateCell value={a.lastDepositAt} />
            </Descriptions.Item>
            <Descriptions.Item label={t('fields.created')}>
              <DateCell value={a.createdAt} />
            </Descriptions.Item>
            <Descriptions.Item label={t('fields.id')}>
              <Typography.Text code copyable={{ tooltips: [t('common.copy'), t('common.copied')] }}>
                {a.id}
              </Typography.Text>
            </Descriptions.Item>
          </Descriptions>
          <Card size="small" title={t('page.addresses.deposits', { n: a.deposits.length })}>
            <Table<DepositDto> size="small" rowKey="id" columns={depositColumns} dataSource={a.deposits} pagination={{ pageSize: 10, hideOnSinglePage: true }} scroll={{ x: 1100 }} />
          </Card>
          <Card size="small" title={t('page.addresses.sweeps', { n: a.sweeps.length })}>
            <Table<SweepDto> size="small" rowKey="id" columns={sweepColumns} dataSource={a.sweeps} pagination={{ pageSize: 10, hideOnSinglePage: true }} scroll={{ x: 1300 }} />
          </Card>
        </Space>
      )}
    </Show>
  );
};
