import { useLogin } from '@refinedev/core';
import { Alert, Button, Card, Form, Input, Layout, Typography } from 'antd';
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Navigate } from 'react-router';
import { adminUrl, request } from '../../api/http';
import { LangSwitch } from '../../components/LangSwitch';
import { APP_TITLE } from '../../config';
import type { LoginParams } from '../../providers/authProvider';

/** Password + authenticator code → session token (2FA is mandatory on the server). */
export const LoginPage = () => {
  const { t } = useTranslation();
  const { mutate: login, isPending, error } = useLogin<LoginParams>();
  const [setupNeeded, setSetupNeeded] = useState(false);
  useEffect(() => {
    request<{ needed: boolean }>(adminUrl('/setup/status'), { token: null })
      .then((r) => setSetupNeeded(r.needed))
      .catch(() => undefined);
  }, []);
  if (setupNeeded) return <Navigate to="/setup" replace />;
  return (
    <Layout style={{ minHeight: '100vh', alignItems: 'center', justifyContent: 'center', padding: 16 }}>
      <Card style={{ width: '100%', maxWidth: 400 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 8 }}>
          <Typography.Title level={4} style={{ marginTop: 0 }}>
            {APP_TITLE}
          </Typography.Title>
          <LangSwitch />
        </div>
        <Typography.Paragraph type="secondary">{t('login.intro')}</Typography.Paragraph>
        {error && <Alert type="error" showIcon message={error.message ?? t('auth.loginFailed')} style={{ marginBottom: 16 }} />}
        <Form<LoginParams> layout="vertical" onFinish={(v) => login(v)} requiredMark={false}>
          <Form.Item name="password" label={t('login.passwordLabel')} rules={[{ required: true, message: t('login.passwordRequired') }]}>
            <Input.Password autoFocus placeholder={t('login.passwordPlaceholder')} autoComplete="current-password" />
          </Form.Item>
          <Form.Item name="code" label={t('login.codeLabel')} rules={[{ required: true, pattern: /^\s*\d{6}\s*$/, message: t('auth.codeRequired') }]}>
            <Input placeholder={t('login.codePlaceholder')} inputMode="numeric" autoComplete="one-time-code" maxLength={7} />
          </Form.Item>
          <Button type="primary" htmlType="submit" block loading={isPending}>
            {t('login.signIn')}
          </Button>
        </Form>
      </Card>
    </Layout>
  );
};
