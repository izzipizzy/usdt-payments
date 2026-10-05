import { Alert, Button, Card, Collapse, Form, Input, Layout, Space, Steps, Tag, Typography } from 'antd';
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Navigate, useNavigate } from 'react-router';
import { adminUrl, request, setToken } from '../../api/http';
import { LangSwitch } from '../../components/LangSwitch';
import { APP_TITLE } from '../../config';

interface StartResult {
  attemptId: string;
  totpSecret: string;
  otpauthUri: string;
  qrDataUrl: string;
}
interface SetupStatus {
  needed: boolean;
  tokenMissing: boolean;
  network: 'nile' | 'mainnet';
  rpc: { urls: string[]; provider: 'trongrid' | 'custom'; apiKeySet: boolean; ok: boolean; block: number | null; latencyMs: number; error: string | null };
}
interface CompleteResult {
  token: string;
  role: string;
  expiresAt: number;
}

const MAINNET_ENV = `NETWORK=mainnet
TRON_RPC_URLS=https://api.trongrid.io
TRONGRID_API_KEY=<your free key from trongrid.io>`;
const NILE_ENV = `NETWORK=nile
TRON_RPC_URLS=https://nile.trongrid.io`;
const RESTART_CMD = 'docker compose --profile full up -d --force-recreate core watcher signer';

/** Step 0: which Tron network this instance is on, whether the RPC answers, and how to switch (via .env + restart). */
const NetworkStep = ({ status, onNext }: { status: SetupStatus | null; onNext: () => void }) => {
  const { t } = useTranslation();
  if (!status) return <Card loading />;
  const mainnet = status.network === 'mainnet';
  const rpc = status.rpc;
  return (
    <>
      <Space direction="vertical" size="middle" style={{ width: '100%' }}>
        <div>
          <Typography.Text strong>{t('setup.networkLabel')}: </Typography.Text>
          <Tag color={mainnet ? 'red' : 'blue'}>{mainnet ? t('setup.networkMainnet') : t('setup.networkNile')}</Tag>
          <Typography.Text type="secondary">{mainnet ? t('setup.networkMainnetHint') : t('setup.networkNileHint')}</Typography.Text>
        </div>
        <div>
          <Typography.Text strong>{t('setup.rpcLabel')}: </Typography.Text>
          <Typography.Text code>{rpc.urls.join(', ')}</Typography.Text>{' '}
          {rpc.ok ? <Tag color="green">{t('setup.rpcOk', { block: rpc.block, ms: rpc.latencyMs })}</Tag> : <Tag color="red">{t('setup.rpcFail')}</Tag>}
          {rpc.provider === 'trongrid' && (rpc.apiKeySet ? <Tag>{t('setup.keySet')}</Tag> : <Tag color="orange">{t('setup.keyMissing')}</Tag>)}
        </div>
        {!rpc.ok && <Alert type="error" showIcon message={t('setup.rpcFailTitle')} description={rpc.error ?? ''} />}
        {rpc.provider === 'trongrid' && !rpc.apiKeySet && (
          <Alert
            type={mainnet ? 'warning' : 'info'}
            showIcon
            message={t('setup.keyTitle')}
            description={
              <>
                {t('setup.keyText')}
                <pre style={{ margin: '8px 0 0' }}>{`TRONGRID_API_KEY=<key>\n${RESTART_CMD}`}</pre>
              </>
            }
          />
        )}
        <Collapse
          items={[
            {
              key: 'switch',
              label: mainnet ? t('setup.switchToNile') : t('setup.switchToMainnet'),
              children: (
                <>
                  <Typography.Paragraph>{t('setup.switchText')}</Typography.Paragraph>
                  <pre style={{ margin: 0 }}>{`${mainnet ? NILE_ENV : MAINNET_ENV}\n\n${RESTART_CMD}`}</pre>
                  <Typography.Paragraph type="secondary" style={{ marginTop: 8, marginBottom: 0 }}>
                    {t('setup.switchRefresh')}
                  </Typography.Paragraph>
                </>
              ),
            },
          ]}
        />
      </Space>
      <Button type="primary" block style={{ marginTop: 16 }} onClick={onNext} disabled={!rpc.ok}>
        {mainnet ? t('setup.continueMainnet') : t('setup.continueNile')}
      </Button>
    </>
  );
};

/**
 * First-run setup: shown while Core reports `setup.needed`. Step 1 = setup token (from .env SETUP_TOKEN or the Core
 * startup log) + username + password. Step 2 = scan the QR in an authenticator app and confirm with a code.
 * Completing it creates the admin account and logs in; the wallet onboarding page follows.
 */
