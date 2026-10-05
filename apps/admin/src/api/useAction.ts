import { useCustomMutation, useInvalidate } from '@refinedev/core';
import { App } from 'antd';
import { useCallback } from 'react';
import { useTranslation } from 'react-i18next';

export interface ActionOptions {
  /** POST target relative to /admin/v1, e.g. `/addresses/123/sweep`. */
  url: string;
  method?: 'post' | 'patch' | 'put' | 'delete';
  body?: Record<string, unknown>;
  /** Show a confirmation modal first. */
  confirm?: { title: string; content?: string; okText?: string; danger?: boolean };
  /** Resources whose list/detail caches to invalidate afterwards. */
  invalidate?: string[];
  successMessage?: string | ((data: Record<string, unknown>) => string);
  onSuccess?: (data: Record<string, unknown>) => void;
}

/**
 * Small wrapper around `useCustomMutation` for one-shot admin actions with an
 * optional confirmation modal, toast feedback and cache invalidation.
 */
export const useAction = () => {
  const { t } = useTranslation();
  const { modal, message } = App.useApp();
  const { mutateAsync, isPending } = useCustomMutation();
  const invalidate = useInvalidate();

  const execute = useCallback(
    async (o: ActionOptions): Promise<boolean> => {
      try {
        const res = await mutateAsync({ url: o.url, method: o.method ?? 'post', values: o.body ?? {}, successNotification: false, errorNotification: false });
        const data = (res.data ?? {}) as Record<string, unknown>;
        const text = typeof o.successMessage === 'function' ? o.successMessage(data) : (o.successMessage ?? t('common.done'));
        message.success(text);
        for (const r of o.invalidate ?? []) {
          void invalidate({ resource: r, invalidates: ['list', 'detail', 'many'] });
        }
        o.onSuccess?.(data);
        return true;
      } catch (e) {
        message.error((e as Error).message || t('common.actionFailed'));
        return false;
      }
    },
    [mutateAsync, message, invalidate, t],
  );

  const run = useCallback(
    (o: ActionOptions): void => {
      if (!o.confirm) {
        void execute(o);
        return;
      }
      modal.confirm({
        title: o.confirm.title,
        content: o.confirm.content,
        okText: o.confirm.okText ?? t('common.confirm'),
        cancelText: t('common.cancel'),
        okButtonProps: { danger: o.confirm.danger },
        onOk: () => execute(o).then(() => undefined),
      });
    },
    [execute, modal, t],
  );

  return { run, isPending };
};
