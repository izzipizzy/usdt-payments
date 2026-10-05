import { MinusCircleOutlined, PlusCircleOutlined, ReloadOutlined } from '@ant-design/icons';
import { useCustom, useCustomMutation } from '@refinedev/core';
import { Alert, App, Button, Card, Col, Descriptions, Form, InputNumber, Modal, Progress, Row, Select, Space, Statistic, Tooltip, Typography } from 'antd';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { PoolConfiguredDto, PoolDto, PoolResource, PoolStakeBody, PoolTxResult } from '../../api/types';
import { ExplorerLink } from '../../components/ExplorerLink';
import { Money } from '../../components/Money';
import { DASHBOARD_REFRESH_MS } from '../../config';
import { enumLabel } from '../../i18n/labels';
import { useMe } from '../../providers/useMe';
import { formatDecimal, formatInt, shortHash } from '../../utils/format';

/** Energy needed by one TRC-20 USDT transfer, for the helper line. */
const ENERGY_PER_USDT_TRANSFER = '65 000';

type Mode = 'stake' | 'unstake';
const RESOURCES: PoolResource[] = ['ENERGY', 'BANDWIDTH'];
const numeric: React.CSSProperties = { fontVariantNumeric: 'tabular-nums' };

interface StakeFormVars {
  amountTrx: string;
  resource: PoolResource;
}

/** Amount + resource form; asks for confirmation, then POSTs /pool/{stake|unstake}. */
const StakeModal = ({ mode, open, onClose, onDone }: { mode: Mode; open: boolean; onClose: () => void; onDone: () => void }) => {
  const { t } = useTranslation();
  const { modal, notification, message } = App.useApp();
  const [form] = Form.useForm<StakeFormVars>();
  const { mutateAsync, isPending } = useCustomMutation<PoolTxResult>();

  const submit = async () => {
    const v = await form.validateFields();
    const amount = formatDecimal(v.amountTrx);
    const resource = enumLabel(t, 'resourceType', v.resource);
    modal.confirm({
      title: t(`page.pool.${mode}ConfirmTitle`, { amount, resource }),
      content: t(`page.pool.${mode}ConfirmContent`, { amount, resource }),
      okText: t('common.confirm'),
      cancelText: t('common.cancel'),
      okButtonProps: { danger: mode === 'unstake' },
      onOk: async () => {
        try {
          const body: PoolStakeBody = { amountTrx: String(v.amountTrx), resource: v.resource };
          const res = await mutateAsync({ url: `/pool/${mode}`, method: 'post', values: body, successNotification: false, errorNotification: false });
          const { txId, explorerUrl } = res.data;
          notification.success({
            message: t(`page.pool.${mode}Done`),
            description: (
              <Space size={4}>
                <span>{t('page.pool.txLabel')}:</span>
                {/* Plain link: the notification is rendered outside the Refine context. */}
                <a href={explorerUrl} target="_blank" rel="noreferrer noopener" style={{ fontFamily: 'monospace' }} title={txId}>
                  {shortHash(txId)}
                </a>
              </Space>
            ),
            duration: 12,
          });
          form.resetFields();
          onDone();
          onClose();
        } catch (e) {
          message.error((e as Error).message || t('common.actionFailed'));
          throw e;
        }
      },
    });
  };

  return (
    <Modal
      title={t(`page.pool.${mode}Title`)}
      open={open}
      onCancel={onClose}
      onOk={() => void submit()}
      okText={t(`page.pool.${mode}`)}
      cancelText={t('common.cancel')}
      confirmLoading={isPending}
      destroyOnClose
    >
      <Form<StakeFormVars> form={form} layout="vertical" style={{ marginTop: 12 }} initialValues={{ resource: 'ENERGY' }} requiredMark={false}>
        <Form.Item
          name="amountTrx"
          label={t('page.pool.amount')}
          rules={[
            { required: true, message: t('page.pool.amountRequired') },
            { validator: (_, v: string | undefined) => (v !== undefined && v !== null && Number(v) > 0 ? Promise.resolve() : Promise.reject(new Error(t('page.pool.amountPositive')))) },
          ]}
        >
          <InputNumber stringMode min="0" precision={6} style={{ width: '100%' }} autoFocus placeholder="100" />
        </Form.Item>
        <Form.Item name="resource" label={t('page.pool.resource')} rules={[{ required: true, message: t('common.required') }]}>
          <Select options={RESOURCES.map((r) => ({ value: r, label: enumLabel(t, 'resourceType', r) }))} />
        </Form.Item>
        {mode === 'unstake' && <Alert type="info" showIcon message={t('page.pool.unstakeNote')} />}
      </Form>
    </Modal>
  );
};