export const SetupPage = () => {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const [needed, setNeeded] = useState<boolean | null>(null);
  const [tokenMissing, setTokenMissing] = useState(false);
  const [status, setStatus] = useState<SetupStatus | null>(null);
  const [step, setStep] = useState(0);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [setupToken, setSetupToken] = useState('');
  const [started, setStarted] = useState<StartResult | null>(null);

  useEffect(() => {
    let alive = true;
    const load = () =>
      request<SetupStatus>(adminUrl('/setup/status'), { token: null })
        .then((r) => {
          if (!alive) return;
          setNeeded(r.needed);
          setTokenMissing(r.tokenMissing);
          setStatus(r);
        })
        .catch((e) => {
          if (!alive) return;
          setNeeded(true);
          setError((e as Error).message);
        });
    void load();
    // Re-check every 5 s: the operator may edit .env and restart core while this page is open (network switch).
    const timer = setInterval(() => void load(), 5_000);
    return () => {
      alive = false;
      clearInterval(timer);
    };
  }, []);

  if (needed === false) return <Navigate to="/login" replace />;

  const start = async (v: { setupToken: string; username: string; password: string; confirm: string }) => {
    setError(null);
    if (v.password !== v.confirm) {
      setError(t('setup.passwordMismatch'));
      return;
    }
    setBusy(true);
    try {
      const res = await request<StartResult>(adminUrl('/setup/start'), { method: 'POST', body: { setupToken: v.setupToken.trim(), username: v.username.trim(), password: v.password }, token: null });
      setSetupToken(v.setupToken.trim());
      setStarted(res);
      setStep(2);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const complete = async (v: { code: string }) => {
    setError(null);
    setBusy(true);
    try {
      const res = await request<CompleteResult>(adminUrl('/setup/complete'), { method: 'POST', body: { setupToken, attemptId: started?.attemptId, code: v.code.replace(/\s/g, '') }, token: null });
      setToken(res.token);
      setStep(3);
      setTimeout(() => navigate('/wallet', { replace: true }), 600);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Layout style={{ minHeight: '100vh', alignItems: 'center', justifyContent: 'center', padding: 16 }}>
      <Card style={{ width: '100%', maxWidth: 520 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 8 }}>
          <Typography.Title level={4} style={{ marginTop: 0 }}>
            {APP_TITLE} — {t('setup.title')}
          </Typography.Title>
          <LangSwitch />
        </div>
        <Steps size="small" current={step} items={[{ title: t('setup.stepNetwork') }, { title: t('setup.stepAccount') }, { title: t('setup.stepTotp') }, { title: t('setup.stepDone') }]} style={{ marginBottom: 24 }} />
        {error && <Alert type="error" showIcon message={error} style={{ marginBottom: 16 }} />}

        {step === 0 && (
          <NetworkStep status={status} onNext={() => setStep(1)} />
        )}

        {step === 1 && tokenMissing && (
          <Alert
            type="warning"
            showIcon
            message={t('setup.tokenMissingTitle')}
            description={
              <>
                {t('setup.tokenMissingText')}
                <pre style={{ margin: '8px 0 0' }}>SETUP_TOKEN=my-first-setup-2026</pre>
              </>
            }
            style={{ marginBottom: 16 }}
          />
        )}
        {step === 1 && !tokenMissing && (
          <>
            <Typography.Paragraph type="secondary">{t('setup.introAccount')}</Typography.Paragraph>
            <Form layout="vertical" onFinish={start} requiredMark={false}>
              <Form.Item
                name="setupToken"
                label={t('setup.tokenLabel')}
                extra={t('setup.tokenHintEnv')}
                rules={[{ required: true, min: 8 }]}
              >
                <Input.Password autoFocus autoComplete="off" />
              </Form.Item>
              <Form.Item name="username" label={t('setup.usernameLabel')} initialValue="admin" rules={[{ required: true, pattern: /^[A-Za-z0-9._@-]{2,64}$/, message: t('setup.usernameRule') }]}>
                <Input autoComplete="username" />
              </Form.Item>
              <Form.Item name="password" label={t('setup.passwordLabel')} extra={t('setup.passwordHint')} rules={[{ required: true, min: 12, message: t('setup.passwordRule') }]}>
                <Input.Password autoComplete="new-password" />
              </Form.Item>
              <Form.Item name="confirm" label={t('setup.confirmLabel')} rules={[{ required: true, message: t('setup.passwordRule') }]}>
                <Input.Password autoComplete="new-password" />
              </Form.Item>
              <Button type="primary" htmlType="submit" block loading={busy}>
                {t('setup.next')}
              </Button>
            </Form>
          </>
        )}

        {step === 2 && started && (
          <>
            <Typography.Paragraph type="secondary">{t('setup.introTotp')}</Typography.Paragraph>
            <Space direction="vertical" align="center" style={{ width: '100%', marginBottom: 16 }}>
              <img src={started.qrDataUrl} alt="TOTP QR" width={220} height={220} style={{ imageRendering: 'pixelated' }} />
              <Typography.Text type="secondary">{t('setup.manualKey')}</Typography.Text>
              <Typography.Text code copyable>
                {started.totpSecret}
              </Typography.Text>
            </Space>
            <Form layout="vertical" onFinish={complete} requiredMark={false}>
              <Form.Item name="code" label={t('login.codeLabel')} rules={[{ required: true, pattern: /^\s*\d{6}\s*$/, message: t('auth.codeRequired') }]}>
                <Input autoFocus inputMode="numeric" autoComplete="one-time-code" maxLength={7} placeholder={t('login.codePlaceholder')} />
              </Form.Item>
              <Button type="primary" htmlType="submit" block loading={busy}>
                {t('setup.finish')}
              </Button>
            </Form>
          </>
        )}

        {step === 3 && <Alert type="success" showIcon message={t('setup.done')} />}
      </Card>
    </Layout>
  );
};
