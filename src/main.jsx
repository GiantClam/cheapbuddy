import { StrictMode, useEffect, useMemo, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import './styles.css';
import { cancelPaymentOrder, clearSession, createApiKey, createPaymentOrder, getAffiliateDetail, getAuthToken, getCheckoutInfo, getProfile, getPublicSettings, getSavedUser, getUsageDashboardModels, getUsageDashboardStats, listAnnouncements, listApiKeys, listPaymentOrders, loginUser, registerUser, saveSession, transferAffiliateQuota, verifyAdminAccess } from './api';
import { buildAffiliateInviteLink, getAffiliateCodeFromSearch, normalizeAffiliateDetail } from './affiliate';
import { OFFICIAL_PRICE_MULTIPLIER, defaultPricingPlan, pricingPlans } from './pricing';
import { getInitialLanguage, languages, setStoredLanguage, translate } from './i18n';
import { buildInstallPrompt, createPlatformArtifact, platformOptions } from './platform-config';

import { localizeModels, modelCatalog as models } from './models';

const baseUrl = String(import.meta.env.VITE_WORKBUDDY_BASE_URL || 'https://api.cheapbuddy.cc/v1').replace(/\/+$/, '');
const cheapBuddyGroupId = Number(import.meta.env.VITE_CHEAPBUDDY_GROUP_ID || 1);
const configuredTurnstileSiteKey = String(import.meta.env.VITE_TURNSTILE_SITE_KEY || '').trim();
const turnstileRequiredByEnv = String(import.meta.env.VITE_TURNSTILE_REQUIRED || '').toLowerCase() === 'true';
const adminPortalHost = String(import.meta.env.VITE_ADMIN_PORTAL_HOST || 'admin.cheapbuddy.cc').trim().toLowerCase();
const isAdminPortalHost = typeof window !== 'undefined' && window.location.hostname.toLowerCase() === adminPortalHost;

function getAdminConsoleUrl(value) {
  const candidate = String(value || '').trim();
  if (!candidate) return '';
  try {
    const url = new URL(candidate);
    return ['http:', 'https:'].includes(url.protocol) ? url.toString().replace(/\/+$/, '') : '';
  } catch {
    return '';
  }
}

const adminConsoleUrls = {
  sub2api: getAdminConsoleUrl(import.meta.env.VITE_ADMIN_SUB2API_URL),
  newapi: getAdminConsoleUrl(import.meta.env.VITE_ADMIN_NEWAPI_URL),
};
let turnstileScriptPromise;

function loadTurnstileScript() {
  if (window.turnstile) return Promise.resolve(window.turnstile);
  if (!turnstileScriptPromise) {
    turnstileScriptPromise = new Promise((resolve, reject) => {
      const existing = document.querySelector('script[data-cheapbuddy-turnstile]');
      if (existing) {
        existing.addEventListener('load', () => resolve(window.turnstile), { once: true });
        existing.addEventListener('error', () => reject(new Error('Cloudflare Turnstile 加载失败')), { once: true });
        return;
      }
      const script = document.createElement('script');
      script.src = 'https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit';
      script.async = true;
      script.defer = true;
      script.dataset.cheapbuddyTurnstile = 'true';
      script.onload = () => resolve(window.turnstile);
      script.onerror = () => reject(new Error('Cloudflare Turnstile 加载失败'));
      document.head.appendChild(script);
    });
  }
  return turnstileScriptPromise;
}

function TurnstileWidget({ siteKey, action, resetKey, onToken, onError, t = (key) => translate('zh', key) }) {
  const containerRef = useRef(null);
  const tokenRef = useRef(onToken);
  const errorRef = useRef(onError);
  tokenRef.current = onToken;
  errorRef.current = onError;

  useEffect(() => {
    let active = true;
    let widgetId = null;
    loadTurnstileScript().then((turnstile) => {
      if (!active || !turnstile || !containerRef.current) return;
      widgetId = turnstile.render(containerRef.current, {
        sitekey: siteKey,
        action,
        theme: 'dark',
        callback: (token) => tokenRef.current(token),
        'expired-callback': () => tokenRef.current(''),
        'error-callback': () => {
          tokenRef.current('');
          errorRef.current(t('turnstileUnavailable'));
        },
      });
    }).catch((error) => {
      if (active) errorRef.current(error.message);
    });

    return () => {
      active = false;
      if (widgetId !== null && window.turnstile?.remove) window.turnstile.remove(widgetId);
    };
  }, [action, resetKey, siteKey]);

  return <div className="turnstile-wrap"><div ref={containerRef} /><small>{t('turnstileNote')}</small></div>;
}

function Icon({ name, size = 18 }) {
  const paths = {
    arrow: <><path d="M5 12h14" /><path d="m13 6 6 6-6 6" /></>,
    chevron: <path d="m6 9 6 6 6-6" />,
    check: <path d="m5 12 4 4L19 6" />,
    copy: <><rect x="9" y="9" width="10" height="10" rx="2" /><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" /></>,
    download: <><path d="M12 3v12" /><path d="m7 10 5 5 5-5" /><path d="M5 21h14" /></>,
    bolt: <path d="m13 2-9 12h7l-1 8 9-12h-7z" />,
    shield: <><path d="M12 3 20 6v5c0 5-3.4 8.7-8 10-4.6-1.3-8-5-8-10V6z" /><path d="m8.5 12 2.2 2.2 4.8-4.8" /></>,
    globe: <><circle cx="12" cy="12" r="9" /><path d="M3 12h18" /><path d="M12 3c2.2 2.4 3.3 5.4 3.3 9s-1.1 6.6-3.3 9c-2.2-2.4-3.3-5.4-3.3-9S9.8 5.4 12 3Z" /></>,
    menu: <><path d="M4 7h16" /><path d="M4 12h16" /><path d="M4 17h16" /></>,
    bell: <><path d="M18 8a6 6 0 0 0-12 0c0 7-3 7-3 9h18c0-2-3-2-3-9" /><path d="M10 21h4" /></>,
  };
  return <svg className="icon" width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">{paths[name]}</svg>;
}

function announcementId(item, index) {
  return String(item?.id ?? item?.announcement_id ?? item?.created_at ?? index);
}

function formatAnnouncementDate(value, language) {
  if (!value) return '';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return String(value);
  return new Intl.DateTimeFormat(language === 'zh' ? 'zh-CN' : 'en-US', {
    timeZone: 'Asia/Shanghai',
    dateStyle: 'medium',
    timeStyle: 'short',
  }).format(date);
}

function AnnouncementsPanel({ announcements, loading, error, language, onClose, onRefresh, t }) {
  return <div className="modal-backdrop" role="presentation" onClick={onClose}>
    <div className="announcements-modal" role="dialog" aria-modal="true" aria-labelledby="announcements-title" onClick={(event) => event.stopPropagation()}>
      <div className="modal-header"><div><span className="modal-kicker">CHEAPBUDDY UPDATES</span><h2 id="announcements-title">{t('announcements')}</h2></div><button className="modal-close" onClick={onClose} aria-label={t('close')}>×</button></div>
      <div className="announcements-toolbar"><p>{t('announcementsIntro')}</p><button className="text-button" onClick={onRefresh} disabled={loading}>{loading ? t('syncing') : t('refreshData')}</button></div>
      {error && <p className="account-error">{error}</p>}
      {loading ? <div className="account-loading"><span /><span /><span /></div> : announcements.length ? <div className="announcement-list">{announcements.map((item, index) => <article className="announcement-item" key={announcementId(item, index)}><div className="announcement-item-head"><h3>{item.title || t('announcementUntitled')}</h3><time>{formatAnnouncementDate(item.created_at || item.published_at || item.start_time, language)}</time></div><p>{item.content || item.content_md || item.body || ''}</p></article>)}</div> : <div className="account-empty">{t('noAnnouncements')}</div>}
    </div>
  </div>;
}

function Logo({ t = (key) => translate('zh', key) }) {
  return <a className="logo" href="#top" aria-label={t('homeAria')}><span className="logo-mark"><span /><span /><span /></span><span>cheap<span className="logo-accent">buddy</span><small>.cc</small></span></a>;
}

function LanguageToggle({ language, onChange }) {
  return <div className="language-switch" aria-label={translate(language, 'languageLabel')}>
    <Icon name="globe" size={14} />
    {Object.entries(languages).map(([code, label]) => <button key={code} className={language === code ? 'active' : ''} type="button" onClick={() => onChange(code)} aria-label={label} aria-pressed={language === code}>{code === 'zh' ? '中文' : 'EN'}</button>)}
  </div>;
}

function ModelMark({ model }) {
  return <span className={`model-mark mark-${model.accent}`}>{model.mark}</span>;
}

function formatAmount(value) {
  return Number(value).toFixed(2).replace(/\.00$/, '');
}

function formatCompactNumber(value) {
  const number = Number(value || 0);
  if (number >= 1000000) return `${(number / 1000000).toFixed(1).replace(/\.0$/, '')}M`;
  if (number >= 1000) return `${(number / 1000).toFixed(1).replace(/\.0$/, '')}K`;
  return number.toLocaleString('en-US');
}

function downloadTextFile(filename, content, type = 'text/plain;charset=utf-8') {
  const blob = new Blob([content], { type });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  link.click();
  URL.revokeObjectURL(url);
}

async function writeClipboard(text) {
  if (navigator.clipboard?.writeText) {
    await navigator.clipboard.writeText(text);
    return;
  }
  const textarea = document.createElement('textarea');
  textarea.value = text;
  textarea.setAttribute('readonly', 'true');
  textarea.style.position = 'fixed';
  textarea.style.opacity = '0';
  document.body.appendChild(textarea);
  textarea.select();
  const copied = document.execCommand('copy');
  textarea.remove();
  if (!copied) throw new Error('Clipboard unavailable');
}

function AccountPanel({ user, balance, usageSummary, usageModels, usageLoading, usageError, onAffiliate, onOrders, onClose, onRefresh, onRecharge, onConfig, onLogout, t }) {
  const stats = usageSummary || {};
  return <div className="modal-backdrop" role="presentation" onClick={onClose}>
    <div className="account-modal" role="dialog" aria-modal="true" aria-labelledby="account-title" onClick={(event) => event.stopPropagation()}>
      <div className="modal-header"><div><span className="modal-kicker">CHEAPBUDDY ACCOUNT</span><h2 id="account-title">{t('accountTitle')}</h2><p className="account-email">{user?.email || t('cheapbuddyUser')}</p></div><button className="modal-close" onClick={onClose} aria-label={t('close')}>×</button></div>
      <div className="account-balance"><div><span>{t('currentBalance')}</span><strong>¥ {formatAmount(balance || 0)}</strong><small>{t('sharedBalance')}</small></div><div className="account-actions"><button className="button button-primary" onClick={onRecharge}>{t('recharge')}</button><button className="button button-ghost" onClick={onOrders}>{t('paymentOrders')}</button><button className="button button-ghost" onClick={onConfig}>{t('generate')}</button><button className="button button-ghost" onClick={onAffiliate}>{t('affiliate')}</button></div></div>
      <div className="account-stats"><div><span>{t('totalRequests')}</span><strong>{formatCompactNumber(stats.total_requests)}</strong></div><div><span>{t('totalTokens')}</span><strong>{formatCompactNumber(stats.total_tokens)}</strong></div><div><span>{t('todayCost')}</span><strong>${formatAmount(stats.today_actual_cost || 0)}</strong></div></div>
      <div className="account-usage-head"><div><span className="modal-kicker">USAGE</span><h3>{t('recentUsage')}</h3></div><button className="text-button" onClick={onRefresh} disabled={usageLoading}>{usageLoading ? t('syncing') : t('refreshData')}</button></div>
      {usageError && <p className="account-error">{usageError}</p>}
      {usageLoading ? <div className="account-loading"><span /><span /><span /></div> : usageModels.length ? <div className="account-usage-list">{usageModels.slice(0, 7).map((item) => { const model = models.find((entry) => entry.id === item.model); const requestCount = item.total_requests ?? item.requests ?? 0; return <div className="account-usage-row" key={item.model}><span className="account-model-mark">{model?.mark || 'AI'}</span><div><b>{item.model || t('unknownModel')}</b><small>{t('requestCount', { count: formatCompactNumber(requestCount) })}</small></div><strong>{formatCompactNumber(item.total_tokens)} <small>tokens</small></strong><i><em style={{ width: `${Math.min(100, Math.max(7, (Number(item.total_tokens || 0) / Math.max(...usageModels.map((entry) => Number(entry.total_tokens || 0)), 1)) * 100))}%` }} /></i></div>; })}</div> : <div className="account-empty">{t('noUsage')}</div>}
      <div className="account-footer"><p className="account-source">{t('readOnlyData')}</p><button className="text-button account-logout" onClick={onLogout}>{t('logout')}</button></div>
    </div>
  </div>;
}

function paymentOrderStatusKey(status) {
  const normalized = String(status || '').toUpperCase();
  return {
    PENDING: 'paymentOrderPending',
    PAID: 'paymentOrderPaid',
    COMPLETED: 'paymentOrderCompleted',
    EXPIRED: 'paymentOrderExpired',
    CANCELLED: 'paymentOrderCancelled',
    CANCELED: 'paymentOrderCancelled',
    FAILED: 'paymentOrderFailed',
  }[normalized] || 'paymentOrderStatusUnknown';
}

function PaymentOrdersPanel({ orders, error, language, loading, cancellingId, onClose, onRefresh, onCancel, t }) {
  return <div className="modal-backdrop" role="presentation" onClick={onClose}>
    <div className="account-modal payment-orders-modal" role="dialog" aria-modal="true" aria-labelledby="payment-orders-title" onClick={(event) => event.stopPropagation()}>
      <div className="modal-header"><div><span className="modal-kicker">CHEAPBUDDY PAYMENTS</span><h2 id="payment-orders-title">{t('paymentOrders')}</h2></div><button className="modal-close" onClick={onClose} aria-label={t('close')}>×</button></div>
      <div className="affiliate-toolbar"><p>{t('paymentOrdersIntro')}</p><button className="text-button" onClick={onRefresh} disabled={loading}>{loading ? t('syncing') : t('refreshData')}</button></div>
      {error && <p className="account-error">{error}</p>}
      {loading ? <div className="account-loading"><span /><span /><span /></div> : orders.length ? <div className="payment-orders-list">{orders.map((order) => {
        const statusKey = paymentOrderStatusKey(order.status);
        const pending = String(order.status || '').toUpperCase() === 'PENDING';
        const amount = order.pay_amount ?? order.amount ?? 0;
        const orderId = order.id ?? order.order_id ?? order.out_trade_no;
        return <article className="payment-order-row" key={orderId}>
          <div className="payment-order-main"><strong>¥ {formatAmount(amount)}</strong><span>{order.out_trade_no || `#${order.id ?? '—'}`}</span></div>
          <div className="payment-order-meta"><span>{t(statusKey)}</span><time>{formatAffiliateDate(order.created_at || order.createdAt, language)}</time></div>
          {pending && <button className="text-button payment-order-cancel" onClick={() => onCancel(orderId)} disabled={cancellingId === orderId}>{cancellingId === orderId ? t('paymentOrderCancelling') : t('paymentOrderCancel')}</button>}
        </article>;
      })}</div> : <div className="account-empty">{t('paymentOrdersEmpty')}</div>}
    </div>
  </div>;
}

function formatAffiliateDate(value, language) {
  if (!value) return '—';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '—';
  return new Intl.DateTimeFormat(language === 'zh' ? 'zh-CN' : 'en-US', {
    timeZone: 'Asia/Shanghai',
    dateStyle: 'medium',
  }).format(date);
}

function AffiliatePanel({ detail, error, language, loading, transferring, onClose, onCopyCode, onCopyLink, onRefresh, onTransfer, t }) {
  const inviteLink = buildAffiliateInviteLink(detail?.affCode);
  const stats = [
    ['affiliateRebateRate', `${formatAmount(detail?.rebateRatePercent || 0)}%`],
    ['affiliateInvitedUsers', formatCompactNumber(detail?.invitedCount || 0)],
    ['affiliateAvailableBalance', `¥ ${formatAmount(detail?.availableQuota || 0)}`],
    ['affiliateTotalBalance', `¥ ${formatAmount(detail?.totalQuota || 0)}`],
  ];

  return <div className="modal-backdrop" role="presentation" onClick={onClose}>
    <div className="account-modal affiliate-modal" role="dialog" aria-modal="true" aria-labelledby="affiliate-title" onClick={(event) => event.stopPropagation()}>
      <div className="modal-header"><div><span className="modal-kicker">CHEAPBUDDY AFFILIATE</span><h2 id="affiliate-title">{t('affiliate')}</h2></div><button className="modal-close" onClick={onClose} aria-label={t('close')}>×</button></div>
      <div className="affiliate-toolbar"><p>{t('affiliateAccountData')}</p><button className="text-button" onClick={onRefresh} disabled={loading}>{loading ? t('syncing') : t('refreshData')}</button></div>
      {error && <p className="account-error">{error}</p>}
      {loading ? <div className="account-loading"><span /><span /><span /></div> : detail ? <>
        <div className="affiliate-stat-grid">{stats.map(([key, value]) => <div key={key}><span>{t(key)}</span><strong>{value}</strong></div>)}</div>
        {detail.frozenQuota > 0 && <p className="affiliate-frozen">{t('affiliateFrozenBalance', { amount: formatAmount(detail.frozenQuota) })}</p>}
        <section className="affiliate-share-card"><div><span className="modal-kicker">INVITE</span><h3>{t('affiliateInviteLink')}</h3></div><div className="affiliate-code-row"><code>{inviteLink || '—'}</code><button className="button button-ghost" type="button" disabled={!inviteLink} onClick={() => onCopyLink(inviteLink)}><Icon name="copy" size={15} /> {t('copy')}</button></div><div className="affiliate-code-meta"><span>{t('affiliateCode')}</span><code>{detail.affCode || '—'}</code><button className="text-button" type="button" disabled={!detail.affCode} onClick={() => onCopyCode(detail.affCode)}>{t('affiliateCopyCode')}</button></div></section>
        <section className="affiliate-transfer"><div><span className="modal-kicker">BALANCE</span><h3>{t('affiliateTransferTitle')}</h3><p>{t('affiliateTransferDescription')}</p></div><button className="button button-primary" type="button" disabled={transferring || detail.availableQuota <= 0} onClick={onTransfer}>{transferring ? t('processing') : t('affiliateTransfer')}</button></section>
        <section className="affiliate-invitees"><div className="account-usage-head"><div><span className="modal-kicker">RECORDS</span><h3>{t('affiliateInviteRecords')}</h3></div></div>{detail.invitees.length ? <div className="affiliate-table-wrap"><table><thead><tr><th>{t('affiliateInvitee')}</th><th>{t('affiliateJoinedAt')}</th><th>{t('affiliateRebate')}</th></tr></thead><tbody>{detail.invitees.map((invitee) => <tr key={`${invitee.userId}-${invitee.email}`}><td><b>{invitee.email || '—'}</b><small>{invitee.username || '—'}</small></td><td>{formatAffiliateDate(invitee.createdAt, language)}</td><td>¥ {formatAmount(invitee.totalRebate)}</td></tr>)}</tbody></table></div> : <div className="account-empty">{t('affiliateNoInvitees')}</div>}</section>
      </> : <div className="account-empty">{t('affiliateUnavailable')}</div>}
    </div>
  </div>;
}

function AdminConsolePicker({ onClose, t }) {
  const consoles = [
    { id: 'sub2api', mark: 'S2', titleKey: 'adminSub2ApiTitle', descriptionKey: 'adminSub2ApiDescription', url: adminConsoleUrls.sub2api },
    { id: 'newapi', mark: 'N', titleKey: 'adminNewApiTitle', descriptionKey: 'adminNewApiDescription', url: adminConsoleUrls.newapi },
  ];

  return <div className="modal-backdrop admin-picker-backdrop" role="presentation" onClick={onClose}>
    <div className="admin-picker-modal" role="dialog" aria-modal="true" aria-labelledby="admin-picker-title" onClick={(event) => event.stopPropagation()}>
      <div className="modal-header"><div><span className="modal-kicker">CHEAPBUDDY ADMIN</span><h2 id="admin-picker-title">{t('adminPickerTitle')}</h2></div><button className="modal-close" onClick={onClose} aria-label={t('close')}>×</button></div>
      <p className="admin-picker-intro">{t('adminPickerIntro')}</p>
      <div className="admin-console-grid">
        {consoles.map((consoleItem) => consoleItem.url ? <a className={`admin-console-card admin-console-${consoleItem.id}`} key={consoleItem.id} href={consoleItem.url} target="_blank" rel="noopener noreferrer" onClick={onClose}>
          <span className="admin-console-mark">{consoleItem.mark}</span><span className="admin-console-copy"><strong>{t(consoleItem.titleKey)}</strong><small>{t(consoleItem.descriptionKey)}</small></span><Icon name="arrow" size={17} />
        </a> : <div className="admin-console-card admin-console-disabled" key={consoleItem.id} aria-disabled="true">
          <span className="admin-console-mark">{consoleItem.mark}</span><span className="admin-console-copy"><strong>{t(consoleItem.titleKey)}</strong><small>{t('adminConsoleNotConfigured')}</small></span><span className="admin-console-status">ENV</span>
        </div>)}
      </div>
      <p className="admin-picker-note">{t('adminPickerNote')}</p>
    </div>
  </div>;
}

function ConfigGeneratorModal({
  platformId, onPlatformChange, selectedModels, displayModels, selected, onToggleModel,
  session, apiKeyLoading, onSyncKey, balance, onRecharge, paymentLoading, endpoint,
  testing, testState, testLatency, onTest, onCopyPrompt, onCopyConfig, onDownload,
  onCopyEndpoint, onClose, t,
}) {
  const platform = platformOptions.find(({ id }) => id === platformId) || platformOptions[0];
  const previewArtifact = selectedModels.length ? createPlatformArtifact(platformId, {
    models: selectedModels,
    apiKey: session.apiKey || 'sk-cheapbuddy-••••••••',
    baseUrl: endpoint,
  }) : null;
  const preview = previewArtifact?.content.replaceAll(previewArtifact.apiKey, session.apiKey ? `${session.apiKey.slice(0, 8)}••••${session.apiKey.slice(-4)}` : 'sk-cheapbuddy-••••••••') || '';
  const selectedModelIds = selectedModels.map((model) => model.id).join(', ');
  const modelInstruction = platformId === 'claude'
    ? t('claudeModelInstruction', { model: selectedModels[0]?.id || '—', fastModel: selectedModels[1]?.id || selectedModels[0]?.id || '—' })
    : platformId === 'codex'
      ? t('codexModelInstruction', { model: selectedModels[0]?.id || '—' })
      : t('defaultModelInstruction', { model: selectedModels[0]?.id || '—' });

  return <div className="modal-backdrop" role="presentation" onClick={onClose}>
    <div className="generator-modal generator-modal-wide" role="dialog" aria-modal="true" aria-labelledby="generator-title" onClick={(event) => event.stopPropagation()}>
      <div className="modal-header"><div><span className="modal-kicker">CHEAPBUDDY CONFIG</span><h2 id="generator-title">{t('configCenter')}</h2></div><button className="modal-close" onClick={onClose} aria-label={t('close')}>×</button></div>
      <div className="modal-balance"><span>{t('currentBalance')}</span><strong>{balance === null ? t('loginToSync') : `¥ ${Number(balance).toFixed(2)}`}</strong><button onClick={onRecharge} disabled={paymentLoading}>{paymentLoading ? t('creatingOrder') : t('recharge')}</button></div>

      <div className="modal-field platform-field">
        <label>{t('choosePlatform')} <span>{platform.name}</span></label>
        <div className="platform-selector" role="tablist" aria-label={t('choosePlatform')}>
          {platformOptions.map((option) => <button className={option.id === platformId ? 'platform-option active' : 'platform-option'} key={option.id} type="button" role="tab" aria-selected={option.id === platformId} onClick={() => onPlatformChange(option.id)}><span>{option.mark}</span><div><b>{option.name}</b><small>{t(`platform_${option.id}`)}</small></div><i>{option.id === platformId ? <Icon name="check" size={14} /> : ''}</i></button>)}
        </div>
      </div>

      <div className="modal-field"><label>{t('chooseModels')} <span>{t('selectedModels', { selected: selectedModels.length, total: displayModels.length })}</span></label><p className="model-selection-hint">{t(`platformModelSelection_${platform.modelMode}`)}</p><div className="modal-models">{displayModels.map((model) => <button className={selected.includes(model.id) ? 'modal-model selected' : 'modal-model'} key={model.id} onClick={() => onToggleModel(model.id)}><ModelMark model={model} /><span><b>{model.id}</b><small>{model.description}</small></span><span className="modal-check">{selected.includes(model.id) ? <Icon name="check" size={14} /> : ''}</span></button>)}</div></div>
      <div className="modal-field"><label>{t('userApiKey')} <span>{apiKeyLoading ? t('syncingKey') : t('managedByCheapBuddy')}</span></label><div className="key-field"><code>{session.apiKey ? `${session.apiKey.slice(0, 8)}••••${session.apiKey.slice(-4)}` : t('autoCreateKey')}</code><button onClick={onSyncKey} disabled={apiKeyLoading}><Icon name="copy" size={15} /> {t('sync')}</button></div></div>
      <div className="modal-field"><label>{t('endpoint')} <span>{t('openaiCompatible')}</span></label><div className="key-field"><code>{endpoint}</code><button onClick={onCopyEndpoint}><Icon name="copy" size={15} /> {t('copy')}</button></div></div>

      {previewArtifact && <div className="modal-field"><label>{t('generatedConfig')} <span>{previewArtifact.filename}</span></label><div className="config-preview"><div><span>{t('targetPath')}</span><code>{previewArtifact.configPath}</code></div><div className="config-model-summary"><span>{t('includedModels')}</span><code title={selectedModelIds}>{selectedModelIds}</code></div><pre>{preview}</pre></div></div>}

      <div className="test-row"><button className="button button-ghost" onClick={onTest} disabled={testing}>{testing ? t('testing') : t('testConnection')} {testState === 'success' && <span className="success-mark">{t('latency', { latency: testLatency })}</span>}</button><span>{testState === 'success' ? t('connectionSuccess') : testState === 'error' ? t('connectionFailed') : t('testBeforeDownload')}</span></div>
      <div className="config-methods"><div className="config-methods-head"><span>{t('methodTitle')}</span><small>{t('readyForPlatform', { platform: platform.name })}</small></div><div className="config-method-grid"><div className="config-method featured"><div className="config-method-title"><span className="config-method-mark">01</span><div><b>{t('generatedActions')}</b><small>{previewArtifact?.filename || t('selectModelFirst')}</small></div></div><p>{t('platformConfigDescription', { platform: platform.name })}</p><div className="config-method-actions"><button className="button button-primary" onClick={onCopyPrompt} disabled={apiKeyLoading}><Icon name="copy" size={15} /> {t('copySetupPrompt')}</button><button className="button button-ghost" onClick={onCopyConfig} disabled={apiKeyLoading}><Icon name="copy" size={15} /> {t('copyConfig')}</button><button className="button button-blue" onClick={onDownload} disabled={apiKeyLoading}><Icon name="download" size={15} /> {t('downloadConfig')}</button></div></div></div><ol className="config-instructions"><li>{t('pathInstruction', { path: previewArtifact?.configPath || '—' })}</li><li>{t('backupInstruction')}</li><li>{modelInstruction}</li><li>{t('restartInstruction', { platform: platform.name })}</li><li>{previewArtifact?.credentialEnvKey ? t('credentialEnvInstruction', { env: previewArtifact.credentialEnvKey }) : t('configSecurityInstruction')}</li></ol></div>
    </div>
  </div>;
}

function App() {
  const [language, setLanguage] = useState(getInitialLanguage);
  const [selected, setSelected] = useState(models.map((model) => model.id));
  const [mobileOpen, setMobileOpen] = useState(false);
  const [toast, setToast] = useState('');
  const [showGenerator, setShowGenerator] = useState(false);
  const [platformId, setPlatformId] = useState('workbuddy');
  const [showAccount, setShowAccount] = useState(false);
  const [showPaymentOrders, setShowPaymentOrders] = useState(false);
  const [showAffiliate, setShowAffiliate] = useState(false);
  const [showAnnouncements, setShowAnnouncements] = useState(false);
  const [announcements, setAnnouncements] = useState([]);
  const [announcementLoading, setAnnouncementLoading] = useState(false);
  const [announcementError, setAnnouncementError] = useState('');
  const [readAnnouncementIds, setReadAnnouncementIds] = useState(() => {
    try {
      return JSON.parse(window.localStorage.getItem('cheapbuddy_read_announcements') || '[]');
    } catch {
      return [];
    }
  });
  const [showAuth, setShowAuth] = useState(false);
  const [showAdminPicker, setShowAdminPicker] = useState(false);
  const [authMode, setAuthMode] = useState('login');
  const [authForm, setAuthForm] = useState({ email: '', password: '' });
  const [authLoading, setAuthLoading] = useState(false);
  const [authError, setAuthError] = useState('');
  const [turnstileToken, setTurnstileToken] = useState('');
  const [turnstileError, setTurnstileError] = useState('');
  const [turnstileResetKey, setTurnstileResetKey] = useState(0);
  const [publicTurnstile, setPublicTurnstile] = useState({ enabled: false, siteKey: '' });
  const [session, setSession] = useState(() => ({ token: getAuthToken(), user: getSavedUser(), apiKey: '' }));
  const [balance, setBalance] = useState(null);
  const [apiKeyLoading, setApiKeyLoading] = useState(false);
  const [paymentLoading, setPaymentLoading] = useState(false);
  const paymentRequestRef = useRef(false);
  const [selectedPlanId, setSelectedPlanId] = useState(defaultPricingPlan.id);
  const [testing, setTesting] = useState(false);
  const [testState, setTestState] = useState('idle');
  const [usageSummary, setUsageSummary] = useState(null);
  const [usageModels, setUsageModels] = useState([]);
  const [usageLoading, setUsageLoading] = useState(false);
  const [usageError, setUsageError] = useState('');
  const [affiliateDetail, setAffiliateDetail] = useState(null);
  const [affiliateLoading, setAffiliateLoading] = useState(false);
  const [affiliateError, setAffiliateError] = useState('');
  const [affiliateTransferLoading, setAffiliateTransferLoading] = useState(false);
  const [paymentOrders, setPaymentOrders] = useState([]);
  const [paymentOrdersLoading, setPaymentOrdersLoading] = useState(false);
  const [paymentOrdersError, setPaymentOrdersError] = useState('');
  const [paymentOrderCancellingId, setPaymentOrderCancellingId] = useState(null);
  const [testLatency, setTestLatency] = useState(0);

  const t = (key, variables) => translate(language, key, variables);
  const turnstileSiteKey = publicTurnstile.siteKey || configuredTurnstileSiteKey;
  const turnstileEnabled = publicTurnstile.enabled || Boolean(configuredTurnstileSiteKey);
  const turnstileRequired = turnstileRequiredByEnv || turnstileEnabled;
  const referralCode = useMemo(() => getAffiliateCodeFromSearch(window.location.search), []);

  useEffect(() => {
    setStoredLanguage(language);
    document.title = language === 'en' ? 'CheapBuddy · WorkBuddy model shelf' : 'CheapBuddy · WorkBuddy 多模型货架';
    const description = document.querySelector('meta[name="description"]');
    if (description) description.setAttribute('content', language === 'en' ? 'CheapBuddy — Use multiple leading models in WorkBuddy.' : 'CheapBuddy — 在 WorkBuddy 中使用多个主流最新模型。');
  }, [language]);

  const activePlatform = platformOptions.find(({ id }) => id === platformId) || platformOptions[0];
  const displayModels = useMemo(() => localizeModels(models, language), [language]);
  const selectedModels = useMemo(() => displayModels.filter((model) => selected.includes(model.id)), [displayModels, selected]);
  const configDisplayModels = [...displayModels.filter((model) => model.featured), ...displayModels.filter((model) => !model.featured)];
  const heroModels = [...displayModels.filter((model) => model.featured), ...displayModels.filter((model) => !model.featured)].slice(0, 4);
  const usageExampleModels = [...displayModels.filter((model) => model.showInUsageExample), ...displayModels.filter((model) => !model.showInUsageExample)].slice(0, 7);
  const consoleModels = displayModels.slice(0, 2);
  const displayPricingPlans = useMemo(() => pricingPlans.map((plan) => ({ ...plan, name: t(plan.nameKey), description: t(plan.descriptionKey), tag: t(plan.tagKey) })), [language]);
  const officialMultiplier = `${OFFICIAL_PRICE_MULTIPLIER.toFixed(1)}×`;

  useEffect(() => {
    getPublicSettings().then((settings) => {
      setPublicTurnstile({
        enabled: Boolean(settings?.turnstile_enabled),
        siteKey: settings?.turnstile_enabled ? String(settings.turnstile_site_key || '').trim() : '',
      });
    }).catch(() => {});
  }, []);

  useEffect(() => {
    if (!session.token) return undefined;
    let active = true;
    const loadSession = async () => {
      try {
        if (isAdminPortalHost) await verifyAdminAccess();
        const profile = await getProfile();
        if (!active) return;
        setSession((current) => ({ ...current, user: profile }));
        setBalance(profile?.balance ?? null);
      } catch {
        if (!active) return;
        clearSession();
        setSession({ token: null, user: null, apiKey: '' });
      }
    };
    loadSession();
    return () => { active = false; };
  }, [session.token]);

  useEffect(() => {
    if (referralCode && !session.token && !isAdminPortalHost) {
      setAuthMode('register');
      setShowAuth(true);
    }
  }, [referralCode, session.token]);

  useEffect(() => {
    window.localStorage.setItem('cheapbuddy_read_announcements', JSON.stringify(readAnnouncementIds));
  }, [readAnnouncementIds]);

  const notify = (message) => {
    setToast(message);
    window.setTimeout(() => setToast(''), 2600);
  };

  const changePlatform = (nextPlatformId) => {
    const nextPlatform = platformOptions.find(({ id }) => id === nextPlatformId) || platformOptions[0];
    setPlatformId(nextPlatformId);
    if (nextPlatform.maxModels) setSelected((current) => current.slice(0, nextPlatform.maxModels));
  };

  const toggleModel = (id) => setSelected((current) => {
    if (current.includes(id)) return current.filter((item) => item !== id);
    const limit = activePlatform.maxModels;
    if (!limit) return [...current, id];
    return [...current, id].slice(-limit);
  });

  const getOrCreateApiKey = async () => {
    const keys = await listApiKeys();
    let key = keys.find((item) => item.status === 'active') || keys[0];
    if (!key) key = await createApiKey('CheapBuddy WorkBuddy', cheapBuddyGroupId);
    return key?.key || '';
  };

  const ensureApiKey = async () => {
    if (!session.token || session.apiKey) return session.apiKey;
    setApiKeyLoading(true);
    try {
      const apiKey = await getOrCreateApiKey();
      setSession((current) => ({ ...current, apiKey }));
      return apiKey;
    } finally {
      setApiKeyLoading(false);
    }
  };

  const loadUsage = async () => {
    if (!session.token) return;
    setUsageLoading(true);
    setUsageError('');
    try {
      const endDate = new Date();
      const startDate = new Date(endDate);
      startDate.setDate(startDate.getDate() - 29);
      const toDate = (date) => date.toISOString().slice(0, 10);
      const [stats, modelResult] = await Promise.all([
        getUsageDashboardStats(),
        getUsageDashboardModels({ start_date: toDate(startDate), end_date: toDate(endDate) }),
      ]);
      setUsageSummary(stats || {});
      setUsageModels(Array.isArray(modelResult?.models) ? modelResult.models : Array.isArray(modelResult) ? modelResult : []);
    } catch (error) {
      setUsageError(error.message || t('usageSyncFailed'));
    } finally {
      setUsageLoading(false);
    }
  };

  const loadAffiliate = async () => {
    if (!session.token) return;
    setAffiliateLoading(true);
    setAffiliateError('');
    try {
      setAffiliateDetail(normalizeAffiliateDetail(await getAffiliateDetail()));
    } catch (error) {
      setAffiliateError(error.code === 'REQUEST_TIMEOUT' ? t('affiliateRequestTimeout') : error.message || t('affiliateLoadFailed'));
    } finally {
      setAffiliateLoading(false);
    }
  };

  const loadPaymentOrders = async () => {
    if (!session.token) return;
    setPaymentOrdersLoading(true);
    setPaymentOrdersError('');
    try {
      const result = await listPaymentOrders();
      const items = Array.isArray(result) ? result : result?.items || result?.data?.items || [];
      setPaymentOrders(items);
    } catch (error) {
      setPaymentOrdersError(error.message || t('paymentOrdersLoadFailed'));
    } finally {
      setPaymentOrdersLoading(false);
    }
  };

  const openAccount = async () => {
    if (!session.token) {
      setShowAuth(true);
      return;
    }
    setShowAccount(true);
    await loadUsage();
  };

  const openAffiliate = async () => {
    if (!session.token) {
      setShowAuth(true);
      return;
    }
    setShowAffiliate(true);
    await loadAffiliate();
  };

  const openPaymentOrders = async () => {
    if (!session.token) {
      setShowAuth(true);
      return;
    }
    setShowAccount(false);
    setShowPaymentOrders(true);
    await loadPaymentOrders();
  };

  const cancelUserPaymentOrder = async (orderId) => {
    if (!orderId || paymentOrderCancellingId) return;
    setPaymentOrderCancellingId(orderId);
    try {
      await cancelPaymentOrder(orderId);
      notify(t('paymentOrderCancelSuccess'));
      await loadPaymentOrders();
    } catch (error) {
      setPaymentOrdersError(error.message || t('paymentOrdersLoadFailed'));
    } finally {
      setPaymentOrderCancellingId(null);
    }
  };

  const copyAffiliateValue = async (value, successKey) => {
    try {
      await writeClipboard(value);
      notify(t(successKey));
    } catch {
      notify(t('copyFailed'));
    }
  };

  const transferAffiliateBalance = async () => {
    if (!affiliateDetail || affiliateDetail.availableQuota <= 0 || affiliateTransferLoading) return;
    setAffiliateTransferLoading(true);
    setAffiliateError('');
    try {
      const result = await transferAffiliateQuota();
      const nextBalance = Number(result?.balance);
      if (Number.isFinite(nextBalance)) {
        setBalance(nextBalance);
        setSession((current) => ({ ...current, user: current.user ? { ...current.user, balance: nextBalance } : current.user }));
      }
      notify(t('affiliateTransferSuccess', { amount: formatAmount(result?.transferred_quota || 0) }));
      await loadAffiliate();
    } catch (error) {
      setAffiliateError(error.code === 'REQUEST_TIMEOUT' ? t('affiliateRequestTimeout') : error.message || t('affiliateTransferFailed'));
    } finally {
      setAffiliateTransferLoading(false);
    }
  };

  const loadAnnouncements = async () => {
    if (!session.token) return [];
    setAnnouncementLoading(true);
    setAnnouncementError('');
    try {
      const result = await listAnnouncements();
      const next = Array.isArray(result) ? result : [];
      setAnnouncements(next);
      return next;
    } catch (error) {
      setAnnouncementError(error.message || t('announcementsLoadFailed'));
      return [];
    } finally {
      setAnnouncementLoading(false);
    }
  };

  const openAnnouncements = async () => {
    if (!session.token) {
      setShowAuth(true);
      return;
    }
    setShowAnnouncements(true);
    const items = await loadAnnouncements();
    if (items.length) {
      setReadAnnouncementIds((current) => Array.from(new Set([...current, ...items.map(announcementId)])));
    }
  };

  useEffect(() => {
    if (session.token) loadAnnouncements();
    else {
      setAnnouncements([]);
      setShowAnnouncements(false);
    }
  }, [session.token]);

  const openGenerator = async () => {
    if (!session.token) {
      setShowAuth(true);
      return;
    }
    try {
      await ensureApiKey();
      setShowGenerator(true);
    } catch (error) {
      notify(error.message || t('apiKeyReadFailed'));
    }
  };

  const switchAuthMode = (mode) => {
    setAuthMode(mode);
    setAuthError('');
    setTurnstileToken('');
    setTurnstileError('');
    setTurnstileResetKey((current) => current + 1);
  };

  const isExistingUserError = (error) => /exist|已存在|already/i.test(error?.message || '');

  const submitLogin = async (event) => {
    event.preventDefault();
    if (isAdminPortalHost && authMode === 'register') {
      setAuthError(t('adminLoginOnly'));
      return;
    }
    if (turnstileRequired && !turnstileSiteKey) {
      setAuthError(t('turnstileNotConfigured'));
      return;
    }
    if (turnstileRequired && !turnstileToken) {
      setAuthError(t('completeTurnstile'));
      return;
    }
    setAuthLoading(true);
    setAuthError('');
    try {
      let result;
      let action = authMode;
      if (authMode === 'register') {
        try {
          result = await registerUser(authForm.email.trim(), authForm.password, turnstileToken, referralCode);
        } catch (error) {
          if (!isExistingUserError(error)) throw error;
          setAuthMode('login');
          setTurnstileToken('');
          setTurnstileResetKey((current) => current + 1);
          throw new Error(t('alreadyRegistered'));
        }
      } else {
        result = await loginUser(authForm.email.trim(), authForm.password, turnstileToken);
      }
      if (result.requires_2fa) throw new Error(t('twoFactorRequired'));
      saveSession(result);
      const nextSession = { token: result.access_token, user: result.user, apiKey: '' };
      if (isAdminPortalHost && action === 'login') {
        try {
          await verifyAdminAccess();
        } catch {
          clearSession();
          throw new Error(t('adminAccessDenied'));
        }
      }
      setSession(nextSession);
      setBalance(result.user?.balance ?? null);
      setShowAuth(false);
      if (action === 'register') {
        try {
          setApiKeyLoading(true);
          const apiKey = await getOrCreateApiKey();
          setSession({ ...nextSession, apiKey });
          setShowGenerator(true);
          notify(t('registerSuccess'));
        } catch (error) {
          setShowGenerator(true);
          notify(t('registerKeyFailed', { message: error.message || t('apiKeyReadFailed') }));
        } finally {
          setApiKeyLoading(false);
        }
      } else {
        if (isAdminPortalHost) setShowAdminPicker(true);
        notify(t('loginSuccess'));
      }
    } catch (error) {
      setAuthError(error.message || t(authMode === 'register' ? 'registerFailed' : 'loginFailed'));
    } finally {
      setAuthLoading(false);
    }
  };

  const startRecharge = async (plan = defaultPricingPlan) => {
    if (paymentRequestRef.current) return;
    if (!session.token) {
      setSelectedPlanId(plan.id);
      setShowAuth(true);
      return;
    }
    paymentRequestRef.current = true;
    setSelectedPlanId(plan.id);
    setPaymentLoading(true);
    try {
      const checkout = await getCheckoutInfo();
      const methods = checkout.methods || {};
      const paymentType = ['easypay', 'alipay', 'alipay_direct'].find((type) => methods[type]?.available !== false && methods[type]);
      if (!paymentType) throw new Error(t('paymentNotConfigured'));
      const paymentResultUrl = `${window.location.origin}/payment/result`;
      const order = await createPaymentOrder({ amount: plan.amount, payment_type: paymentType, order_type: 'balance', payment_source: 'cheapbuddy', return_url: paymentResultUrl, is_mobile: window.innerWidth < 700 });
      if (order.pay_url) window.location.assign(order.pay_url);
      else if (order.qr_code) notify(t('orderCreatedQr'));
      else notify(t('orderCreated'));
    } catch (error) {
      if (error?.reason === 'TOO_MANY_PENDING') {
        const maxPending = error.metadata?.max || '';
        notify(t('paymentTooManyPending', { max: maxPending }));
        setShowAccount(false);
        setShowPaymentOrders(true);
        loadPaymentOrders();
      } else {
        notify(error.message || t('paymentFailed'));
      }
    } finally {
      setPaymentLoading(false);
      paymentRequestRef.current = false;
    }
  };

  const downloadConfig = async () => {
    if (!session.token) {
      setAuthMode('login');
      setShowAuth(true);
      notify(t('loginForConfig'));
      return;
    }
    if (!selectedModels.length) return notify(t('selectModelFirst'));
    setApiKeyLoading(true);
    try {
      const apiKey = session.apiKey || await getOrCreateApiKey();
      if (!apiKey) throw new Error(t('missingApiKey'));
      setSession((current) => ({ ...current, apiKey }));
      const artifact = createPlatformArtifact(platformId, { models: selectedModels, apiKey, baseUrl });
      downloadTextFile(artifact.filename, artifact.content, artifact.mimeType);
      notify(t('configDownloaded', { filename: artifact.filename, platform: activePlatform.name }));
    } catch (error) {
      notify(error.message || t('apiKeyReadFailed'));
    } finally {
      setApiKeyLoading(false);
    }
  };

  const copyConfig = async () => {
    if (!session.token) {
      setAuthMode('login');
      setShowAuth(true);
      notify(t('loginForConfig'));
      return;
    }
    if (!selectedModels.length) return notify(t('selectModelFirst'));
    setApiKeyLoading(true);
    try {
      const apiKey = session.apiKey || await getOrCreateApiKey();
      if (!apiKey) throw new Error(t('missingApiKey'));
      setSession((current) => ({ ...current, apiKey }));
      const artifact = createPlatformArtifact(platformId, { models: selectedModels, apiKey, baseUrl });
      await writeClipboard(artifact.content);
      notify(t('configCopied', { platform: activePlatform.name }));
    } catch (error) {
      notify(error.message || t('copyFailed'));
    } finally {
      setApiKeyLoading(false);
    }
  };

  const copyInstallPrompt = async () => {
    if (!session.token) {
      setAuthMode('login');
      setShowAuth(true);
      notify(t('loginForPrompt'));
      return;
    }
    if (!selectedModels.length) return notify(t('selectModelFirst'));
    setApiKeyLoading(true);
    try {
      const apiKey = session.apiKey || await getOrCreateApiKey();
      if (!apiKey) throw new Error(t('missingApiKey'));
      setSession((current) => ({ ...current, apiKey }));
      const artifact = createPlatformArtifact(platformId, { models: selectedModels, apiKey, baseUrl });
      await writeClipboard(buildInstallPrompt(artifact, language));
      notify(t('promptCopied', { platform: activePlatform.name }));
    } catch (error) {
      notify(error.message || t('copyFailed'));
    } finally {
      setApiKeyLoading(false);
    }
  };

  const testConnection = async () => {
    if (!selectedModels.length) {
      notify(t('selectModelFirst'));
      return;
    }
    setTesting(true);
    setTestState('idle');
    setTestLatency(0);
    const startedAt = performance.now();

    try {
      const apiKey = session.apiKey || await ensureApiKey();
      if (!apiKey) throw new Error(t('missingApiKey'));

      const protocolRequest = {
        workbuddy: {
          url: `${baseUrl}/chat/completions`,
          body: {
            model: selectedModels[0].id,
            messages: [{ role: 'user', content: 'Reply with OK only.' }],
            temperature: 0,
            max_tokens: 8,
            stream: false,
          },
          isValid: (body) => Array.isArray(body.choices) && body.choices.length > 0,
        },
        opencode: {
          url: `${baseUrl}/chat/completions`,
          body: {
            model: selectedModels[0].id,
            messages: [{ role: 'user', content: 'Reply with OK only.' }],
            temperature: 0,
            max_tokens: 8,
            stream: false,
          },
          isValid: (body) => Array.isArray(body.choices) && body.choices.length > 0,
        },
        claude: {
          url: `${baseUrl}/messages`,
          headers: { 'anthropic-version': '2023-06-01' },
          body: {
            model: selectedModels[0].id,
            max_tokens: 8,
            messages: [{ role: 'user', content: 'Reply with OK only.' }],
            stream: false,
          },
          isValid: (body) => Array.isArray(body.content) && body.content.length > 0,
        },
        codex: {
          url: `${baseUrl}/responses`,
          body: {
            model: selectedModels[0].id,
            input: 'Reply with OK only.',
            max_output_tokens: 8,
            stream: false,
          },
          isValid: (body) => Boolean(body.id) || (Array.isArray(body.output) && body.output.length > 0),
        },
      }[platformId] || null;
      if (!protocolRequest) throw new Error(t('connectionTestFailed'));
      const response = await fetch(protocolRequest.url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${apiKey}`,
          ...(protocolRequest.headers || {}),
        },
        body: JSON.stringify(protocolRequest.body),
      });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) {
        throw new Error(body.error?.message || body.message || t('apiRequestFailed', { status: response.status }));
      }
      if (!protocolRequest.isValid(body)) {
        throw new Error(t('badModelResponse'));
      }

      setTestLatency(Math.max(1, Math.round(performance.now() - startedAt)));
      setTestState('success');
    } catch (error) {
      setTestState('error');
      notify(error.message || t('connectionTestFailed'));
    } finally {
      setTesting(false);
    }
  };

  const closeNav = () => setMobileOpen(false);

  const logout = () => {
    clearSession();
    setSession({ token: null, user: null, apiKey: '' });
    setBalance(null);
    setUsageSummary(null);
    setUsageModels([]);
    setAffiliateDetail(null);
    setAffiliateError('');
    setShowAccount(false);
    setShowAffiliate(false);
    setShowAnnouncements(false);
    setShowGenerator(false);
    notify(t('loggedOut'));
  };

  const unreadAnnouncementCount = announcements.filter((item, index) => !readAnnouncementIds.includes(announcementId(item, index))).length;

  return <div id="top" className="app-shell">
    <div className="noise" />
    <header className="topbar">
      <div className="nav-wrap">
        <Logo t={t} />
        <nav className={mobileOpen ? 'nav-links is-open' : 'nav-links'}>
          <a href="#models" onClick={closeNav}>{t('navModels')}</a>
          <a href="#how" onClick={closeNav}>{t('navHow')}</a>
          <a href="#pricing" onClick={closeNav}>{t('navPricing')}</a>
          <a href="#guide" onClick={closeNav}>{t('navGuide')}</a>
          <button className="mobile-announcement-link" onClick={() => { closeNav(); openAnnouncements(); }}><Icon name="bell" size={16} />{t('announcements')}{unreadAnnouncementCount > 0 && <span className="announcement-count">{unreadAnnouncementCount > 9 ? '9+' : unreadAnnouncementCount}</span>}</button>
          <button className="mobile-account-link" onClick={() => { closeNav(); openAccount(); }}>{session.token ? t('accountOverview') : t('authAction')}</button>
        </nav>
        <div className="nav-actions">
          <LanguageToggle language={language} onChange={setLanguage} />
          <button className="announcement-trigger" type="button" onClick={openAnnouncements} aria-label={t('announcements')} title={t('announcements')}><Icon name="bell" size={17} />{unreadAnnouncementCount > 0 && <span className="announcement-count">{unreadAnnouncementCount > 9 ? '9+' : unreadAnnouncementCount}</span>}</button>
          <button className="text-button" onClick={openAccount}>{session.token ? t('account') : t('authAction')}</button>
          <button className="button button-small button-blue" onClick={openGenerator}>{t('generateConfig')} <Icon name="arrow" size={15} /></button>
        </div>
        <button className="menu-button" onClick={() => setMobileOpen((open) => !open)} aria-label={t('openMenu')}><Icon name="menu" /></button>
      </div>
    </header>

    <main>
      <section className="hero section-wrap">
        <div className="hero-copy reveal">
          <div className="status-line"><span className="status-dot" />{t('channelOnline', { count: models.length })}</div>
          <h1>{t('heroTitle')}<br /><em>{t('heroTitleAccent')}</em></h1>
          <p className="hero-lead">{t('heroLead1')}<br className="hero-mobile-break" />{t('heroLead2', { officialMultiplier })}<br className="hero-mobile-break" />{t('heroLead3')}</p>
          <div className="hero-actions"><button className="button button-primary" onClick={openGenerator}>{t('generateConfig')} <Icon name="arrow" /></button><a className="button button-ghost" href="#models">{t('viewModels')} <Icon name="chevron" size={16} /></a></div>
          <div className="hero-trust"><span><Icon name="check" size={15} /> {t('streaming')}</span><span><Icon name="check" size={15} /> {t('toolCalls')}</span><span><Icon name="check" size={15} /> {t('usageAvailable')}</span></div>
        </div>
        <div className="hero-visual reveal reveal-delay" aria-label={t('currentBalance')}>
          <div className="routing-grid" />
          <div className="orbit orbit-one" /><div className="orbit orbit-two" /><div className="orbit orbit-three" />
          <div className="visual-core"><span className="core-spark">✦</span><small>ONE BALANCE</small><strong>{t('balanceCore')}<br />{t('modelsCore', { count: models.length })}</strong><span className="core-url">cheapbuddy.cc / v1</span></div>
          {heroModels.map((model, index) => <div className={`floating-card route-card route-${index + 1}`} key={model.id}><ModelMark model={model} /><div><small>{model.vendor}</small><strong>{model.short}</strong></div><b>{officialMultiplier}</b></div>)}
          <div className="visual-caption"><span className="live-line" /> <span>ROUTING / READY</span><span className="caption-separator" /><span>OPENAI COMPATIBLE</span></div>
        </div>
      </section>

      <section id="models" className="models-section section-wrap">
        <div className="section-heading"><span className="section-index">01</span><div><h2>{t('modelShelfTitle')}</h2><p>{t('modelShelfLead', { count: models.length })}</p></div><a href="#generator" className="heading-link" onClick={(event) => { event.preventDefault(); openGenerator(); }}>{t('startCombining')} <Icon name="arrow" size={15} /></a></div>
        <div className="model-grid">{displayModels.map((model) => <article className="model-card" key={model.id}><div className="model-card-top"><ModelMark model={model} /><span className="model-state"><span className="mini-dot" /> {t('available')}</span></div><div className="model-card-name"><small>{model.vendor} / {model.short}</small><h3>{model.id}</h3></div><p>{model.description}</p><div className="model-prices"><span>{t('input')} <b>{model.input}</b> / M</span><span>{t('output')} <b>{model.output}</b> / M</span></div><div className="model-card-meta"><span>{t('officialPrice')}</span><b>{officialMultiplier}</b></div></article>)}</div>
        <div className="shelf-note"><span className="shelf-line" /><span>{t('priceNote', { officialMultiplier })}</span><span className="shelf-line" /></div>
      </section>

      <section id="how" className="steps-section section-wrap">
        <div className="section-heading compact"><span className="section-index">02</span><div><h2>{t('howTitle')}</h2><p>{t('howLead')}</p></div></div>
        <div className="step-grid">
          {[['01', 'stepRegister', 'stepRegisterText', '¥'], ['02', 'stepChoose', 'stepChooseText', '✦'], ['03', 'stepImport', 'stepImportText', '{ }']].map(([number, titleKey, textKey, mark], index) => <div className="step-card" key={number}><span className="step-number">{number}</span><div className={`step-visual step-visual-${index + 1}`}><span>{mark}</span></div><h3>{t(titleKey)}</h3><p>{t(textKey)}</p>{index < 2 && <span className="step-arrow"><Icon name="arrow" size={16} /></span>}</div>)}
        </div>
      </section>

      <section id="generator" className="generator-section section-wrap">
        <div className="generator-panel"><div className="generator-copy"><span className="section-index">03</span><h2>{t('generatorTitle')}<br /><em>{t('generatorTitleAccent')}</em></h2><p>{t('generatorLead')}</p><div className="generator-perks"><span><Icon name="shield" size={17} /> {t('boundKey')}</span><span><Icon name="bolt" size={17} /> {t('readyNow')}</span></div><button className="button button-primary" onClick={openGenerator}>{t('openConfigCenter')} <Icon name="arrow" /></button></div><div className="mini-console"><div className="console-bar"><span><i /><i /><i /></span><small>cheapbuddy / models.json</small><span className="console-live">● {t('live')}</span></div><pre><code><span className="code-key">models</span>: [{consoleModels.map((model, index) => <span key={model.id}><br />  {'{'} <span className="code-key">id</span>: <span className="code-string">"{model.id}"</span>,<br />    <span className="code-key">name</span>: <span className="code-string">"{model.short}"</span>,<br />    <span className="code-key">url</span>: <span className="code-string">{JSON.stringify(baseUrl + '/chat/completions')}</span><br />  {'}'}{index < consoleModels.length - 1 ? ',' : ''}</span>)}<br />]</code></pre><div className="console-footer"><span><span className="mini-dot" /> {t('modelsReady', { count: models.length })}</span><span>JSON</span></div></div></div>
      </section>

      <section id="pricing" className="pricing-section section-wrap"><div className="pricing-head"><div><span className="section-index">04</span><h2>{t('pricingTitle')}<br /><em>{t('pricingTitleAccent')}</em></h2></div><p>{t('pricingLead', { officialMultiplier })}</p></div><div className="pricing-plan-grid">{displayPricingPlans.map((plan) => <article className={plan.featured ? 'pricing-plan-card featured' : 'pricing-plan-card'} key={plan.id}><div className="pricing-plan-top"><span>{plan.name}</span><small>{plan.tag}</small></div><div className="pricing-plan-price">¥<strong>{formatAmount(plan.amount)}</strong></div><div className="pricing-plan-balance"><b>{plan.workbuddyPoints.toLocaleString()}</b><span>{t('workbuddyPoints')}</span></div><p>{plan.description}</p><button className={plan.featured ? 'button button-primary full-width' : 'button button-ghost full-width'} onClick={() => startRecharge(plan)} disabled={paymentLoading}>{paymentLoading && selectedPlanId === plan.id ? t('creatingOrder') : t('rechargeAmount', { amount: formatAmount(plan.amount) })} <Icon name="arrow" size={15} /></button></article>)}</div><p className="pricing-footnote"><span className="pricing-footnote-dot" />{t('pricingFootnote')}</p><div className="pricing-grid"><div className="balance-card"><div className="balance-label">{t('currentBalance')} <span>{t('allModelsShared')}</span></div><div className="balance-amount">{balance === null ? <strong className="balance-login">{t('loginToSync')}</strong> : <>¥<strong>{formatAmount(balance)}</strong><span>{t('availableBalance')}</span></>}</div><div className="rate-highlight"><span>{t('actualBilling')}</span><strong>{officialMultiplier}</strong><small>{t('officialPriceBilling', { officialMultiplier })}</small></div><button className="button button-blue full-width" onClick={() => startRecharge(displayPricingPlans.find((plan) => plan.id === selectedPlanId) || displayPricingPlans[0])} disabled={paymentLoading}>{paymentLoading ? t('creatingOrder') : t('rechargeAmount', { amount: formatAmount((displayPricingPlans.find((plan) => plan.id === selectedPlanId) || displayPricingPlans[0]).amount) })} <Icon name="arrow" size={16} /></button></div><div className="usage-card"><div className="usage-top"><span>{t('usageExample')}</span><span className="usage-range">{t('inputOutput')} <Icon name="chevron" size={14} /></span></div><div className="usage-list">{usageExampleModels.map((model) => <div className="usage-row" key={model.id}><ModelMark model={model} /><span>{model.id}</span><b>{model.input} / {model.output}</b><i><em style={{ width: `${Math.min(92, 18 + usageExampleModels.indexOf(model) * 15)}%` }} /></i></div>)}</div><div className="usage-footer"><span><i className="usage-dot" /> {t('usageRealtime')}</span><span>{t('transparentBilling')}</span></div></div></div></section>

          <section id="guide" className="guide-section section-wrap"><div className="guide-copy"><span className="section-index">05</span><h2>{t('guideTitle')}<br />{t('guideTitleAccent')}</h2><p>{t('guideLead')}</p><button className="button button-primary guide-config-button" type="button" onClick={openGenerator}>{t('choosePlatformAndGenerate')} <Icon name="arrow" size={15} /></button><p className="guide-prompt-hint">{t('promptDescription')}</p></div><div className="guide-detail"><div className="guide-method"><span className="guide-method-mark">01</span><div><b>{t('guideStepDownload')}</b><p>{t('guideStepDownloadText')}</p></div></div><div className="guide-method"><span className="guide-method-mark">02</span><div><b>{t('guideStepRestart')}</b><p>{t('guideStepRestartText')}</p></div></div><div className="os-list platform-guide-list">{platformOptions.map((platform) => <button className={platform.id === platformId ? 'os-row active' : 'os-row'} key={platform.id} type="button" onClick={() => { changePlatform(platform.id); openGenerator(); }}><span className="os-icon">{platform.mark}</span><div><b>{platform.name}</b><small>{t(`platform_${platform.id}`)}</small></div><Icon name="arrow" size={17} /></button>)}</div></div></section>
    </main>

    <footer className="footer section-wrap"><Logo t={t} /><div className="footer-note">{t('footerNote')}<br /><span>{t('poweredBy')}</span></div><div className="footer-links"><a href="#models">{t('footerModels')}</a><a href="#guide">{t('footerGuide')}</a><a href="#" onClick={(event) => { event.preventDefault(); notify(t('serviceStatus')); }}>{t('serviceStatus')}</a></div><div className="footer-contact" aria-label={t('contact')}><div className="footer-contact-info"><span className="footer-contact-label">{t('contact')}</span><a className="footer-x-link" href="https://x.com/dennis_huangbei" target="_blank" rel="noopener noreferrer" aria-label={t('contactOnX')}><span className="footer-x-mark" aria-hidden="true">X</span><span>@dennis_huangbei</span><Icon name="arrow" size={14} /></a></div><img className="footer-qr" src="/wechat-contact-qr.png" alt={t('wechatQr')} /></div><span className="footer-copy">© 2026 CheapBuddy</span></footer>

    {showAccount && <AccountPanel user={session.user} balance={balance} usageSummary={usageSummary} usageModels={usageModels} usageLoading={usageLoading} usageError={usageError} onAffiliate={() => { setShowAccount(false); openAffiliate(); }} onOrders={openPaymentOrders} onClose={() => setShowAccount(false)} onRefresh={loadUsage} onRecharge={() => { setShowAccount(false); startRecharge(); }} onConfig={() => { setShowAccount(false); openGenerator(); }} onLogout={logout} t={t} />}
    {showPaymentOrders && <PaymentOrdersPanel orders={paymentOrders} error={paymentOrdersError} language={language} loading={paymentOrdersLoading} cancellingId={paymentOrderCancellingId} onClose={() => setShowPaymentOrders(false)} onRefresh={loadPaymentOrders} onCancel={cancelUserPaymentOrder} t={t} />}

    {showAffiliate && <AffiliatePanel detail={affiliateDetail} error={affiliateError} language={language} loading={affiliateLoading} transferring={affiliateTransferLoading} onClose={() => setShowAffiliate(false)} onCopyCode={(code) => copyAffiliateValue(code, 'affiliateCodeCopied')} onCopyLink={(link) => copyAffiliateValue(link, 'affiliateLinkCopied')} onRefresh={loadAffiliate} onTransfer={transferAffiliateBalance} t={t} />}

    {showAnnouncements && <AnnouncementsPanel announcements={announcements} loading={announcementLoading} error={announcementError} language={language} onClose={() => setShowAnnouncements(false)} onRefresh={loadAnnouncements} t={t} />}

    {showGenerator && <ConfigGeneratorModal platformId={platformId} onPlatformChange={changePlatform} selectedModels={selectedModels} displayModels={configDisplayModels} selected={selected} onToggleModel={toggleModel} session={session} apiKeyLoading={apiKeyLoading} onSyncKey={ensureApiKey} balance={balance} onRecharge={startRecharge} paymentLoading={paymentLoading} endpoint={baseUrl} testing={testing} testState={testState} testLatency={testLatency} onTest={testConnection} onCopyPrompt={copyInstallPrompt} onCopyConfig={copyConfig} onDownload={downloadConfig} onCopyEndpoint={() => writeClipboard(baseUrl).then(() => notify(t('endpointCopied'))).catch(() => notify(t('copyFailed')))} onClose={() => setShowGenerator(false)} t={t} />}
    {showAuth && <div className="modal-backdrop" role="presentation" onClick={() => setShowAuth(false)}><div className="generator-modal auth-modal" role="dialog" aria-modal="true" aria-labelledby="auth-title" onClick={(event) => event.stopPropagation()}><div className="modal-header"><div><span className="modal-kicker">CHEAPBUDDY ACCOUNT</span><h2 id="auth-title">{t(authMode === 'login' ? 'loginTitle' : 'registerTitle')}</h2></div><button className="modal-close" onClick={() => setShowAuth(false)} aria-label={t('close')}>×</button></div><div className="auth-tabs" role="tablist" aria-label={t('accountOperations')}><button className={authMode === 'login' ? 'auth-tab active' : 'auth-tab'} type="button" onClick={() => switchAuthMode('login')} role="tab" aria-selected={authMode === 'login'}>{t('loginTab')}</button>{!isAdminPortalHost && <button className={authMode === 'register' ? 'auth-tab active' : 'auth-tab'} type="button" onClick={() => switchAuthMode('register')} role="tab" aria-selected={authMode === 'register'}>{t('registerTab')}</button>}</div><p className="auth-intro">{t(authMode === 'login' ? 'loginIntro' : 'registerIntro')}</p>{authMode === 'register' && referralCode && <p className="affiliate-registration-notice">{t('affiliateRegistrationNotice', { code: referralCode })}</p>}<form className="auth-form" onSubmit={submitLogin}><label>{t('email')}<input type="email" value={authForm.email} onChange={(event) => setAuthForm((current) => ({ ...current, email: event.target.value }))} placeholder={t('emailPlaceholder')} autoComplete="email" required /></label><label>{t('password')}<input type="password" value={authForm.password} onChange={(event) => setAuthForm((current) => ({ ...current, password: event.target.value }))} placeholder={t(authMode === 'register' ? 'registerPasswordPlaceholder' : 'loginPasswordPlaceholder')} autoComplete={authMode === 'register' ? 'new-password' : 'current-password'} minLength={6} required /></label>{turnstileRequired && turnstileSiteKey && <TurnstileWidget key={`${authMode}-${turnstileResetKey}`} siteKey={turnstileSiteKey} action={authMode} resetKey={turnstileResetKey} onToken={(token) => { setTurnstileToken(token); setTurnstileError(''); setAuthError(''); }} onError={(message) => { setTurnstileToken(''); setTurnstileError(message); }} t={t} />}{turnstileError && <p className="auth-error">{turnstileError}</p>}{turnstileRequired && !turnstileSiteKey && <p className="auth-error">{t('turnstileMissing', { action: t(authMode === 'register' ? 'registerTab' : 'loginTab').toLowerCase() })}</p>}{authError && <p className="auth-error">{authError}</p>}<button className="button button-primary full-width" disabled={authLoading || (turnstileRequired && (!turnstileSiteKey || !turnstileToken))}>{authLoading ? authMode === 'register' ? t('processing') : t('loggingIn') : authMode === 'register' ? t('registerTrial') : t('loginContinue')} <Icon name="arrow" size={16} /></button></form><p className="auth-footnote">{t('authFootnote')}</p></div></div>}
    {showAdminPicker && <AdminConsolePicker onClose={() => setShowAdminPicker(false)} t={t} />}
    {toast && <div className="toast"><span className="toast-icon">✓</span>{toast}</div>}
  </div>;
}

createRoot(document.getElementById('root')).render(<StrictMode><App /></StrictMode>);
