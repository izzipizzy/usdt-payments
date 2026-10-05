import { useCustom, useCustomMutation } from '@refinedev/core';
import { Alert, App, Button, Card, Checkbox, Form, Input, InputNumber, Select, Space, Spin, Switch, Typography } from 'antd';
import { useEffect, useState } from 'react';
import { Trans, useTranslation } from 'react-i18next';
import type { AdminSettings, AdminSettingsPatch, ProviderDto, ProviderTestResult } from '@usdt-trx/shared';
import { roleLabel } from '../../i18n/labels';
import { useMe } from '../../providers/useMe';

const DECIMAL = /^\d+(\.\d+)?$/;
const INTEGER = /^\d+$/;
const ITRX = 'itrx';
const ITRX_URL = 'https://itrx.io';

/** providerOrder with `itrx` moved to the front (first = true) or removed (first = false); other entries keep their order. */
const withItrxFirst = (order: string[] | undefined, first: boolean): string[] => {
  const rest = (order ?? []).filter((p) => p !== ITRX);
  return first ? [ITRX, ...rest] : rest;
};

/** Form for AdminSettings. Only `admin` can save; everyone else sees a read-only form. */
export const SettingsPage = () => {
  const { t } = useTranslation();
  const { isAdmin, isOperator, role } = useMe();
  const { message } = App.useApp();
  const [form] = Form.useForm<AdminSettings>();
  const { data, isLoading, error, refetch } = useCustom<AdminSettings>({ url: '/settings', method: 'get' });
  const { data: providers } = useCustom<ProviderDto[]>({ url: '/providers', method: 'get' });
  const { mutateAsync, isPending } = useCustomMutation<AdminSettings>();
  const { mutateAsync: testItrx, isPending: testing } = useCustomMutation<ProviderTestResult>();
  const [testResult, setTestResult] = useState<ProviderTestResult | { ok: false; detail: string } | null>(null);
  const settings = data?.data;
  const providerOrder = Form.useWatch('providerOrder', form);
  const itrxFirst = providerOrder?.[0] === ITRX;

  useEffect(() => {
    if (settings) form.setFieldsValue({ ...settings, itrxApiSecret: '' });
  }, [settings, form]);

  const onFinish = async (values: AdminSettings) => {
    if (!settings) return;
    // Send only fields that changed. The secret is write-only: GET echoes '' and an empty
    // input means "keep"; `itrxApiSecretSet` is a server-side flag and never sent.
    const patch: AdminSettingsPatch = {};
    for (const key of Object.keys(values) as (keyof AdminSettings)[]) {
      if (key === 'itrxApiSecretSet') continue;
      const before = settings[key];
      const after = values[key];
      if (key === 'itrxApiSecret') {
        if (typeof after === 'string' && after !== '') patch.itrxApiSecret = after;
        continue;
      }
      if (JSON.stringify(before) !== JSON.stringify(after)) {
        (patch as Record<string, unknown>)[key] = after;
      }
    }
    if (Object.keys(patch).length === 0) {
      message.info(t('page.settings.noChanges'));
      return;
    }
    try {
      await mutateAsync({ url: '/settings', method: 'patch', values: patch, successNotification: false, errorNotification: false });
      message.success(t('page.settings.saved', { fields: Object.keys(patch).join(', ') }));
      await refetch();
    } catch (e) {
      message.error((e as Error).message || t('page.settings.saveFailed'));
    }
  };

  const onTest = async () => {
    setTestResult(null);
    try {
      const res = await testItrx({ url: '/providers/itrx/test', method: 'post', values: {}, successNotification: false, errorNotification: false });
      setTestResult(res.data);
    } catch (e) {
      setTestResult({ ok: false, detail: (e as Error).message || t('common.actionFailed') });
    }
  };

  const providerOptions = (providers?.data ?? []).map((p) => ({ value: p.name, label: `${p.name}${p.enabled ? '' : ` ${t('page.settings.disabledSuffix')}`}` }));
  const required = { required: true, message: t('common.required') };
  const secretPlaceholder = settings?.itrxApiSecretSet ? t('page.settings.itrxSecretSetPlaceholder') : t('page.settings.itrxSecretUnsetPlaceholder');

  return (
    <Card title={t('page.settings.title')} style={{ maxWidth: 760 }}>
      <Spin spinning={isLoading}>
        {error && <Alert type="error" showIcon message={error.message} style={{ marginBottom: 16 }} />}
        {!isAdmin && <Alert type="info" showIcon message={t('page.settings.readOnly', { role: role ? roleLabel(t, role) : t('common.unknown') })} style={{ marginBottom: 16 }} />}
        <Form<AdminSettings> form={form} layout="vertical" disabled={!isAdmin || isPending} onFinish={(v) => void onFinish(v)} requiredMark={false}>
          <Typography.Title level={5}>{t('page.settings.itrxTitle')}</Typography.Title>
          <Typography.Paragraph type="secondary">
            <Trans i18nKey="page.settings.itrxIntro" components={{ link: <a href={ITRX_URL} target="_blank" rel="noreferrer" /> }} />
          </Typography.Paragraph>
          <Space wrap size="large" align="start">
            <Form.Item name="itrxApiKey" label={t('page.settings.itrxApiKey')}>
              <Input style={{ width: 280 }} autoComplete="off" spellCheck={false} />
            </Form.Item>
            <Form.Item name="itrxApiSecret" label={t('page.settings.itrxApiSecret')} extra={t('page.settings.itrxApiSecretExtra')}>
              <Input.Password style={{ width: 280 }} placeholder={secretPlaceholder} autoComplete="new-password" />
            </Form.Item>
            <Form.Item name="itrxRentPeriod" label={t('page.settings.itrxRentPeriod')} extra={t('page.settings.itrxRentPeriodExtra')}>
              <Select
                style={{ width: 140 }}
                options={[
                  { value: '1H', label: t('page.settings.itrxRentPeriod1H') },
                  { value: '1D', label: t('page.settings.itrxRentPeriod1D') },
                ]}
              />
            </Form.Item>
          </Space>
          <Form.Item extra={t('page.settings.itrxFirstExtra')}>
            <Checkbox checked={itrxFirst} onChange={(e) => form.setFieldValue('providerOrder', withItrxFirst(providerOrder, e.target.checked))}>
              {t('page.settings.itrxFirst')}
            </Checkbox>
          </Form.Item>
          <Form.Item extra={t('page.settings.itrxTestExtra')}>
            <Button onClick={() => void onTest()} loading={testing} disabled={!isOperator || testing}>
              {t('page.settings.itrxTest')}
            </Button>
          </Form.Item>
          {testResult && (
            <Alert
              type={testResult.ok ? 'success' : 'error'}
              showIcon
              style={{ marginBottom: 24 }}
              message={testResult.ok ? t('page.settings.itrxTestOk') : t('page.settings.itrxTestFailed')}
              description={
                testResult.ok && 'unitPriceSun' in testResult ? (
                  <Space direction="vertical" size={0}>
                    {testResult.unitPriceSun !== null && <span>{t('page.settings.itrxUnitPrice', { sun: testResult.unitPriceSun })}</span>}
                    {testResult.transferCostTrx !== null && <span>{t('page.settings.itrxTransferCost', { trx: testResult.transferCostTrx })}</span>}
                    {testResult.balanceTrx !== null && <span>{t('page.settings.itrxBalance', { trx: testResult.balanceTrx })}</span>}
                    {testResult.detail && <Typography.Text type="secondary">{testResult.detail}</Typography.Text>}
                  </Space>
                ) : (
                  testResult.detail
                )
              }
            />
          )}

          <Typography.Title level={5}>{t('page.settings.sweepPolicy')}</Typography.Title>
          <Space wrap size="large" align="start">
            <Form.Item name="sweepMinUsdt" label={t('page.settings.sweepMin')} rules={[required, { pattern: DECIMAL, message: t('common.decimal') }]} extra={t('page.settings.sweepMinExtra')}>
              <Input style={{ width: 160 }} />
            </Form.Item>
            <Form.Item name="sweepMaxAgeHours" label={t('page.settings.sweepMaxAge')} rules={[required]} extra={t('page.settings.sweepMaxAgeExtra')}>
              <InputNumber min={1} precision={0} style={{ width: 160 }} />
            </Form.Item>
            <Form.Item name="sweepMaxPerHour" label={t('page.settings.sweepMaxPerHour')} rules={[required]}>
              <InputNumber min={0} precision={0} style={{ width: 160 }} />
            </Form.Item>
            <Form.Item name="minDepositUsdt" label={t('page.settings.minDeposit')} rules={[required, { pattern: DECIMAL, message: t('common.decimal') }]} extra={t('page.settings.minDepositExtra')}>
              <Input style={{ width: 160 }} />
            </Form.Item>
          </Space>

          <Typography.Title level={5}>{t('page.settings.payouts')}</Typography.Title>
          <Space wrap size="large" align="start">
            <Form.Item name="payoutMaxUsdt" label={t('page.settings.payoutMax')} rules={[required, { pattern: DECIMAL, message: t('common.decimal') }]} extra={t('page.settings.payoutMaxExtra')}>
              <Input style={{ width: 180 }} />
            </Form.Item>
            <Form.Item name="payoutDailyMaxUsdt" label={t('page.settings.payoutDailyMax')} rules={[required, { pattern: DECIMAL, message: t('common.decimal') }]} extra={t('page.settings.payoutDailyMaxExtra')}>
              <Input style={{ width: 180 }} />
            </Form.Item>
          </Space>

          <Typography.Title level={5}>{t('page.settings.energyFees')}</Typography.Title>
          <Space wrap size="large" align="start">
            <Form.Item name="feeLimitSun" label={t('page.settings.feeLimit')} rules={[required, { pattern: INTEGER, message: t('common.integer') }]} extra={t('page.settings.feeLimitExtra')}>
              <Input style={{ width: 180 }} />
            </Form.Item>
            <Form.Item name="energyMargin" label={t('page.settings.energyMargin')} rules={[required]} extra={t('page.settings.energyMarginExtra')}>
              <InputNumber min={1} max={3} step={0.05} style={{ width: 160 }} />
            </Form.Item>
            <Form.Item name="energyDailyBudgetSun" label={t('page.settings.dailyBudget')} rules={[required, { pattern: INTEGER, message: t('common.integer') }]}>
              <Input style={{ width: 180 }} />
            </Form.Item>
          </Space>
          <Form.Item name="providerOrder" label={t('page.settings.providerOrder')} extra={t('page.settings.providerOrderExtra')}>
            <Select mode="tags" options={providerOptions} style={{ maxWidth: 480 }} placeholder={t('page.settings.providerOrderPlaceholder')} tokenSeparators={[',', ' ']} />
          </Form.Item>
          <Space size="large">
            <Form.Item name="burnEnabled" label={t('page.settings.burnEnabled')} valuePropName="checked">
              <Switch />
            </Form.Item>
            <Form.Item name="leaveDustOnAddress" label={t('page.settings.leaveDust')} valuePropName="checked">
              <Switch />
            </Form.Item>
          </Space>
          {isAdmin && (
            <Form.Item>
              <Space>
                <Button type="primary" htmlType="submit" loading={isPending}>
                  {t('page.settings.save')}
                </Button>
                <Button onClick={() => settings && form.setFieldsValue(settings)}>{t('page.settings.reset')}</Button>
              </Space>
            </Form.Item>
          )}
        </Form>
      </Spin>
    </Card>
  );
};
