import { Tooltip, Typography } from 'antd';

export const Ellipsis = ({ value, width = 220 }: { value: string | null | undefined; width?: number }) => {
  if (!value) return <span>—</span>;
  return (
    <Tooltip title={<pre style={{ margin: 0, whiteSpace: 'pre-wrap', maxWidth: 480 }}>{value}</pre>}>
      <Typography.Text type="danger" ellipsis style={{ maxWidth: width, display: 'inline-block', verticalAlign: 'bottom' }}>
        {value}
      </Typography.Text>
    </Tooltip>
  );
};
