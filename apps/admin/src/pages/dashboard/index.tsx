import { ReloadOutlined } from '@ant-design/icons';
import { useCustom, useCustomMutation, useInvalidate } from '@refinedev/core';
import { Alert, App, Button, Card, Col, Descriptions, Row, Space, Statistic, Table, Tag, Typography } from 'antd';
import type { ColumnsType } from 'antd/es/table';
import dayjs from 'dayjs';
import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router';
import type { DashboardDto } from '@usdt-trx/shared';
import type { PoolDto } from '../../api/types';
import { DateCell } from '../../components/DateCell';
import { ExplorerLink } from '../../components/ExplorerLink';
import { Money } from '../../components/Money';
import { DASHBOARD_REFRESH_MS, WATCHER_LAG_WARN_BLOCKS } from '../../config';
import { enumLabel } from '../../i18n/labels';
import { useMe } from '../../providers/useMe';
import { formatDecimal, formatInt, sunToTrx } from '../../utils/format';

type QueueRow = DashboardDto['queues'][number];
type ProviderRow = DashboardDto['providers'][number];

const numeric: React.CSSProperties = { fontVariantNumeric: 'tabular-nums' };

/** Small "Energy pool" tile; renders nothing unless the pool is configured. */
const PoolCard = () => {
  const { t } = useTranslation();
  const { data, isLoading } = useCustom<PoolDto>({
    url: '/pool',
    method: 'get',
    queryOptions: { refetchInterval: DASHBOARD_REFRESH_MS, retry: false },
    errorNotification: false,
  });
  const p = data?.data;
  if (!isLoading && (!p || !p.configured)) return null;
  return (
    <Card
      size="small"
      loading={isLoading}
      title={<Link to="/pool">{t('page.dashboard.poolTitle')}</Link>}
      extra={
        <Link to="/pool" style={{ fontSize: 12 }}>
          {t('page.dashboard.poolOpen')}
        </Link>
      }
    >
      {p?.configured && (
        <>
          <Statistic title={t('page.dashboard.poolEnergyAvailable')} value={formatInt(p.energyAvailable)} valueStyle={numeric} />
          <Statistic title={t('page.dashboard.poolTrxBalance')} value={formatDecimal(p.trxBalance)} valueStyle={{ ...numeric, fontSize: 16 }} />
          <div style={{ marginTop: 8 }}>
            <ExplorerLink kind="address" value={p.address} explorerUrl={p.explorerUrl} />
          </div>
        </>
      )}
    </Card>
  );
};

