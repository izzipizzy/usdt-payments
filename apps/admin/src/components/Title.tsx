import { Link } from 'react-router';
import { Typography } from 'antd';
import { APP_TITLE } from '../config';

export const Title = ({ collapsed }: { collapsed: boolean }) => (
  <Link to="/wallet" style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '12px 16px', color: 'inherit' }}>
    <span
      style={{
        display: 'inline-flex',
        width: 24,
        height: 24,
        borderRadius: 6,
        background: '#26a17b',
        color: '#fff',
        alignItems: 'center',
        justifyContent: 'center',
        fontWeight: 700,
        fontSize: 12,
        flexShrink: 0,
      }}
    >
      ₮
    </span>
    {!collapsed && <Typography.Text strong>{APP_TITLE}</Typography.Text>}
  </Link>
);
