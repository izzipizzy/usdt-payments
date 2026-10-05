import { Button, Space } from 'antd';
import { useTranslation } from 'react-i18next';
import { PayoutStatus } from '@usdt-trx/shared';
import type { PayoutDto } from '@usdt-trx/shared';
import { useAction } from '../../api/useAction';
import { useMe } from '../../providers/useMe';

/** Cancel is allowed only on stage 1 (main → hop) and before that transaction is broadcast; the server answers 409 otherwise. */
const CANCELLABLE = new Set<string>([PayoutStatus.planned, PayoutStatus.energy_pending, PayoutStatus.ready, PayoutStatus.signing]);
export const canCancelPayout = (p: Pick<PayoutDto, 'stage' | 'status'>): boolean => p.stage === 1 && CANCELLABLE.has(p.status);

/** Retry / Cancel buttons, gated by status and role. */
export const PayoutActions = ({ payout, size = 'small' }: { payout: PayoutDto; size?: 'small' | 'middle' }) => {
  const { t } = useTranslation();
  const { isOperator } = useMe();
  const { run, isPending } = useAction();
  if (!isOperator) return null;
  const inv = ['payouts', 'resources'];
  const canRetry = payout.status === PayoutStatus.failed;
  const canCancel = canCancelPayout(payout);
  if (!canRetry && !canCancel) return <span style={{ opacity: 0.5 }}>—</span>;
  return (
    <Space size={4}>
      {canRetry && (
        <Button
          size={size}
          type="primary"
          disabled={isPending}
          onClick={() =>
            run({
              url: `/payouts/${payout.id}/retry`,
              confirm: { title: t('page.payouts.retryConfirm', { id: payout.externalId }) },
              invalidate: inv,
              successMessage: t('page.payouts.requeued'),
            })
          }
        >
          {t('page.payouts.retry')}
        </Button>
      )}
      {canCancel && (
        <Button
          size={size}
          danger
          disabled={isPending}
          onClick={() =>
            run({
              url: `/payouts/${payout.id}/cancel`,
              // Stored server-side in the audit log; intentionally not localised.
              body: { reason: 'cancelled from admin UI' },
              confirm: {
                title: t('page.payouts.cancelConfirm', { id: payout.externalId }),
                content: t('page.payouts.cancelContent'),
                danger: true,
                okText: t('page.payouts.cancelOk'),
              },
              invalidate: inv,
              successMessage: t('page.payouts.cancelled'),
            })
          }
        >
          {t('page.payouts.cancel')}
        </Button>
      )}
    </Space>
  );
};
