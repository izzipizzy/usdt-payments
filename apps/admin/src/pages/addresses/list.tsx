import { DownloadOutlined, PlusOutlined } from '@ant-design/icons';
import { List, useTable } from '@refinedev/antd';
import type { CrudFilters } from '@refinedev/core';
import { App, Button, Checkbox, Descriptions, Dropdown, Form, Input, InputNumber, Select, Space, Table, Tooltip } from 'antd';
import type { ColumnsType } from 'antd/es/table';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router';
import type { AddressDto } from '@usdt-trx/shared';
import { useAction } from '../../api/useAction';
import { CreateAddressModal } from '../../components/CreateAddressModal';
import { DateCell } from '../../components/DateCell';
import { ExplorerLink } from '../../components/ExplorerLink';
import { FilterBar } from '../../components/FilterBar';
import { Money } from '../../components/Money';
import { StatusTag } from '../../components/StatusTag';
import { statusOptions } from '../../i18n/labels';
import { useMe } from '../../providers/useMe';
import { downloadCsv, toCsv } from '../../utils/csv';
import { formatDecimal } from '../../utils/format';
import { ADDRESS_STATUSES } from '../../utils/status';

interface SearchVars {
  search?: string;
  status?: string;
  withBalance?: boolean;
  unsweptOlderThanHours?: number | null;
}

/** CSV headers are the DTO field names on purpose (machine-readable export). */
const CSV_COLUMNS = [
  { key: 'id', title: 'id' },
  { key: 'alias', title: 'alias' },
  { key: 'address', title: 'address' },
  { key: 'status', title: 'status' },
  { key: 'onchainStatus', title: 'onchainStatus' },
  { key: 'usdtBalance', title: 'usdtBalance' },
  { key: 'usdtBalanceRaw', title: 'usdtBalanceRaw' },
  { key: 'derivationIndex', title: 'derivationIndex' },
  { key: 'balanceCheckedAt', title: 'balanceCheckedAt' },
  { key: 'lastDepositAt', title: 'lastDepositAt' },
  { key: 'createdAt', title: 'createdAt' },
];

