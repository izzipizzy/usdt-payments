import {
  AppstoreOutlined,
  AuditOutlined,
  DashboardOutlined,
  DatabaseOutlined,
  DownloadOutlined,
  KeyOutlined,
  SendOutlined,
  SettingOutlined,
  SwapOutlined,
  ThunderboltOutlined,
  WalletOutlined,
} from '@ant-design/icons';
import { ErrorComponent, ThemedLayoutV2, ThemedSiderV2, useNotificationProvider } from '@refinedev/antd';
import { Authenticated, Refine, type I18nProvider } from '@refinedev/core';
import routerProvider, { CatchAllNavigate, DocumentTitleHandler, NavigateToResource } from '@refinedev/react-router';
import { App as AntdApp, ConfigProvider } from 'antd';
import enUS from 'antd/locale/en_US';
import ruRU from 'antd/locale/ru_RU';
import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { BrowserRouter, Navigate, Outlet, Route, Routes } from 'react-router';
import '@refinedev/antd/dist/reset.css';
import { Header } from './components/Header';
import { Title } from './components/Title';
import { WalletGuard } from './components/WalletGuard';
import { APP_TITLE } from './config';
import { setLang, toLang, type Lang } from './i18n';
import { AddressList } from './pages/addresses/list';
import { AddressShow } from './pages/addresses/show';
import { AuditList } from './pages/audit/list';
import { Dashboard } from './pages/dashboard';
import { DepositList } from './pages/deposits/list';
import { LoginPage } from './pages/login';
import { SetupPage } from './pages/setup';
import { PayoutList } from './pages/payouts/list';
import { PayoutShow } from './pages/payouts/show';
import { PoolPage } from './pages/pool';
import { ResourceList } from './pages/resources/list';
import { SettingsPage } from './pages/settings';
import { SweepList } from './pages/sweeps/list';
import { SweepShow } from './pages/sweeps/show';
import { WalletPage } from './pages/wallet';
import { accessControlProvider } from './providers/accessControlProvider';
import { authProvider } from './providers/authProvider';
import { dataProvider } from './providers/dataProvider';
import { StepUpPrompter } from './providers/useStepUp';

const ANTD_LOCALE: Record<Lang, typeof enUS> = { en: enUS, ru: ruRU };

export default function App() {
  const { t, i18n } = useTranslation();
  const lang = toLang(i18n.language);

  const i18nProvider = useMemo<I18nProvider>(
    () => ({
      // Refine calls translate(key, options, default) but also translate(key, default).
      translate: (key: string, options?: unknown, defaultMessage?: string) =>
        typeof options === 'string'
          ? t(key, { defaultValue: options })
          : t(key, { ...((options as Record<string, unknown> | undefined) ?? {}), defaultValue: defaultMessage ?? key }),
      changeLocale: (locale: string) => setLang(toLang(locale)),
      getLocale: () => toLang(i18n.language),
    }),
    [t, i18n],
  );

  // Menu order: wallet, addresses, deposits, sweeps, payouts, then the collapsible
  // "Advanced" group (dashboard, energy pool, resources, settings, audit).
  const resources = useMemo(
    () => [
      { name: 'wallet', list: '/wallet', meta: { label: t('wallet.wallet'), icon: <KeyOutlined /> } },
      { name: 'addresses', list: '/addresses', show: '/addresses/:id', meta: { label: t('addresses.addresses'), icon: <WalletOutlined /> } },
      { name: 'deposits', list: '/deposits', meta: { label: t('deposits.deposits'), icon: <DownloadOutlined /> } },
      { name: 'sweeps', list: '/sweeps', show: '/sweeps/:id', meta: { label: t('sweeps.sweeps'), icon: <SwapOutlined /> } },
      { name: 'payouts', list: '/payouts', show: '/payouts/:id', meta: { label: t('payouts.payouts'), icon: <SendOutlined /> } },
      { name: 'advanced', meta: { label: t('advanced.advanced'), icon: <AppstoreOutlined /> } },
      { name: 'dashboard', list: '/dashboard', meta: { parent: 'advanced', label: t('dashboard.dashboard'), icon: <DashboardOutlined /> } },
      { name: 'pool', list: '/pool', meta: { parent: 'advanced', label: t('pool.pool'), icon: <DatabaseOutlined /> } },
      { name: 'resources', list: '/resources', meta: { parent: 'advanced', label: t('resources.resources'), icon: <ThunderboltOutlined /> } },
      { name: 'settings', list: '/settings', meta: { parent: 'advanced', label: t('settings.settings'), icon: <SettingOutlined /> } },
      { name: 'audit', list: '/audit', meta: { parent: 'advanced', label: t('audit.audit'), icon: <AuditOutlined /> } },
    ],
    [t],
  );

  return (
    <BrowserRouter>
      <ConfigProvider componentSize="small" theme={{ token: { borderRadius: 4 } }} locale={ANTD_LOCALE[lang]}>
        <AntdApp>
          <StepUpPrompter />
          <Refine
            dataProvider={dataProvider}
            authProvider={authProvider}
            accessControlProvider={accessControlProvider}
            routerProvider={routerProvider}
            notificationProvider={useNotificationProvider}
            i18nProvider={i18nProvider}
            resources={resources}
            options={{
              syncWithLocation: true,
              warnWhenUnsavedChanges: true,
              disableTelemetry: true,
              projectId: 'usdt-trx-admin',
              title: { text: APP_TITLE, icon: null },
            }}
          >
            <Routes>
              <Route
                element={
                  <Authenticated key="authenticated" fallback={<CatchAllNavigate to="/login" />}>
                    <ThemedLayoutV2 Header={Header} Sider={(props) => <ThemedSiderV2 {...props} fixed />} Title={Title}>
                      <WalletGuard>
                        <Outlet />
                      </WalletGuard>
                    </ThemedLayoutV2>
                  </Authenticated>
                }
              >
                <Route index element={<Navigate to="/wallet" replace />} />
                <Route path="/wallet" element={<WalletPage />} />
                <Route path="/dashboard" element={<Dashboard />} />
                <Route path="/addresses">
                  <Route index element={<AddressList />} />
                  <Route path=":id" element={<AddressShow />} />
                </Route>
                <Route path="/deposits" element={<DepositList />} />
                <Route path="/sweeps">
                  <Route index element={<SweepList />} />
                  <Route path=":id" element={<SweepShow />} />
                </Route>
                <Route path="/payouts">
                  <Route index element={<PayoutList />} />
                  <Route path=":id" element={<PayoutShow />} />
                </Route>
                <Route path="/resources" element={<ResourceList />} />
                <Route path="/pool" element={<PoolPage />} />
                <Route path="/settings" element={<SettingsPage />} />
                <Route path="/audit" element={<AuditList />} />
                <Route path="*" element={<ErrorComponent />} />
              </Route>
              <Route
                element={
                  <Authenticated key="anonymous" fallback={<Outlet />}>
                    <NavigateToResource resource="wallet" />
                  </Authenticated>
                }
              >
                <Route path="/login" element={<LoginPage />} />
                <Route path="/setup" element={<SetupPage />} />
              </Route>
            </Routes>
            <DocumentTitleHandler handler={() => APP_TITLE} />
          </Refine>
        </AntdApp>
      </ConfigProvider>
    </BrowserRouter>
  );
}