const PoolDetails = ({ p }: { p: PoolConfiguredDto }) => {
  const { t } = useTranslation();
  const percent = p.energyLimit > 0 ? Math.min(100, Math.round((p.energyUsed / p.energyLimit) * 100)) : 0;
  return (
    <Space direction="vertical" size="middle" style={{ width: '100%' }}>
      <Row gutter={[12, 12]}>
        <Col xs={24} md={8}>
          <Card size="small" title={t('page.pool.trxBalance')}>
            <Statistic value={formatDecimal(p.trxBalance)} suffix="TRX" valueStyle={numeric} />
            <Typography.Text type="secondary" style={{ fontSize: 12 }}>
              {t('page.pool.trxBalanceSun', { sun: formatDecimal(p.trxBalanceSun) })}
            </Typography.Text>
            <div style={{ marginTop: 8 }}>
              <ExplorerLink kind="address" value={p.address} explorerUrl={p.explorerUrl} />
            </div>
          </Card>
        </Col>
        <Col xs={24} md={16}>
          <Card size="small" title={t('page.pool.energy')}>
            <Progress
              percent={percent}
              status={percent >= 90 ? 'exception' : 'normal'}
              format={() => t('page.pool.energyUsedOf', { used: formatInt(p.energyUsed), limit: formatInt(p.energyLimit) })}
              style={numeric}
            />
            <Row gutter={8} style={{ marginTop: 8 }}>
              <Col span={8}>
                <Statistic title={t('page.pool.energyAvailable')} value={formatInt(p.energyAvailable)} valueStyle={{ ...numeric, fontSize: 16 }} />
              </Col>
              <Col span={8}>
                <Statistic title={t('page.pool.bandwidthAvailable')} value={formatInt(p.bandwidthAvailable)} valueStyle={{ ...numeric, fontSize: 16 }} />
              </Col>
              <Col span={8}>
                <Statistic title={t('page.pool.sweepsPerDay')} value={formatInt(p.estimatedSweepsPerDay)} valueStyle={{ ...numeric, fontSize: 16 }} />
              </Col>
            </Row>
            <Typography.Text type="secondary" style={{ fontSize: 12 }}>
              {t('page.pool.helper', { perTrx: formatDecimal(String(p.energyPerTrxPerDay)), perTransfer: ENERGY_PER_USDT_TRANSFER })}
            </Typography.Text>
          </Card>
        </Col>
      </Row>
      <Descriptions size="small" bordered column={{ xs: 1, md: 2, xl: 3 }}>
        <Descriptions.Item label={t('page.pool.address')}>
          <ExplorerLink kind="address" value={p.address} explorerUrl={p.explorerUrl} short={false} />
        </Descriptions.Item>
        <Descriptions.Item label={t('page.pool.energyLimit')}>
          <span style={numeric}>{formatInt(p.energyLimit)}</span>
        </Descriptions.Item>
        <Descriptions.Item label={t('page.pool.energyUsed')}>
          <span style={numeric}>{formatInt(p.energyUsed)}</span>
        </Descriptions.Item>
        <Descriptions.Item label={t('page.pool.stakedEnergy')}>
          <Money value={p.stakedForEnergyTrx} unit="TRX" />
        </Descriptions.Item>
        <Descriptions.Item label={t('page.pool.stakedBandwidth')}>
          <Money value={p.stakedForBandwidthTrx} unit="TRX" />
        </Descriptions.Item>
        <Descriptions.Item label={t('page.pool.delegatedOut')}>
          <Money value={p.delegatedOutEnergyTrx} unit="TRX" />
        </Descriptions.Item>
        <Descriptions.Item label={t('page.pool.energyPerTrx')}>
          <span style={numeric}>{formatDecimal(String(p.energyPerTrxPerDay))}</span>
        </Descriptions.Item>
      </Descriptions>
    </Space>
  );
};

export const PoolPage = () => {
  const { t } = useTranslation();
  const { isOperator } = useMe();
  const [mode, setMode] = useState<Mode | null>(null);
  const { data, isLoading, isFetching, error, refetch } = useCustom<PoolDto>({
    url: '/pool',
    method: 'get',
    queryOptions: { refetchInterval: DASHBOARD_REFRESH_MS, refetchOnWindowFocus: true },
    errorNotification: false,
  });
  const p = data?.data;
  const configured = p?.configured === true;
  const canAct = configured && isOperator;
  const hint = !configured ? t('page.pool.notConfiguredHint') : !isOperator ? t('page.pool.operatorOnly') : undefined;

  const actionButton = (m: Mode) => (
    <Tooltip title={hint}>
      <Button
        type={m === 'stake' ? 'primary' : 'default'}
        danger={m === 'unstake'}
        icon={m === 'stake' ? <PlusCircleOutlined /> : <MinusCircleOutlined />}
        disabled={!canAct}
        onClick={() => setMode(m)}
      >
        {t(`page.pool.${m}`)}
      </Button>
    </Tooltip>
  );

  return (
    <Space direction="vertical" size="middle" style={{ width: '100%' }}>
      <Space style={{ width: '100%', justifyContent: 'space-between' }} wrap>
        <Typography.Title level={4} style={{ margin: 0 }}>
          {t('page.pool.title')}
        </Typography.Title>
        <Space wrap>
          <Button icon={<ReloadOutlined />} loading={isFetching} onClick={() => void refetch()}>
            {t('common.refresh')}
          </Button>
          {actionButton('stake')}
          {actionButton('unstake')}
        </Space>
      </Space>

      {error && <Alert type="error" showIcon message={t('page.pool.loadFailed')} description={error.message} />}
      {p && !p.configured && (
        <Alert type="warning" showIcon message={t('page.pool.notConfigured')} description={[p.reason, t('page.pool.notConfiguredHint')].filter(Boolean).join(' — ')} />
      )}

      <Card size="small" loading={isLoading} styles={{ body: p?.configured ? undefined : { display: 'none' } }}>
        {p?.configured && <PoolDetails p={p} />}
      </Card>

      {mode && <StakeModal mode={mode} open onClose={() => setMode(null)} onDone={() => void refetch()} />}
    </Space>
  );
};
