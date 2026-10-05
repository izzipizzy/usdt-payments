import { List, useTable } from '@refinedev/antd';
import type { HttpError } from '@refinedev/core';
import { Table, Tag, Tooltip, Typography } from 'antd';
import type { ColumnsType } from 'antd/es/table';
import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import type { AuditDto } from '@usdt-trx/shared';
import { DateCell } from '../../components/DateCell';
import { roleLabel } from '../../i18n/labels';

export const AuditList = () => {
  const { t } = useTranslation();
  const { tableProps, tableQuery } = useTable<AuditDto, HttpError>({
    resource: 'audit',
    syncWithLocation: true,
    pagination: { pageSize: 50 },
  });

  const columns = useMemo<ColumnsType<AuditDto>>(
    () => [
      { title: t('fields.when'), dataIndex: 'createdAt', key: 'createdAt', width: 170, render: (v: string) => <DateCell value={v} /> },
      {
        title: t('fields.actor'),
        dataIndex: 'actor',
        key: 'actor',
        render: (v: string, r) => (
          <>
            <Typography.Text code>{v}</Typography.Text> {r.role && <Tag>{roleLabel(t, r.role)}</Tag>}
          </>
        ),
      },
      { title: t('fields.action'), dataIndex: 'action', key: 'action', render: (v: string) => <Typography.Text strong>{v}</Typography.Text> },
      { title: t('fields.subject'), key: 'subject', render: (_, r) => (r.subjectType ? `${r.subjectType}${r.subjectId ? ` #${r.subjectId}` : ''}` : '—') },
      {
        title: t('fields.details'),
        dataIndex: 'details',
        key: 'details',
        render: (v: Record<string, unknown> | null) => {
          if (!v) return '—';
          const json = JSON.stringify(v);
          return (
            <Tooltip title={<pre style={{ margin: 0, whiteSpace: 'pre-wrap', maxWidth: 520 }}>{JSON.stringify(v, null, 2)}</pre>}>
              <Typography.Text code ellipsis style={{ maxWidth: 360, display: 'inline-block', verticalAlign: 'bottom' }}>
                {json}
              </Typography.Text>
            </Tooltip>
          );
        },
      },
      { title: t('fields.ip'), dataIndex: 'ip', key: 'ip', width: 130, render: (v: string | null) => v ?? '—' },
    ],
    [t],
  );

  return (
    <List title={t('page.audit.title')}>
      <Table<AuditDto> {...tableProps} rowKey="id" size="small" columns={columns} scroll={{ x: 1000 }} loading={tableQuery.isFetching} />
    </List>
  );
};
