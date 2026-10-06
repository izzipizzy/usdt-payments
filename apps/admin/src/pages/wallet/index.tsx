import { CopyOutlined, InfoCircleOutlined, PlusOutlined, ReloadOutlined, SendOutlined, ThunderboltOutlined } from '@ant-design/icons';
import { useCustomMutation } from '@refinedev/core';
import type { AddressDto } from '@usdt-trx/shared';
import { Alert, App, Button, Card, Checkbox, Col, Descriptions, Form, Input, Row, Segmented, Space, Statistic, Tag, Typography, theme } from 'antd';
import { useState } from 'react';
import { Trans, useTranslation } from 'react-i18next';
import { Link } from 'react-router';
import type { MnemonicWords, WalletCreateBody, WalletCreateResult, WalletImportBody, WalletImportResult, WalletMainDto, WalletPoolDto, WalletStatusDto } from '../../api/types';
import { CreateAddressModal } from '../../components/CreateAddressModal';
import { BackupCard } from './BackupCard';
import { ExplorerLink } from '../../components/ExplorerLink';
import { Money } from '../../components/Money';
import { useMe } from '../../providers/useMe';
import { useWalletStatus } from '../../providers/useWallet';
import { addressUrl } from '../../utils/explorer';
import { formatDecimal, formatInt, shortHash } from '../../utils/format';

const WORD_OPTIONS: MnemonicWords[] = [12, 24];
const statusOf = (e: unknown): number | undefined => (e as { statusCode?: number } | null)?.statusCode;

/** Numbered word grid (3 columns → 3×4 for 12 words, 3×8 for 24). */
const WordGrid = ({ words }: { words: string[] }) => {
  const { token } = theme.useToken();
  return (
    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, minmax(0, 1fr))', gap: 8 }}>
      {words.map((w, i) => (
        <div
          key={i}
          style={{
            padding: '6px 10px',
            border: `1px solid ${token.colorBorderSecondary}`,
            borderRadius: token.borderRadius,
            background: token.colorFillQuaternary,
            fontFamily: 'monospace',
            fontSize: 14,
            whiteSpace: 'nowrap',
            overflow: 'hidden',
            textOverflow: 'ellipsis',
          }}
        >
          <span style={{ opacity: 0.5, marginRight: 6, fontVariantNumeric: 'tabular-nums' }}>{i + 1}.</span>
          {w}
        </div>
      ))}
    </div>
  );
};

/** "Create a new wallet": POST /wallet/create, then a one-time reveal of the phrase. */
const CreateWalletCard = ({ onDone }: { onDone: () => void }) => {
  const { t } = useTranslation();
  const { message } = App.useApp();
  const [words, setWords] = useState<MnemonicWords>(12);
  const [result, setResult] = useState<WalletCreateResult | null>(null);
  const [saved, setSaved] = useState(false);
  const { mutateAsync, isPending } = useCustomMutation<WalletCreateResult>();

  const create = async () => {
    try {
      const body: WalletCreateBody = { words };
      const res = await mutateAsync({ url: '/wallet/create', method: 'post', values: body, successNotification: false, errorNotification: false });
      setResult(res.data);
      setSaved(false);
    } catch (e) {
      if (statusOf(e) === 409) {
        message.info(t('page.wallet.alreadyInitialized'));
        onDone();
        return;
      }
      message.error((e as Error).message || t('common.actionFailed'));
    }
  };

  const copyPhrase = async () => {
    if (!result) return;
    try {
      await navigator.clipboard.writeText(result.mnemonic);
      message.success(t('common.copied'));
    } catch {
      message.error(t('page.wallet.copyFailed'));
    }
  };

  if (!result) {
    return (
      <Card title={t('page.wallet.createTitle')} style={{ height: '100%' }}>
        <Space direction="vertical" size="middle" style={{ width: '100%' }}>
          <Typography.Paragraph type="secondary" style={{ margin: 0 }}>
            {t('page.wallet.createIntro')}
          </Typography.Paragraph>
          <Space>
            <span>{t('page.wallet.wordsLabel')}:</span>
            <Segmented<MnemonicWords> value={words} onChange={setWords} options={WORD_OPTIONS.map((n) => ({ value: n, label: t('page.wallet.wordsOption', { n }) }))} />
          </Space>
          <Button type="primary" size="middle" icon={<PlusOutlined />} loading={isPending} onClick={() => void create()}>
            {t('page.wallet.createButton')}
          </Button>
        </Space>
      </Card>
    );
  }

  return (
    <Card title={t('page.wallet.phraseTitle')} style={{ height: '100%' }}>
      <Space direction="vertical" size="middle" style={{ width: '100%' }}>
        <Alert type="warning" showIcon message={<strong>{t('page.wallet.phraseWarningTitle')}</strong>} description={t('page.wallet.phraseWarning')} />
        <WordGrid words={result.mnemonic.trim().split(/\s+/)} />
        <Space wrap>
          <Button icon={<CopyOutlined />} onClick={() => void copyPhrase()}>
            {t('page.wallet.copyPhrase')}
          </Button>
          <Typography.Text type="secondary">
            {t('page.wallet.firstAddress')}: <Typography.Text code>{shortHash(result.firstAddress, 10, 8)}</Typography.Text>
          </Typography.Text>
        </Space>
        <Checkbox checked={saved} onChange={(e) => setSaved(e.target.checked)}>
          {t('page.wallet.savedCheckbox')}
        </Checkbox>
        <Button type="primary" size="middle" disabled={!saved} onClick={onDone}>
          {t('page.wallet.continue')}
        </Button>
      </Space>
    </Card>
  );
};

