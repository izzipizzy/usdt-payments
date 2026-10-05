import { App, Input } from 'antd';
import { useEffect, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { setStepUpPrompter } from '../api/http';

/**
 * Registers the step-up 2FA prompt: when any admin request comes back 428 (`ADMIN_TOTP_STEP_UP=true` on the
 * server), the HTTP layer opens this modal, the operator types the current authenticator code and the request is
 * retried once with it. Mount once inside antd's <App/>.
 */
export const StepUpPrompter = () => {
  const { t } = useTranslation();
  const { modal } = App.useApp();
  const codeRef = useRef('');

  useEffect(() => {
    setStepUpPrompter(
      () =>
        new Promise<string | null>((resolve) => {
          codeRef.current = '';
          modal.confirm({
            title: t('auth.stepUpTitle'),
            content: (
              <div>
                <p style={{ marginTop: 0 }}>{t('auth.stepUpHint')}</p>
                <Input
                  autoFocus
                  inputMode="numeric"
                  autoComplete="one-time-code"
                  maxLength={7}
                  placeholder={t('auth.stepUpCode')}
                  onChange={(e) => {
                    codeRef.current = e.target.value;
                  }}
                  onPressEnter={() => document.querySelector<HTMLButtonElement>('.ant-modal-confirm-btns .ant-btn-primary')?.click()}
                />
              </div>
            ),
            okText: t('common.confirm'),
            cancelText: t('common.cancel'),
            onOk: () => {
              const code = codeRef.current.replace(/\s/g, '');
              if (!/^\d{6}$/.test(code)) return Promise.reject(new Error(t('auth.codeRequired')));
              resolve(code);
              return undefined;
            },
            onCancel: () => resolve(null),
          });
        }),
    );
    return () => setStepUpPrompter(null);
  }, [modal, t]);

  return null;
};
