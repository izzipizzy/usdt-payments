import { Button, Space } from 'antd';
import { useTranslation } from 'react-i18next';
import { SweepStatus } from '@usdt-trx/shared';
import type { SweepDto } from '@usdt-trx/shared';
import { useAction } from '../../api/useAction';
import { useMe } from '../../providers/useMe';

const CANCELLABLE = new Set<string>([SweepStatus.planned, SweepStatus.activating, SweepStatus.energy_pending, SweepStatus.ready, SweepStatus.signing]);
const REBUILDABLE = new Set<string>([SweepStatus.failed, SweepStatus.broadcast]);

/** Retry / Cancel / Rebuild buttons, gated by status and role. */
export const SweepActions = ({ sweep, size = 'small' }: { sweep: SweepDto; size?: 'small' | 'middle' }) => {
  const { t } = useTranslation();
  const { isOperator } = useMe();
  const { run, isPending } = useAction();
  if (!isOperator) return null;
  const inv = ['sweeps', 'addresses', 'resources', 'deposits'];
  const canRetry = sweep.status === SweepStatus.failed;
  const canCancel = CANCELLABLE.has(sweep.status);
  const canRebuild = REBUILDABLE.has(sweep.status) && !sweep.confirmedAt;
  if (!canRetry && !canCancel && !canRebuild) return <span style={{ opacity: 0.5 }}>—</span>;
  return (
    <Space size={4}>
      {canRetry && (
        <Button
          size={size}
          type="primary"
          disabled={isPending}
          onClick={() =>
            run({ url: `/sweeps/${sweep.id}/retry`, confirm: { title: t('page.sweeps.retryConfirm', { id: sweep.id }) }, invalidate: inv, successMessage: t('page.sweeps.requeued') })
          }
        >
          {t('page.sweeps.retry')}
        </Button>
      )}
      {canCancel && (
        <Button
          size={size}
          danger
          disabled={isPending}
          onClick={() =>
            run({
              url: `/sweeps/${sweep.id}/cancel`,
              // Stored server-side in the audit log; intentionally not localised.
              body: { reason: 'cancelled from admin UI' },
              confirm: { title: t('page.sweeps.cancelConfirm', { id: sweep.id }), content: t('page.sweeps.cancelContent'), danger: true, okText: t('page.sweeps.cancelOk') },
              invalidate: inv,
              successMessage: t('page.sweeps.cancelled'),
            })
          }
        >
          {t('page.sweeps.cancel')}
        </Button>
      )}
      {canRebuild && (
        <Button
          size={size}
          disabled={isPending}
          onClick={() =>
            run({
              url: `/sweeps/${sweep.id}/rebuild`,
              confirm: { title: t('page.sweeps.rebuildConfirm', { id: sweep.id }), content: t('page.sweeps.rebuildContent') },
              invalidate: inv,
              successMessage: (d) => t('page.sweeps.rebuilt', { id: String(d.id ?? '') }),
            })
          }
        >
          {t('page.sweeps.rebuild')}
        </Button>
      )}
    </Space>
  );
};