/** "Import a wallet": textarea with the phrase → POST /wallet/import. */
const ImportWalletCard = ({ onDone }: { onDone: () => void }) => {
  const { t } = useTranslation();
  const { message } = App.useApp();
  const [form] = Form.useForm<WalletImportBody>();
  const { mutateAsync, isPending } = useCustomMutation<WalletImportResult>();

  const submit = async () => {
    const v = await form.validateFields();
    const body: WalletImportBody = { mnemonic: v.mnemonic.trim().replace(/\s+/g, ' ') };
    try {
      const res = await mutateAsync({ url: '/wallet/import', method: 'post', values: body, successNotification: false, errorNotification: false });
      message.success(t('page.wallet.imported', { address: shortHash(res.data.firstAddress, 10, 8) }));
      form.resetFields();
      onDone();
    } catch (e) {
      const status = statusOf(e);
      if (status === 409) {
        message.info(t('page.wallet.alreadyInitialized'));
        onDone();
      } else if (status === 422) {
        form.setFields([{ name: 'mnemonic', errors: [(e as Error).message || t('page.wallet.mnemonicInvalid')] }]);
      } else {
        message.error((e as Error).message || t('common.actionFailed'));
      }
    }
  };

  return (
    <Card title={t('page.wallet.importTitle')} style={{ height: '100%' }}>
      <Typography.Paragraph type="secondary">{t('page.wallet.importIntro')}</Typography.Paragraph>
      <Form<WalletImportBody> form={form} layout="vertical" onFinish={() => void submit()} requiredMark={false}>
        <Form.Item name="mnemonic" label={t('page.wallet.mnemonicLabel')} rules={[{ required: true, whitespace: true, message: t('page.wallet.mnemonicRequired') }]}>
          <Input.TextArea rows={4} placeholder={t('page.wallet.mnemonicPlaceholder')} autoComplete="off" spellCheck={false} style={{ fontFamily: 'monospace' }} />
        </Form.Item>
        <Button type="primary" size="middle" htmlType="submit" loading={isPending}>
          {t('page.wallet.importButton')}
        </Button>
      </Form>
    </Card>
  );
};

/** Fee-paying pool wallet: address large + copy + explorer, TRX balance, energy, top-up hints. */
const PoolCard = ({ pool }: { pool: WalletPoolDto }) => {
  const { t } = useTranslation();
  const { token } = theme.useToken();
  const href = addressUrl(undefined, pool.address, pool.explorerUrl);
  const minTrx = formatDecimal(pool.minTrx);

  return (
    <Card
      title={t('page.wallet.poolTitle')}
      extra={
        <Link to="/pool">
          <ThunderboltOutlined /> {t('page.wallet.poolStaking')}
        </Link>
      }
    >
      <Space direction="vertical" size="middle" style={{ width: '100%' }}>
        {pool.lowBalance && <Alert type="warning" showIcon message={<strong>{t('page.wallet.poolLowBalance')}</strong>} description={t('page.wallet.poolLowBalanceHint', { minTrx })} />}
        <div>
          <Typography.Text type="secondary">{t('page.wallet.poolAddress')}</Typography.Text>
          <div>
            <Typography.Text
              copyable={{ text: pool.address, tooltips: [t('common.copy'), t('common.copied')] }}
              style={{ fontFamily: 'monospace', fontSize: 22, fontWeight: 600, wordBreak: 'break-all' }}
            >
              {pool.address}
            </Typography.Text>
          </div>
          {href && (
            <a href={href} target="_blank" rel="noreferrer noopener">
              {t('common.openInExplorer')}
            </a>
          )}
        </div>
        {!pool.activated && (
          <Typography.Text type="secondary" style={{ color: token.colorWarningText }}>
            {t('page.wallet.poolNotActivated')}
          </Typography.Text>
        )}
        <Descriptions size="small" bordered column={{ xs: 1, md: 2 }}>
          <Descriptions.Item label={t('page.wallet.poolTrxBalance')}>
            <Money value={pool.trxBalance} unit="TRX" />
          </Descriptions.Item>
          <Descriptions.Item label={t('page.wallet.poolEnergyAvailable')}>
            <span style={{ fontVariantNumeric: 'tabular-nums' }}>{formatInt(pool.energyAvailable)}</span>
          </Descriptions.Item>
        </Descriptions>
        <Typography.Paragraph type="secondary" style={{ margin: 0 }}>
          {t('page.wallet.poolIntro', { minTrx })}
        </Typography.Paragraph>
      </Space>
    </Card>
  );
};

