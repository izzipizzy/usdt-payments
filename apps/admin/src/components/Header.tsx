import { LogoutOutlined } from '@ant-design/icons';
import { useLogout } from '@refinedev/core';
import { Button, Layout, Space, Tag, Typography, theme } from 'antd';
import { useTranslation } from 'react-i18next';
import { APP_TITLE } from '../config';
import { useMe } from '../providers/useMe';
import { LangSwitch } from './LangSwitch';

/** Top bar: app title, network badge, RU/EN switch, logout. */
export const Header = () => {
  const { token } = theme.useToken();
  const { t } = useTranslation();
  const { me } = useMe();
  const { mutate: logout } = useLogout();
  const isMainnet = me?.network?.toLowerCase() === 'mainnet';
  return (
    <Layout.Header
      style={{
        background: token.colorBgElevated,
        borderBottom: `1px solid ${token.colorBorderSecondary}`,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        padding: '0 16px',
        height: 48,
        lineHeight: '48px',
        position: 'sticky',
        top: 0,
        zIndex: 10,
      }}
    >
      <Typography.Text strong>{APP_TITLE}</Typography.Text>
      <Space size="middle" wrap>
        {me?.network && <Tag color={isMainnet ? 'red' : 'geekblue'}>{me.network}</Tag>}
        <LangSwitch />
        <Button size="small" icon={<LogoutOutlined />} onClick={() => logout()}>
          {t('header.logout')}
        </Button>
      </Space>
    </Layout.Header>
  );
};
