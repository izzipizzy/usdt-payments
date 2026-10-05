import { Show } from '@refinedev/antd';
import { useOne } from '@refinedev/core';
import { Alert, Card, Descriptions, Space, Table, Typography } from 'antd';
import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { useParams } from 'react-router';
import type { ResourceOpDto } from '@usdt-trx/shared';
import type { PayoutShowDto } from '../../api/types';
import { DateCell } from '../../components/DateCell';
import { ExplorerLink } from '../../components/ExplorerLink';
import { Money } from '../../components/Money';
import { StatusTag } from '../../components/StatusTag';
import { enumLabel } from '../../i18n/labels';
import { formatInt, sunToTrx } from '../../utils/format';
import { resourceOpColumns } from '../sweeps/show';
import { PayoutActions } from './actions';
import { payoutStage } from './columns';

export const PayoutShow = () => {
  const { t } = useTranslation();
  const { id } = useParams();
  const { data, isLoading } = useOne<PayoutShowDto>({ resource: 'payouts', id: id ?? '' });
  const p = data?.data;
  const opCols = useMemo(() => resourceOpColumns(t), [t]);
  return (
    <Show
      title={p ? t('page.payouts.showTitle', { id: p.externalId }) : t('page.payouts.showTitleShort')}
      isLoading={isLoading}
      canEdit={false}
      canDelete={false}
      headerButtons={p ? <PayoutActions payout={p} size="middle" /> : null}
    >
      {p && (
        <Space direction="vertical" size="middle" style={{ width: '100%' }}>
          <Alert type="info" showIcon message={t('page.payouts.twoHopInfo')} />
          {p.lastError && <Alert type="error" showIcon message={t('page.payouts.lastError')} description={<pre style={{ margin: 0, whiteSpace: 'pre-wrap' }}>{p.lastError}</pre>} />}
          <Descriptions size="small" bordered column={{ xs: 1, md: 2, xl: 3 }}>
            <Descriptions.Item label={t('fields.status')}>
              <StatusTag kind="payout" value={p.status} />
            </Descriptions.Item>
            <Descriptions.Item label={t('fields.externalId')}>
              <Typography.Text code copyable={{ text: p.externalId, tooltips: [t('common.copy'), t('common.copied')] }}>
                {p.externalId}
              </Typography.Text>
            </Descriptions.Item>
            <Descriptions.Item label={t('fields.stage')}>
              <span style={{ fontVariantNumeric: 'tabular-nums' }}>{t('page.payouts.stageValue', { stage: payoutStage(p) })}</span>
            </Descriptions.Item>
            <Descriptions.Item label={t('fields.attempt')}>{p.attempt}</Descriptions.Item>
            <Descriptions.Item label={t('fields.from')}>
              <ExplorerLink kind="address" value={p.fromAddress} short={false} />
            </Descriptions.Item>
            <Descriptions.Item label={t('fields.viaAddress')}>
              <ExplorerLink kind="address" value={p.viaAddress} short={false} />
            </Descriptions.Item>
            <Descriptions.Item label={t('fields.to')}>
              <ExplorerLink kind="address" value={p.toAddress} short={false} />
            </Descriptions.Item>
            <Descriptions.Item label={t('fields.amount')}>
              <Money value={p.amount} unit="USDT" />
              <Typography.Text type="secondary" style={{ marginLeft: 8, fontSize: 12 }}>
                {t('common.raw')} {p.amountRaw}
              </Typography.Text>
            </Descriptions.Item>
            <Descriptions.Item label={t('fields.energySource')}>{enumLabel(t, 'energySource', p.energySource)}</Descriptions.Item>
            <Descriptions.Item label={t('fields.energyUsed')}>{formatInt(p.energyUsed)}</Descriptions.Item>
            <Descriptions.Item label={t('page.payouts.resourceCost')}>
              <Money value={sunToTrx(p.resourceCostSun)} />
            </Descriptions.Item>
            <Descriptions.Item label={t('fields.hop1Tx')}>
              <ExplorerLink kind="tx" value={p.hop1TxId} explorerUrl={p.hop1ExplorerUrl} short={false} />
            </Descriptions.Item>
            <Descriptions.Item label={t('fields.hop2Tx')}>
              <ExplorerLink kind="tx" value={p.txId} explorerUrl={p.explorerUrl} short={false} />
            </Descriptions.Item>
            <Descriptions.Item label={t('fields.broadcast')}>
              <DateCell value={p.broadcastAt} />
            </Descriptions.Item>
            <Descriptions.Item label={t('fields.confirmed')}>
              <DateCell value={p.confirmedAt} />
            </Descriptions.Item>
            <Descriptions.Item label={t('fields.createdBy')}>{p.createdBy}</Descriptions.Item>
            <Descriptions.Item label={t('fields.created')}>
              <DateCell value={p.createdAt} />
            </Descriptions.Item>
            <Descriptions.Item label={t('fields.updated')}>
              <DateCell value={p.updatedAt} />
            </Descriptions.Item>
            <Descriptions.Item label={t('fields.id')}>{p.id}</Descriptions.Item>
            <Descriptions.Item label={t('fields.note')} span={2}>
              {p.note ? <span style={{ whiteSpace: 'pre-wrap' }}>{p.note}</span> : '—'}
            </Descriptions.Item>
          </Descriptions>
          <Card size="small" title={t('page.payouts.resourceOps', { n: p.resourceOperations.length })}>
            <Table<ResourceOpDto> size="small" rowKey="id" columns={opCols} dataSource={p.resourceOperations} pagination={false} scroll={{ x: 1600 }} />
          </Card>
        </Space>
      )}
    </Show>
  );
};
