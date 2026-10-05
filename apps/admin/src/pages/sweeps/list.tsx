import { List, useTable } from '@refinedev/antd';
import type { CrudFilters, HttpError } from '@refinedev/core';
import { Form, Input, Select, Table } from 'antd';
import { useTranslation } from 'react-i18next';
import type { SweepDto } from '@usdt-trx/shared';
import { FilterBar } from '../../components/FilterBar';
import { statusOptions } from '../../i18n/labels';
import { useMe } from '../../providers/useMe';
import { SWEEP_STATUSES } from '../../utils/status';
import { SweepActions } from './actions';
import { sweepColumns } from './columns';

interface SearchVars {
  status?: string;
  alias?: string;
}

export const SweepList = () => {
  const { t } = useTranslation();
  const { isOperator } = useMe();
  const { tableProps, searchFormProps, setFilters, tableQuery } = useTable<SweepDto, HttpError, SearchVars>({
    resource: 'sweeps',
    syncWithLocation: true,
    pagination: { pageSize: 25 },
    sorters: { initial: [{ field: 'createdAt', order: 'desc' }] },
    onSearch: (v): CrudFilters => [
      { field: 'status', operator: 'eq', value: v.status || undefined },
      { field: 'alias', operator: 'eq', value: v.alias?.trim() || undefined },
    ],
  });

  const columns = sweepColumns(t, { sortable: true });
  if (isOperator) {
    columns.push({ title: t('fields.actions'), key: 'actions', fixed: 'right', width: 210, render: (_, r) => <SweepActions sweep={r} /> });
  }

  return (
    <List title={t('page.sweeps.title')}>
      <FilterBar<SearchVars> formProps={searchFormProps} onReset={() => setFilters([], 'replace')}>
        <Form.Item name="status">
          <Select allowClear placeholder={t('page.sweeps.statusPlaceholder')} style={{ width: 180 }} options={statusOptions(t, 'sweep', SWEEP_STATUSES)} />
        </Form.Item>
        <Form.Item name="alias">
          <Input placeholder={t('page.sweeps.aliasPlaceholder')} allowClear style={{ width: 180 }} />
        </Form.Item>
      </FilterBar>
      <Table<SweepDto> {...tableProps} rowKey="id" size="small" columns={columns} scroll={{ x: 1900 }} loading={tableQuery.isFetching} />
    </List>
  );
};
