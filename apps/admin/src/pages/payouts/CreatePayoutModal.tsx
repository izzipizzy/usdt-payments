import { useCreate } from '@refinedev/core';
import { Alert, App, Form, Input, Modal } from 'antd';
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { CreatePayoutRequest, PayoutDto } from '@usdt-trx/shared';
import type { PayoutCreateResult } from '../../api/types';

/** Base58 TRON address: `T` + 33 base58 characters (34 in total). */
const TRON_ADDRESS = /^T[1-9A-HJ-NP-Za-km-z]{33}$/;
/** Decimal USDT amount with up to 6 fractional digits (matches the API's `zUsdtAmount`). */
const USDT_AMOUNT = /^\d+(\.\d{1,6})?$/;
const isPositive = (v: string): boolean => /[1-9]/.test(v);

/** Reference prefilled into the form; the operator may replace it with their own id. */
export const generateExternalId = (): string => `ui-${Date.now()}`;

const statusOf = (e: unknown): number | undefined => (e as { statusCode?: number } | null)?.statusCode;

interface Props {
  open: boolean;
  onClose: () => void;
  onCreated?: (payout: PayoutDto) => void;
}

/** "New payout" dialog → POST /payouts. 422 / 409 messages are shown under the form. */
export const CreatePayoutModal = ({ open, onClose, onCreated }: Props) => {
  const { t } = useTranslation();
  const { message } = App.useApp();
  const [form] = Form.useForm<CreatePayoutRequest>();
  const [serverError, setServerError] = useState<string | null>(null);
  const { mutateAsync: create, isPending } = useCreate<PayoutCreateResult>();

  useEffect(() => {
    if (open) {
      form.setFieldsValue({ externalId: generateExternalId() });
      setServerError(null);
    }
  }, [open, form]);

  const submit = async () => {
    const v = await form.validateFields();
    setServerError(null);
    const body: CreatePayoutRequest = { externalId: v.externalId.trim(), to: v.to.trim(), amount: v.amount.trim() };
    const note = v.note?.trim();
    if (note) body.note = note;
    try {
      const res = await create({ resource: 'payouts', values: body, successNotification: false, errorNotification: false });
      const p = res.data;
      if (p.created) {
        message.success(t('page.payouts.created', { amount: p.amount, id: p.externalId }));
      } else {
        message.info(t('page.payouts.alreadyExists', { id: p.externalId }));
      }
      form.resetFields();
      onClose();
      onCreated?.(p);
    } catch (e) {
      const status = statusOf(e);
      const text = (e as Error).message || t('common.actionFailed');
      if (status === 422 || status === 409 || status === 400) {
        setServerError(status === 409 ? t('page.payouts.walletNotReady', { message: text }) : text);
      } else {
        message.error(text);
      }
    }
  };

  return (
    <Modal
      title={t('page.payouts.createTitle')}
      open={open}
      onCancel={onClose}
      onOk={() => void submit()}
      confirmLoading={isPending}
      okText={t('page.payouts.submit')}
      cancelText={t('common.cancel')}
      destroyOnClose
    >
      <Form<CreatePayoutRequest> form={form} layout="vertical" style={{ marginTop: 12 }} onFinish={() => void submit()}>
        <Form.Item
          name="to"
          label={t('page.payouts.toLabel')}
          rules={[
            { required: true, message: t('common.required') },
            { transform: (v: string) => v?.trim(), pattern: TRON_ADDRESS, message: t('page.payouts.toInvalid') },
          ]}
          extra={t('page.payouts.toExtra')}
        >
          <Input placeholder="T…" autoFocus autoComplete="off" spellCheck={false} style={{ fontFamily: 'monospace' }} />
        </Form.Item>
        <Form.Item
          name="amount"
          label={t('page.payouts.amountLabel')}
          rules={[
            { required: true, message: t('common.required') },
            {
              validator: (_, v: string | undefined) => {
                const s = (v ?? '').trim();
                if (!s) return Promise.resolve();
                if (!USDT_AMOUNT.test(s)) return Promise.reject(new Error(t('page.payouts.amountInvalid')));
                if (!isPositive(s)) return Promise.reject(new Error(t('page.payouts.amountPositive')));
                return Promise.resolve();
              },
            },
          ]}
        >
          <Input placeholder="10.5" inputMode="decimal" autoComplete="off" suffix="USDT" style={{ width: 220 }} />
        </Form.Item>
        <Form.Item
          name="externalId"
          label={t('page.payouts.externalIdLabel')}
          rules={[{ required: true, whitespace: true, message: t('common.required') }, { max: 128 }]}
          extra={t('page.payouts.externalIdExtra')}
        >
          <Input autoComplete="off" spellCheck={false} style={{ fontFamily: 'monospace' }} />
        </Form.Item>
        <Form.Item name="note" label={t('page.payouts.noteLabel')} rules={[{ max: 500 }]}>
          <Input.TextArea rows={2} placeholder={t('page.payouts.notePlaceholder')} />
        </Form.Item>
        {serverError && <Alert type="error" showIcon message={t('page.payouts.rejected')} description={serverError} />}
      </Form>
    </Modal>
  );
};
