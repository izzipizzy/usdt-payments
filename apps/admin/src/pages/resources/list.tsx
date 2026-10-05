import { List, useTable } from '@refinedev/antd';
import type { CrudFilters, HttpError } from '@refinedev/core';
import { Form, Input, Select, Table } from 'antd';
import type { ColumnsType } from 'antd/es/table';
import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router';
import { ResourceOpKind } from '@usdt-trx/shared';
import type { ResourceOpDto } from '@usdt-trx/shared';
import { FilterBar } from '../../components/FilterBar';
import { enumLabel, statusOptions } from '../../i18n/labels';
import { RESOURCE_OP_STATUSES } from '../../utils/status';
import { resourceOpColumns } from '../sweeps/show';

interface SearchVars {
  kind?: string;
  status?: string;
  provider?: string;
  sweepId?: string;
}

const KINDS = Object.values(ResourceOpKind);

export const ResourceList = () => {
  const { t } = useTranslation();
  const { tableProps, searchFormProps, setFilters, tableQuery } = useTable<ResourceOpDto, HttpError, SearchVars>({
    resource: 'resources',
    syncWithLocation: true,
    pagination: { pageSize: 25 },
    sorters: { initial: [{ field: 'createdAt', order: 'desc' }] },
    onSearch: (v): CrudFilters => [
      { field: 'kind', operator: 'eq', value: v.kind || undefined },
      { field: 'status', operator: 'eq', value: v.status || undefined },
      { field: 'provider', operator: 'eq', value: v.provider?.trim() || undefined },
      { field: 'sweepId', operator: 'eq', value: v.sweepId?.trim() || undefined },
    ],
  });

  const columns = useMemo<ColumnsType<ResourceOpDto>>(() => {
    const base = resourceOpColumns(t);
    return [
      ...base.slice(0, 1),
      { title: t('fields.sweep'), dataIndex: 'sweepId', key: 'sweepId', width: 90, render: (v: string | null) => (v ? <Link to={`/sweeps/${v}`}>{v}</Link> : '—') },
      ...base.slice(1).map((c) => (c.key === 'createdAt' || c.key === 'status' ? { ...c, sorter: true } : c)),
    ];
  }, [t]);

  return (
    <List title={t('page.resources.title')}>
      <FilterBar<SearchVars> formProps={searchFormProps} onReset={() => setFilters([], 'replace')}>
        <Form.Item name="kind">
          <Select
            allowClear
            placeholder={t('page.resources.kindPlaceholder')}
            style={{ width: 190 }}
            options={KINDS.map((k) => ({ value: k, label: enumLabel(t, 'resourceKind', k) }))}
          />
        </Form.Item>
        <Form.Item name="status">
          <Select allowClear placeholder={t('page.resources.statusPlaceholder')} style={{ width: 150 }} options={statusOptions(t, 'resource', RESOURCE_OP_STATUSES)} />
        </Form.Item>
        <Form.Item name="provider">
          <Input placeholder={t('page.resources.providerPlaceholder')} allowClear style={{ width: 140 }} />
        </Form.Item>
        <Form.Item name="sweepId">
          <Input placeholder={t('page.resources.sweepIdPlaceholder')} allowClear style={{ width: 120 }} />
        </Form.Item>
      </FilterBar>
      <Table<ResourceOpDto> {...tableProps} rowKey="id" size="small" columns={columns} scroll={{ x: 1700 }} loading={tableQuery.isFetching} />
    </List>
  );
};
