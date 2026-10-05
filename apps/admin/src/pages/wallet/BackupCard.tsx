import { CloudDownloadOutlined, CloudUploadOutlined, HistoryOutlined } from '@ant-design/icons';
import { useCustom, useCustomMutation } from '@refinedev/core';
import { Alert, App, Button, Card, Space, Typography, Upload } from 'antd';
import { useTranslation } from 'react-i18next';
import { adminUrl, request } from '../../api/http';
import type { RecoveryStatusDto } from '../../api/types';
import { useMe } from '../../providers/useMe';

/** Labels backup (JSON/CSV) + recovery from the chain. Lives on the wallet page once the wallet exists. */
export const BackupCard = () => {
  const { t } = useTranslation();
  const { message, modal } = App.useApp();
  const { isAdmin } = useMe();
  const { mutateAsync, isPending } = useCustomMutation();
  const { data: statusRes, refetch } = useCustom<RecoveryStatusDto>({
    url: '/recovery/status',
    method: 'get',
    queryOptions: { refetchInterval: 5_000 },
  });
  const status = statusRes?.data;

  const download = async (format: 'json' | 'csv') => {
    try {
      const url = adminUrl(format === 'csv' ? '/backup/labels.csv' : '/backup/labels');
      const text = format === 'csv' ? await request<string>(url, { headers: { Accept: 'text/csv' } }) : JSON.stringify(await request<unknown>(url), null, 2);
      const blob = new Blob([typeof text === 'string' ? text : JSON.stringify(text)], { type: format === 'csv' ? 'text/csv' : 'application/json' });
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = `usdt-labels-${new Date().toISOString().slice(0, 10)}.${format}`;
      a.click();
      URL.revokeObjectURL(a.href);
    } catch (e) {
      message.error((e as Error).message);
    }
  };

  const restore = async (file: File) => {
    try {
      const body = JSON.parse(await file.text()) as unknown;
      const res = await mutateAsync({ url: '/backup/labels', method: 'post', values: body as Record<string, unknown>, successNotification: false, errorNotification: false });
      const r = res.data as { applied: number; skipped: string[] };
      message.success(t('page.backup.restored', { applied: r.applied, skipped: r.skipped.length }));
    } catch (e) {
      message.error((e as Error).message || t('common.actionFailed'));
    }
    return false;
  };

  const scan = () =>
    modal.confirm({
      title: t('page.backup.scanConfirmTitle'),
      content: t('page.backup.scanConfirmContent'),
      okText: t('common.confirm'),
      cancelText: t('common.cancel'),
      onOk: async () => {
        try {
          await mutateAsync({ url: '/recovery/scan', method: 'post', values: {}, successNotification: false, errorNotification: false });
          message.success(t('page.backup.scanQueued'));
          void refetch();
        } catch (e) {
          message.error((e as Error).message || t('common.actionFailed'));
        }
      },
    });

  return (
    <Card title={t('page.backup.title')} style={{ marginTop: 16 }}>
      <Typography.Paragraph type="secondary">{t('page.backup.intro')}</Typography.Paragraph>
      <Space wrap>
        <Button icon={<CloudDownloadOutlined />} onClick={() => void download('json')}>
          {t('page.backup.downloadJson')}
        </Button>
        <Button icon={<CloudDownloadOutlined />} onClick={() => void download('csv')}>
          {t('page.backup.downloadCsv')}
        </Button>
        {isAdmin && (
          <Upload accept=".json,application/json" showUploadList={false} beforeUpload={(f) => restore(f as unknown as File)}>
            <Button icon={<CloudUploadOutlined />} loading={isPending}>
              {t('page.backup.restore')}
            </Button>
          </Upload>
        )}
        {isAdmin && (
          <Button icon={<HistoryOutlined />} onClick={scan} loading={status?.state === 'running'}>
            {t('page.backup.scan')}
          </Button>
        )}
      </Space>
      {status && status.state !== 'idle' && (
        <Alert
          style={{ marginTop: 16 }}
          type={status.state === 'failed' ? 'error' : status.state === 'done' ? 'success' : 'info'}
          showIcon
          message={t(`page.backup.state.${status.state}`, { phase: status.phase })}
          description={
            <>
              {t('page.backup.summary', { ...status } as Record<string, unknown>)}
              {status.errors.length > 0 && <div style={{ marginTop: 8, whiteSpace: 'pre-wrap' }}>{status.errors.slice(0, 10).join('\n')}</div>}
            </>
          }
        />
      )}
    </Card>
  );
};
