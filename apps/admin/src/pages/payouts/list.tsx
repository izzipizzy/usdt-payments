import { PlusOutlined } from '@ant-design/icons';
import { List, useTable } from '@refinedev/antd';
import type { CrudFilters, HttpError } from '@refinedev/core';
import { Button, Form, Input, Select, Table } from 'antd';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { PayoutDto } from '@usdt-trx/shared';
import { FilterBar } from '../../components/FilterBar';
import { statusOptions } from '../../i18n/labels';
import { useMe } from '../../providers/useMe';
import { PAYOUT_STATUSES } from '../../utils/status';
import { PayoutActions } from './actions';
import { payoutColumns } from './columns';
import { CreatePayoutModal } from './CreatePayoutModal';

interface SearchVars {
  status?: string;
  to?: string;
}

/** `/payouts?new=1` (e.g. from the wallet page) opens the "New payout" dialog right away. */
const openedFromUrl = (): boolean => {
  try {
    return new URLSearchParams(window.location.search).has('new');
  } catch {
    return false;
  }
};

export const PayoutList = () => {
  const { t } = useTranslation();
  const { isOperator } = useMe();
  const [createOpen, setCreateOpen] = useState(openedFromUrl);
  const { tableProps, searchFormProps, setFilters, tableQuery } = useTable<PayoutDto, HttpError, SearchVars>({
    resource: 'payouts',
    syncWithLocation: true,
    pagination: { pageSize: 25 },
    sorters: { initial: [{ field: 'createdAt', order: 'desc' }] },
    onSearch: (v): CrudFilters => [
      { field: 'status', operator: 'eq', value: v.status || undefined },
      { field: 'to', operator: 'eq', value: v.to?.trim() || undefined },
    ],
  });

  const columns = payoutColumns(t, { sortable: true });
  if (isOperator) {
    columns.push({ title: t('fields.actions'), key: 'actions', fixed: 'right', width: 170, render: (_, r) => <PayoutActions payout={r} /> });
  }

  return (
    <List
      title={t('page.payouts.title')}
      headerButtons={
        isOperator ? (
          <Button type="primary" icon={<PlusOutlined />} onClick={() => setCreateOpen(true)}>
            {t('page.payouts.newPayout')}
          </Button>
        ) : null
      }
    >
      <FilterBar<SearchVars> formProps={searchFormProps} onReset={() => setFilters([], 'replace')}>
        <Form.Item name="status">
          <Select allowClear placeholder={t('page.payouts.statusPlaceholder')} style={{ width: 180 }} options={statusOptions(t, 'payout', PAYOUT_STATUSES)} />
        </Form.Item>
        <Form.Item name="to">
          <Input placeholder={t('page.payouts.toPlaceholder')} allowClear style={{ width: 300, fontFamily: 'monospace' }} />
        </Form.Item>
      </FilterBar>
      <Table<PayoutDto> {...tableProps} rowKey="id" size="small" columns={columns} scroll={{ x: 1400 }} loading={tableQuery.isFetching} />
      {isOperator && <CreatePayoutModal open={createOpen} onClose={() => setCreateOpen(false)} />}
    </List>
  );
};
