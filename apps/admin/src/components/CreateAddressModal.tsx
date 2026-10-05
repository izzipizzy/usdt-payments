import { useCreate } from '@refinedev/core';
import type { AddressDto } from '@usdt-trx/shared';
import { App, Form, Input, Modal } from 'antd';
import { useTranslation } from 'react-i18next';

interface CreateVars {
  alias: string;
  metadata?: string;
}

interface Props {
  open: boolean;
  onClose: () => void;
  /** Called with the created (or, for an existing alias, the current) address. */
  onCreated?: (address: AddressDto) => void;
}

/** "Create address" dialog: alias + optional JSON metadata → POST /addresses. */
export const CreateAddressModal = ({ open, onClose, onCreated }: Props) => {
  const { t } = useTranslation();
  const { message } = App.useApp();
  const [form] = Form.useForm<CreateVars>();
  const { mutateAsync: create, isPending } = useCreate<AddressDto>();

  const submit = async () => {
    const v = await form.validateFields();
    let metadata: Record<string, unknown> | undefined;
    if (v.metadata && v.metadata.trim()) {
      try {
        const parsed: unknown = JSON.parse(v.metadata);
        if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error(t('page.addresses.metadataMustBeObject'));
        metadata = parsed as Record<string, unknown>;
      } catch (e) {
        form.setFields([{ name: 'metadata', errors: [(e as Error).message] }]);
        return;
      }
    }
    try {
      const res = await create({ resource: 'addresses', values: { alias: v.alias.trim(), metadata }, successNotification: false });
      message.success(t('page.addresses.created', { address: res.data.address, alias: res.data.alias ?? v.alias }));
      form.resetFields();
      onClose();
      onCreated?.(res.data);
    } catch {
      /* error notification shown by Refine */
    }
  };

  return (
    <Modal
      title={t('page.addresses.createTitle')}
      open={open}
      onCancel={onClose}
      onOk={() => void submit()}
      confirmLoading={isPending}
      okText={t('page.addresses.create')}
      cancelText={t('common.cancel')}
      destroyOnClose
    >
      <Form<CreateVars> form={form} layout="vertical" style={{ marginTop: 12 }}>
        <Form.Item
          name="alias"
          label={t('page.addresses.aliasLabel')}
          rules={[
            { required: true, message: t('common.required') },
            { max: 128 },
            { pattern: /^[A-Za-z0-9._:-]+$/, message: t('page.addresses.aliasPattern') },
          ]}
          extra={t('page.addresses.aliasExtra')}
        >
          <Input placeholder={t('page.addresses.aliasPlaceholder')} autoFocus />
        </Form.Item>
        <Form.Item name="metadata" label={t('page.addresses.metadataLabel')}>
          <Input.TextArea rows={4} placeholder='{"customerId": "42"}' style={{ fontFamily: 'monospace' }} />
        </Form.Item>
      </Form>
    </Modal>
  );
};
