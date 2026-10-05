import { SearchOutlined } from '@ant-design/icons';
import { Button, Form, Space, type FormProps } from 'antd';
import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';

/** Inline filter form wired to Refine's `searchFormProps`. */
export const FilterBar = <T,>({ formProps, children, onReset }: { formProps: FormProps<T>; children: ReactNode; onReset: () => void }) => {
  const { t } = useTranslation();
  return (
    <Form<T> {...formProps} layout="inline" style={{ marginBottom: 12, rowGap: 8 }}>
      {children}
      <Form.Item>
        <Space>
          <Button type="primary" htmlType="submit" icon={<SearchOutlined />}>
            {t('common.filter')}
          </Button>
          <Button
            onClick={() => {
              formProps.form?.resetFields();
              onReset();
            }}
          >
            {t('common.reset')}
          </Button>
        </Space>
      </Form.Item>
    </Form>
  );
};