/** Main wallet: holds the whole USDT balance, receives sweeps (unless an external cold collector is set) and sends payouts. */
const MainWalletCard = ({ wallet, main, onRefresh }: { wallet: WalletStatusDto; main: WalletMainDto; onRefresh: () => void }) => {
  const { t } = useTranslation();
  const { token } = theme.useToken();
  const { isOperator } = useMe();
  const href = addressUrl(wallet.explorerBase, main.address, main.explorerUrl);
  const external = wallet.collectorExternal && !!wallet.collectorAddress;

  return (
    <Card
      title={t('page.wallet.mainTitle')}
      extra={
        <Button size="small" icon={<ReloadOutlined />} onClick={onRefresh}>
          {t('common.refresh')}
        </Button>
      }
    >
      <Space direction="vertical" size="middle" style={{ width: '100%' }}>
        <div>
          <Typography.Text type="secondary">{t('page.wallet.mainAddress')}</Typography.Text>
          <div>
            <Typography.Text
              copyable={{ text: main.address, tooltips: [t('common.copy'), t('common.copied')] }}
              style={{ fontFamily: 'monospace', fontSize: 22, fontWeight: 600, wordBreak: 'break-all' }}
            >
              {main.address}
            </Typography.Text>
          </div>
          {href && (
            <a href={href} target="_blank" rel="noreferrer noopener">
              {t('common.openInExplorer')}
            </a>
          )}
        </div>
        {!main.activated && (
          <Typography.Text type="secondary" style={{ color: token.colorWarningText }}>
            {t('page.wallet.mainNotActivated')}
          </Typography.Text>
        )}
        <Space size="large" wrap align="end">
          <Statistic
            title={t('page.wallet.mainUsdtBalance')}
            value={formatDecimal(main.usdtBalance)}
            suffix="USDT"
            valueStyle={{ fontVariantNumeric: 'tabular-nums', fontSize: 32, fontWeight: 600 }}
          />
          <Typography.Text type="secondary" style={{ fontVariantNumeric: 'tabular-nums' }}>
            {t('page.wallet.mainTrxBalance')}: <Money value={main.trxBalance} unit="TRX" />
          </Typography.Text>
        </Space>
        <Typography.Paragraph type="secondary" style={{ margin: 0 }}>
          {t('page.wallet.mainIntro')}
        </Typography.Paragraph>
        {external && (
          <Typography.Text type="secondary">
            <InfoCircleOutlined style={{ marginRight: 6 }} />
            <Trans
              i18nKey="page.wallet.collectorExternal"
              values={{ collectorUsdt: formatDecimal(wallet.collectorUsdt) }}
              components={{ addr: <ExplorerLink kind="address" value={wallet.collectorAddress} short={false} /> }}
            />
          </Typography.Text>
        )}
        <Space wrap>
          {isOperator && (
            <Link to="/payouts?new=1">
              <Button type="primary" size="middle" icon={<SendOutlined />}>
                {t('page.wallet.makePayout')}
              </Button>
            </Link>
          )}
          <Link to="/payouts">
            <Button size="middle">{t('page.wallet.allPayouts')}</Button>
          </Link>
        </Space>
      </Space>
    </Card>
  );
};

