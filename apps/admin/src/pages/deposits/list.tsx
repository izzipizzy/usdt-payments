import { List, useTable } from '@refinedev/antd';
import type { CrudFilters, HttpError } from '@refinedev/core';
import { Form, Input, Select, Table } from 'antd';
import type { ColumnsType } from 'antd/es/table';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router';
import type { DepositDto } from '@usdt-trx/shared';
import { DateCell } from '../../components/DateCell';
import { Ellipsis } from '../../components/Ellipsis';
import { ExplorerLink } from '../../components/ExplorerLink';
import { FilterBar } from '../../components/FilterBar';
import { Money } from '../../components/Money';
import { StatusTag } from '../../components/StatusTag';
import { statusOptions } from '../../i18n/labels';
import { DEPOSIT_STATUSES } from '../../utils/status';

interface SearchVars {
  status?: string;
  alias?: string;
  txId?: string;
}

export const DepositList = () => {
  const { t } = useTranslation();
  const { tableProps, searchFormProps, setFilters, tableQuery } = useTable<DepositDto, HttpError, SearchVars>({
    resource: 'deposits',
    syncWithLocation: true,
    pagination: { pageSize: 25 },
    sorters: { initial: [{ field: 'createdAt', order: 'desc' }] },
    onSearch: (v): CrudFilters => [
      { field: 'status', operator: 'eq', value: v.status || undefined },
      { field: 'alias', operator: 'eq', value: v.alias?.trim() || undefined },
      { field: 'txId', operator: 'eq', value: v.txId?.trim() || undefined },
    ],
  });

  const columns: ColumnsType<DepositDto> = [
    { title: t('fields.tx'), dataIndex: 'txId', key: 'txId', width: 200, render: (v: string, r) => <ExplorerLink kind="tx" value={v} explorerUrl={r.explorerUrl} /> },
    { title: t('fields.alias'), dataIndex: 'alias', key: 'alias', render: (v: string | null) => v ?? '—' },
    { title: t('fields.to'), dataIndex: 'address', key: 'address', width: 190, render: (v: string) => <ExplorerLink kind="address" value={v} /> },
    { title: t('fields.from'), dataIndex: 'fromAddress', key: 'fromAddress', width: 190, render: (v: string) => <ExplorerLink kind="address" value={v} /> },
    { title: t('fields.amount'), dataIndex: 'amount', key: 'amount', sorter: true, align: 'right', width: 150, render: (v: string) => <Money value={v} unit="USDT" /> },
    {
      title: t('fields.status'),
      dataIndex: 'status',
      key: 'status',
      sorter: true,
      width: 110,
      render: (v: string, r) => (
        <>
          <StatusTag kind="deposit" value={v} />
          {r.rejectReason && (
            <div>
              <Ellipsis value={r.rejectReason} width={160} />
            </div>
          )}
        </>
      ),
    },
    { title: t('fields.block'), dataIndex: 'blockNumber', key: 'blockNumber', sorter: true, align: 'right' },
    { title: t('fields.confirmed'), dataIndex: 'confirmedAt', key: 'confirmedAt', sorter: true, width: 170, render: (v: string | null) => <DateCell value={v} /> },
    { title: t('fields.credited'), dataIndex: 'creditedAt', key: 'creditedAt', width: 160, render: (v: string | null) => <DateCell value={v} /> },
    {
      title: t('fields.swept'),
      dataIndex: 'sweptAt',
      key: 'sweptAt',
      width: 170,
      render: (v: string | null, r) => (
        <>
          <DateCell value={v} />
          {r.sweepId && (
            <div>
              <Link to={`/sweeps/${r.sweepId}`} style={{ fontSize: 12 }}>
                {t('page.deposits.sweepLink', { id: r.sweepId })}
              </Link>
            </div>
          )}
        </>
      ),
    },
  ];

  return (
    <List title={t('page.deposits.title')}>
      <FilterBar<SearchVars> formProps={searchFormProps} onReset={() => setFilters([], 'replace')}>
        <Form.Item name="status">
          <Select allowClear placeholder={t('page.deposits.statusPlaceholder')} style={{ width: 160 }} options={statusOptions(t, 'deposit', DEPOSIT_STATUSES)} />
        </Form.Item>
        <Form.Item name="alias">
          <Input placeholder={t('page.deposits.aliasPlaceholder')} allowClear style={{ width: 180 }} />
        </Form.Item>
        <Form.Item name="txId">
          <Input placeholder={t('page.deposits.txIdPlaceholder')} allowClear style={{ width: 300 }} />
        </Form.Item>
      </FilterBar>
      <Table<DepositDto> {...tableProps} rowKey="id" size="small" columns={columns} scroll={{ x: 1600 }} loading={tableQuery.isFetching} />
    </List>
  );
};