export const AddressList = () => {
  const { t } = useTranslation();
  const { isOperator } = useMe();
  const { run, isPending } = useAction();
  const { message } = App.useApp();
  const [createOpen, setCreateOpen] = useState(false);

  const { tableProps, searchFormProps, setFilters, tableQuery } = useTable<AddressDto, import('@refinedev/core').HttpError, SearchVars>({
    resource: 'addresses',
    syncWithLocation: true,
    pagination: { pageSize: 25 },
    sorters: { initial: [{ field: 'createdAt', order: 'desc' }] },
    onSearch: (v): CrudFilters => [
      { field: 'search', operator: 'contains', value: v.search?.trim() || undefined },
      { field: 'status', operator: 'eq', value: v.status || undefined },
      { field: 'withBalance', operator: 'eq', value: v.withBalance ? true : undefined },
      { field: 'unsweptOlderThanHours', operator: 'gte', value: v.unsweptOlderThanHours ?? undefined },
    ],
  });

  const exportCsv = () => {
    const rows = (tableProps.dataSource ?? []) as AddressDto[];
    if (!rows.length) {
      message.info(t('common.nothingToExport'));
      return;
    }
    downloadCsv(`addresses-page-${tableProps.pagination && typeof tableProps.pagination === 'object' ? tableProps.pagination.current ?? 1 : 1}.csv`, toCsv(rows, CSV_COLUMNS));
  };

  const columns: ColumnsType<AddressDto> = [
    {
      title: t('fields.alias'),
      dataIndex: 'alias',
      key: 'alias',
      sorter: true,
      render: (v: string | null, r) => <Link to={`/addresses/${r.id}`}>{v ?? <i>{t('common.none')}</i>}</Link>,
    },
    { title: t('fields.address'), dataIndex: 'address', key: 'address', width: 200, render: (v: string, r) => <ExplorerLink kind="address" value={v} explorerUrl={r.explorerUrl} /> },
    {
      title: t('fields.usdtBalance'),
      dataIndex: 'usdtBalance',
      key: 'usdtBalance',
      sorter: true,
      align: 'right',
      render: (v: string, r) => (
        <Tooltip title={r.balanceCheckedAt ? t('page.addresses.checkedAt', { time: r.balanceCheckedAt }) : t('page.addresses.neverChecked')}>
          <span>
            <Money value={v} />
          </span>
        </Tooltip>
      ),
    },
    { title: t('fields.status'), dataIndex: 'status', key: 'status', sorter: true, width: 110, render: (v: string) => <StatusTag kind="address" value={v} /> },
    { title: t('fields.lastDeposit'), dataIndex: 'lastDepositAt', key: 'lastDepositAt', sorter: true, width: 170, render: (v: string | null) => <DateCell value={v} /> },
  ];
  if (isOperator) {
    columns.push({
      title: t('fields.actions'),
      key: 'actions',
      fixed: 'right',
      width: 140,
      render: (_, r) => {
        const suspended = r.status === 'suspended';
        const name = r.alias ?? r.address;
        const items = [
          {
            key: 'sweep',
            label: t('page.addresses.sweepNow'),
            disabled: r.usdtBalanceRaw === '0',
            onClick: () =>
              run({
                url: `/addresses/${r.id}/sweep`,
                confirm: { title: t('page.addresses.sweepConfirmTitle', { name }), content: t('page.addresses.sweepConfirmContent', { amount: formatDecimal(r.usdtBalance) }) },
                invalidate: ['addresses', 'sweeps'],
                successMessage: (d) => t('page.addresses.sweepPlanned', { id: String(d.sweepId ?? '') }),
              }),
          },
          {
            key: 'toggle',
            label: suspended ? t('page.addresses.resume') : t('page.addresses.suspend'),
            onClick: () =>
              run({
                url: `/addresses/${r.id}/${suspended ? 'resume' : 'suspend'}`,
                confirm: { title: suspended ? t('page.addresses.resumeConfirm', { name }) : t('page.addresses.suspendConfirm', { name }), danger: !suspended },
                invalidate: ['addresses'],
                successMessage: suspended ? t('page.addresses.resumed') : t('page.addresses.suspended'),
              }),
          },
          {
            key: 'refresh',
            label: t('page.addresses.refreshBalance'),
            onClick: () => run({ url: `/addresses/${r.id}/refresh-balance`, invalidate: ['addresses'], successMessage: t('page.addresses.balanceRefreshed') }),
          },
        ];
        return (
          <Dropdown menu={{ items }} trigger={['click']} disabled={isPending}>
            <Button size="small">{t('common.actionsMenu')}</Button>
          </Dropdown>
        );
      },
    });
  }

  return (
    <List
      title={t('page.addresses.title')}
      headerButtons={
        <Space>
          <Button icon={<DownloadOutlined />} onClick={exportCsv} disabled={!tableProps.dataSource?.length}>
            {t('common.exportCsvPage')}
          </Button>
          {isOperator && (
            <Button type="primary" icon={<PlusOutlined />} onClick={() => setCreateOpen(true)}>
              {t('page.addresses.createAddress')}
            </Button>
          )}
        </Space>
      }
    >
      <FilterBar<SearchVars> formProps={searchFormProps} onReset={() => setFilters([], 'replace')}>
        <Form.Item name="search">
          <Input placeholder={t('page.addresses.searchPlaceholder')} allowClear style={{ width: 220 }} />
        </Form.Item>
        <Form.Item name="status">
          <Select allowClear placeholder={t('page.addresses.statusPlaceholder')} style={{ width: 160 }} options={statusOptions(t, 'address', ADDRESS_STATUSES)} />
        </Form.Item>
        <Form.Item name="withBalance" valuePropName="checked">
          <Checkbox>{t('page.addresses.withBalance')}</Checkbox>
        </Form.Item>
        <Form.Item name="unsweptOlderThanHours" label={t('page.addresses.unsweptOlderThan')}>
          <InputNumber min={1} placeholder={t('page.addresses.hoursPlaceholder')} style={{ width: 100 }} />
        </Form.Item>
      </FilterBar>
      <Table<AddressDto>
        {...tableProps}
        rowKey="id"
        size="small"
        columns={columns}
        scroll={{ x: 900 }}
        loading={tableQuery.isFetching}
        expandable={{
          // Technical fields live behind the row expand to keep the default view short.
          expandedRowRender: (r) => (
            <Descriptions size="small" column={{ xs: 1, md: 2, xl: 4 }}>
              <Descriptions.Item label={t('fields.onchain')}>
                <StatusTag kind="onchain" value={r.onchainStatus} />
              </Descriptions.Item>
              <Descriptions.Item label={t('fields.derivationIndex')}>{r.derivationIndex}</Descriptions.Item>
              <Descriptions.Item label={t('fields.balanceChecked')}>
                <DateCell value={r.balanceCheckedAt} />
              </Descriptions.Item>
              <Descriptions.Item label={t('fields.created')}>
                <DateCell value={r.createdAt} />
              </Descriptions.Item>
            </Descriptions>
          ),
        }}
      />

      <CreateAddressModal open={createOpen} onClose={() => setCreateOpen(false)} />
    </List>
  );
};