export const Dashboard = () => {
  const { t, i18n } = useTranslation();
  const { isOperator } = useMe();
  const { modal, message } = App.useApp();
  const invalidate = useInvalidate();
  const { data, isLoading, isFetching, error, refetch, dataUpdatedAt } = useCustom<DashboardDto>({
    url: '/dashboard',
    method: 'get',
    queryOptions: { refetchInterval: DASHBOARD_REFRESH_MS, refetchOnWindowFocus: true },
  });
  const { mutate, isPending } = useCustomMutation();
  const d = data?.data;

  const queueColumns = useMemo<ColumnsType<QueueRow>>(
    () => [
      { title: t('fields.queue'), dataIndex: 'name', key: 'name' },
      { title: t('fields.waiting'), dataIndex: 'waiting', key: 'waiting', align: 'right', render: formatInt },
      { title: t('fields.active'), dataIndex: 'active', key: 'active', align: 'right', render: formatInt },
      { title: t('fields.delayed'), dataIndex: 'delayed', key: 'delayed', align: 'right', render: formatInt },
      {
        title: t('fields.failed'),
        dataIndex: 'failed',
        key: 'failed',
        align: 'right',
        render: (v: number) => <span style={{ color: v > 0 ? '#cf1322' : undefined, fontWeight: v > 0 ? 600 : undefined }}>{formatInt(v)}</span>,
      },
    ],
    [t],
  );

  const providerColumns = useMemo<ColumnsType<ProviderRow>>(
    () => [
      { title: t('fields.provider'), dataIndex: 'name', key: 'name' },
      {
        title: t('fields.health'),
        dataIndex: 'healthy',
        key: 'healthy',
        render: (v: boolean) => <Tag color={v ? 'green' : 'red'}>{enumLabel(t, 'health', v ? 'healthy' : 'unhealthy')}</Tag>,
      },
      {
        title: t('fields.balanceTrx'),
        dataIndex: 'balanceSun',
        key: 'balanceSun',
        align: 'right',
        render: (v: string | null) => <Money value={sunToTrx(v)} />,
      },
      { title: t('fields.detail'), dataIndex: 'detail', key: 'detail', render: (v: string | null) => v ?? '—' },
    ],
    [t],
  );

  const runAction = (title: string, content: string, url: string, onDone: (r: Record<string, unknown>) => string) =>
    modal.confirm({
      title,
      content,
      okText: t('common.confirm'),
      cancelText: t('common.cancel'),
      onOk: () =>
        new Promise<void>((resolve, reject) => {
          mutate(
            { url, method: 'post', values: {}, successNotification: false },
            {
              onSuccess: (res) => {
                message.success(onDone((res.data ?? {}) as Record<string, unknown>));
                void refetch();
                void invalidate({ resource: 'addresses', invalidates: ['list'] });
                void invalidate({ resource: 'sweeps', invalidates: ['list'] });
                resolve();
              },
              onError: (e) => {
                message.error(e.message);
                reject(e);
              },
            },
          );
        }),
    });

  const lag = d?.watcher.lagBlocks ?? null;
  const lagWarn = lag !== null && lag > WATCHER_LAG_WARN_BLOCKS;
  const lagColor = lag === null ? undefined : lagWarn ? '#cf1322' : '#3f8600';

  return (
    <Space direction="vertical" size="middle" style={{ width: '100%' }}>
      <Space style={{ width: '100%', justifyContent: 'space-between' }} wrap>
        <Space>
          <Typography.Title level={4} style={{ margin: 0 }}>
            {t('page.dashboard.title')}
          </Typography.Title>
          {d?.network && <Tag>{d.network}</Tag>}
          <Typography.Text type="secondary" style={{ fontSize: 12 }}>
            {dataUpdatedAt
              ? t('page.dashboard.updatedAuto', { time: dayjs(dataUpdatedAt).locale(i18n.language).format('LTS'), seconds: DASHBOARD_REFRESH_MS / 1000 })
              : ''}
          </Typography.Text>
        </Space>
        <Space wrap>
          <Button icon={<ReloadOutlined />} loading={isFetching} onClick={() => void refetch()}>
            {t('common.refresh')}
          </Button>
          {isOperator && (
            <>
              <Button
                loading={isPending}
                onClick={() =>
                  runAction(t('page.dashboard.recalc'), t('page.dashboard.recalcContent'), '/balances/recalculate', (r) =>
                    t('page.dashboard.recalcDone', { n: String(r.queued ?? '?') }),
                  )
                }
              >
                {t('page.dashboard.recalc')}
              </Button>
              <Button
                type="primary"
                loading={isPending}
                onClick={() =>
                  runAction(t('page.dashboard.sweepAll'), t('page.dashboard.sweepAllContent'), '/sweeps/sweep-all', (r) =>
                    t('page.dashboard.sweepAllDone', { n: String(r.planned ?? '?') }),
                  )
                }
              >
                {t('page.dashboard.sweepAll')}
              </Button>
            </>
          )}
        </Space>
      </Space>

      {error && <Alert type="error" showIcon message={t('page.dashboard.loadFailed')} description={error.message} />}

      <Row gutter={[12, 12]}>
        <Col xs={24} md={12} xl={6}>
          <Card size="small" loading={isLoading} title={t('page.dashboard.collector')}>
            <Statistic title="USDT" value={formatDecimal(d?.collector.usdtBalance)} valueStyle={numeric} />
            <Statistic title="TRX" value={formatDecimal(d?.collector.trxBalance)} valueStyle={{ ...numeric, fontSize: 16 }} />
            <div style={{ marginTop: 8 }}>
              <ExplorerLink kind="address" value={d?.collector.address} explorerUrl={d?.collector.explorerUrl} />
            </div>
          </Card>
        </Col>
        <Col xs={24} md={12} xl={6}>
          <Card size="small" loading={isLoading} title={t('page.dashboard.depositAddresses')}>
            <Statistic title={t('page.dashboard.usdtOnAddresses')} value={formatDecimal(d?.addresses.usdtTotal)} valueStyle={numeric} />
            <Row gutter={8} style={{ marginTop: 8 }}>
              <Col span={8}>
                <Statistic title={t('page.dashboard.total')} value={formatInt(d?.addresses.total)} valueStyle={{ ...numeric, fontSize: 16 }} />
              </Col>
              <Col span={8}>
                <Statistic title={t('page.dashboard.assigned')} value={formatInt(d?.addresses.assigned)} valueStyle={{ ...numeric, fontSize: 16 }} />
              </Col>
              <Col span={8}>
                <Statistic title={t('page.dashboard.withBalance')} value={formatInt(d?.addresses.withBalance)} valueStyle={{ ...numeric, fontSize: 16 }} />
              </Col>
            </Row>
          </Card>
        </Col>
        <Col xs={24} md={12} xl={6}>
          <Card size="small" loading={isLoading} title={t('page.dashboard.watcher')}>
            <Statistic title={t('page.dashboard.lagBlocks')} value={lag === null ? '—' : formatInt(lag)} valueStyle={{ ...numeric, color: lagColor }} />
            <Row gutter={8} style={{ marginTop: 8 }}>
              <Col span={12}>
                <Statistic title={t('page.dashboard.solidBlock')} value={formatInt(d?.watcher.solidBlock)} valueStyle={{ ...numeric, fontSize: 16 }} />
              </Col>
              <Col span={12}>
                <Statistic title={t('page.dashboard.cursor')} value={formatInt(d?.watcher.cursorBlock)} valueStyle={{ ...numeric, fontSize: 16 }} />
              </Col>
            </Row>
            <Typography.Text type="secondary" style={{ fontSize: 12 }}>
              {t('page.dashboard.updated')} <DateCell value={d?.watcher.updatedAt} relative />
            </Typography.Text>
            {lagWarn && <Alert type="warning" showIcon style={{ marginTop: 8 }} message={t('page.dashboard.lagWarn', { lag, max: WATCHER_LAG_WARN_BLOCKS })} />}
          </Card>
        </Col>
        <Col xs={24} md={12} xl={6}>
          <Card size="small" loading={isLoading} title={t('page.dashboard.sweeps24h')}>
            <Statistic title={t('page.dashboard.costTrx')} value={formatDecimal(d?.sweeps24h.costTrx)} valueStyle={numeric} />
            <Row gutter={8} style={{ marginTop: 8 }}>
              <Col span={8}>
                <Statistic title={t('page.dashboard.count')} value={formatInt(d?.sweeps24h.count)} valueStyle={{ ...numeric, fontSize: 16 }} />
              </Col>
              <Col span={8}>
                <Statistic title={t('page.dashboard.confirmed')} value={formatInt(d?.sweeps24h.confirmed)} valueStyle={{ ...numeric, fontSize: 16, color: '#3f8600' }} />
              </Col>
              <Col span={8}>
                <Statistic
                  title={t('page.dashboard.failed')}
                  value={formatInt(d?.sweeps24h.failed)}
                  valueStyle={{ ...numeric, fontSize: 16, color: d && d.sweeps24h.failed > 0 ? '#cf1322' : undefined }}
                />
              </Col>
            </Row>
          </Card>
        </Col>
      </Row>

      <Row gutter={[12, 12]}>
        <Col xs={24} xl={9}>
          <Card size="small" title={t('page.dashboard.queues')} loading={isLoading}>
            <Table<QueueRow> size="small" rowKey="name" pagination={false} columns={queueColumns} dataSource={d?.queues ?? []} />
          </Card>
        </Col>
        <Col xs={24} xl={9}>
          <Card size="small" title={t('page.dashboard.energyProviders')} loading={isLoading}>
            <Table<ProviderRow> size="small" rowKey="name" pagination={false} columns={providerColumns} dataSource={d?.providers ?? []} />
          </Card>
        </Col>
        <Col xs={24} md={12} xl={6}>
          <PoolCard />
        </Col>
      </Row>

      <Card size="small" title={t('page.dashboard.chainParams')} loading={isLoading}>
        <Descriptions size="small" column={{ xs: 1, sm: 3 }}>
          <Descriptions.Item label={t('page.dashboard.energyFee')}>{formatInt(d?.chainParams.energyFeeSun)}</Descriptions.Item>
          <Descriptions.Item label={t('page.dashboard.bandwidthFee')}>{formatInt(d?.chainParams.bandwidthFeeSun)}</Descriptions.Item>
          <Descriptions.Item label={t('page.dashboard.createAccountFee')}>{formatInt(d?.chainParams.createAccountFeeSun)}</Descriptions.Item>
        </Descriptions>
      </Card>
    </Space>
  );
};