/** Initialised wallet: main wallet card + client addresses card (with "Create address" flow) + pool card. */
const WalletStatus = ({ wallet, onRefresh }: { wallet: WalletStatusDto; onRefresh: () => void }) => {
  const { t } = useTranslation();
  const { isOperator } = useMe();
  const [createOpen, setCreateOpen] = useState(false);
  const [created, setCreated] = useState<AddressDto | null>(null);
  const isMainnet = wallet.network === 'mainnet';
  const createdHref = created ? addressUrl(wallet.explorerBase, created.address, created.explorerUrl) : null;
  // `main` replaces `payout` (same address); fall back for older Core.
  const main: WalletMainDto | null = wallet.main ?? (wallet.payout ? { ...wallet.payout, isCollector: !wallet.collectorExternal } : null);

  return (
    <Space direction="vertical" size="middle" style={{ width: '100%' }}>
      {main && <MainWalletCard wallet={wallet} main={main} onRefresh={onRefresh} />}

      <Card
        title={t('page.wallet.addressesTitle')}
        extra={
          !main && (
            <Button size="small" icon={<ReloadOutlined />} onClick={onRefresh}>
              {t('common.refresh')}
            </Button>
          )
        }
      >
        <Descriptions size="small" bordered column={{ xs: 1, md: 2 }}>
          <Descriptions.Item label={t('page.wallet.network')}>
            <Tag color={isMainnet ? 'red' : 'geekblue'}>{wallet.network}</Tag>
          </Descriptions.Item>
          <Descriptions.Item label={t('page.wallet.addressesIssued')}>{formatInt(wallet.addressesIssued)}</Descriptions.Item>
          <Descriptions.Item label={t('page.wallet.xpub')}>
            {wallet.xpub ? (
              <Typography.Text code copyable={{ text: wallet.xpub, tooltips: [t('common.copy'), t('common.copied')] }} title={wallet.xpub}>
                {shortHash(wallet.xpub, 12, 8)}
              </Typography.Text>
            ) : (
              '—'
            )}
          </Descriptions.Item>
        </Descriptions>
        <Space style={{ marginTop: 16 }} wrap>
          {isOperator && (
            <Button type="primary" size="middle" icon={<PlusOutlined />} onClick={() => setCreateOpen(true)}>
              {t('page.wallet.createAddress')}
            </Button>
          )}
          <Link to="/addresses">{t('page.wallet.allAddresses')}</Link>
        </Space>
      </Card>

      {created && (
        <Card title={t('page.wallet.newAddressTitle')} type="inner" style={{ borderColor: '#26a17b' }}>
          <Space direction="vertical" size="small" style={{ width: '100%' }}>
            <Typography.Text type="secondary">
              {t('fields.alias')}: {created.alias ?? '—'}
            </Typography.Text>
            <Typography.Text
              copyable={{ text: created.address, tooltips: [t('common.copy'), t('common.copied')] }}
              style={{ fontFamily: 'monospace', fontSize: 22, fontWeight: 600, wordBreak: 'break-all' }}
            >
              {created.address}
            </Typography.Text>
            <Typography.Text strong>{t('page.wallet.sendHint')}</Typography.Text>
            <Space wrap>
              {createdHref && (
                <a href={createdHref} target="_blank" rel="noreferrer noopener">
                  {t('common.openInExplorer')}
                </a>
              )}
              <Link to={`/addresses/${created.id}`}>{t('common.open')}</Link>
            </Space>
          </Space>
        </Card>
      )}

      {wallet.pool && <PoolCard pool={wallet.pool} />}

      <CreateAddressModal
        open={createOpen}
        onClose={() => setCreateOpen(false)}
        onCreated={(a) => {
          setCreated(a);
          onRefresh();
        }}
      />
    </Space>
  );
};

export const WalletPage = () => {
  const { t } = useTranslation();
  const { wallet, isLoading, error, refetch } = useWalletStatus();
  const reload = () => void refetch();

  return (
    <div>
      <Typography.Title level={4} style={{ marginTop: 0 }}>
        {t('page.wallet.title')}
      </Typography.Title>
      {isLoading && <Card loading />}
      {!isLoading && error && (
        <Alert
          type="error"
          showIcon
          message={t('common.loadFailed')}
          description={error.message}
          action={
            <Button size="small" onClick={reload}>
              {t('common.refresh')}
            </Button>
          }
        />
      )}
      {wallet && !error && wallet.initialized && (
        <>
          <WalletStatus wallet={wallet} onRefresh={reload} />
          <BackupCard />
        </>
      )}
      {wallet && !error && !wallet.initialized && (
        <Space direction="vertical" size="middle" style={{ width: '100%' }}>
          <Alert type="info" showIcon message={t('page.wallet.notInitializedTitle')} description={t('page.wallet.notInitializedIntro')} />
          <Row gutter={[16, 16]}>
            <Col xs={24} lg={12}>
              <CreateWalletCard onDone={reload} />
            </Col>
            <Col xs={24} lg={12}>
              <ImportWalletCard onDone={reload} />
            </Col>
          </Row>
        </Space>
      )}
    </div>
  );
};
