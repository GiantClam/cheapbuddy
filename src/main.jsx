import { StrictMode, useEffect, useMemo, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import './styles.css';
import './paywall.css';
import { buildStripePaymentUrl, cancelPaymentOrder, clearSession, createApiKey, createPaymentOrder, getAffiliateDetail, getAuthToken, getCheckoutInfo, getMediaUsageDashboardModels, getProfile, getPublicSettings, getSavedUser, getUsageDashboardModels, getUsageDashboardStats, listAnnouncements, listApiKeys, listPaymentOrders, loginUser, registerUser, saveSession, transferAffiliateQuota, verifyAdminAccess } from './api';
import { buildAffiliateInviteLink, getAffiliateCodeFromSearch, normalizeAffiliateDetail } from './affiliate';
import { defaultPricingPlan, getCheckoutRechargePlans, pricingPlans } from './pricing';
import { formatLedgerAmount, formatPaymentAmount, formatPaymentOrderAmount, getPlanPaymentAmount, getRechargeLedgerAmount, isStripePaymentType, USD_TO_CNY_RATE } from './payment';
import { getInitialLanguage, languages, setStoredLanguage, translate } from './i18n';
import { buildInstallPrompt, createPlatformArtifact, platformOptions } from './platform-config';
import { localizedAnnouncementContent, localizedAnnouncementTitle } from './announcements';
import { mergeUsageModels } from './usage';

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
const siteOrigin = 'https://cheapbuddy.cc';

function updateSeoMetadata({ title, description, path, type = 'website' }) {
  document.title = title;
  const canonicalUrl = `${siteOrigin}${path}`;
  const definitions = [
    ['name', 'description', description],
    ['property', 'og:type', type],
    ['property', 'og:title', title],
    ['property', 'og:description', description],
    ['property', 'og:url', canonicalUrl],
    ['name', 'twitter:title', title],
    ['name', 'twitter:description', description],
  ];

  definitions.forEach(([attribute, key, value]) => {
    const selector = `meta[${attribute}="${key}"]`;
    const meta = document.querySelector(selector);
    if (meta) meta.setAttribute('content', value);
  });

  const canonical = document.querySelector('link[rel="canonical"]');
  if (canonical) canonical.setAttribute('href', canonicalUrl);
}

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
    eye: <><path d="M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7S2 12 2 12Z" /><circle cx="12" cy="12" r="3" /></>,
    eyeOff: <><path d="m3 3 18 18" /><path d="M10.6 10.6a2 2 0 0 0 2.8 2.8" /><path d="M9.9 5.2A10.8 10.8 0 0 1 12 5c6.4 0 10 7 10 7a16 16 0 0 1-3.1 3.9" /><path d="M6.6 6.6C3.7 8.2 2 12 2 12s3.6 7 10 7c1 0 1.9-.2 2.7-.5" /></>,
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
      {loading ? <div className="account-loading"><span /><span /><span /></div> : announcements.length ? <div className="announcement-list">{announcements.map((item, index) => <article className="announcement-item" key={announcementId(item, index)}><div className="announcement-item-head"><h3>{localizedAnnouncementTitle(item, language) || t('announcementUntitled')}</h3><time>{formatAnnouncementDate(item.created_at || item.published_at || item.start_time, language)}</time></div><p>{localizedAnnouncementContent(item, language) || item.content_md || item.body || ''}</p></article>)}</div> : <div className="account-empty">{t('noAnnouncements')}</div>}
    </div>
  </div>;
}

function Logo({ t = (key) => translate('zh', key), homeHref = '#top' }) {
  return <a className="logo" href={homeHref} aria-label={t('homeAria')}><span className="logo-mark"><span /><span /><span /></span><span>cheap<span className="logo-accent">buddy</span><small>.cc</small></span></a>;
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

function RechargePlanCards({ plans, selectedPlanId, paymentLoading, onRecharge, language, t, checkoutLoading, checkoutError }) {
  if (checkoutLoading) return <p className="pricing-plan-note" role="status">{language === 'en' ? 'Loading recharge offers…' : '正在加载充值商品…'}</p>;
  if (checkoutError) return <p className="pricing-plan-note" role="status">{language === 'en' ? 'Unable to load recharge offers. Please refresh and try again.' : '充值商品读取失败，请刷新后重试。'}</p>;
  if (!plans.length) return <p className="pricing-plan-note">{language === 'en' ? 'No recharge offers are currently available.' : '当前暂无可用的充值商品。'}</p>;
  return <div className="pricing-plan-grid">{plans.map((plan) => {
    const currency = plan.paymentCurrency || (language === 'en' ? 'USD' : 'CNY');
    const paymentAmount = plan.payAmount ?? getPlanPaymentAmount(plan.amount, language);
    const creditedBalance = formatLedgerAmount(getRechargeLedgerAmount(plan), 8);
    return <article className={plan.featured ? 'pricing-plan-card featured' : 'pricing-plan-card'} key={plan.id}>
      <div className="pricing-plan-top"><span>{plan.name}</span><small>{plan.tag}</small></div>
      <div className="pricing-plan-price"><strong>{formatPaymentAmount(paymentAmount, currency)}</strong></div>
      <div className="pricing-plan-balance"><b>{creditedBalance}</b><span>{t(plan.creditedBalance === undefined ? 'referenceBalance' : 'sharedBalance')}</span></div>
      <p className="pricing-plan-note">{t('pricingPlanNote')}</p><p>{plan.description}</p>
      <button className={plan.featured ? 'button button-primary full-width' : 'button button-ghost full-width'} onClick={() => onRecharge(plan)} disabled={paymentLoading}>
        {paymentLoading && selectedPlanId === plan.id ? t('creatingOrder') : t(currency === 'USD' ? 'rechargeUsdAmount' : 'rechargeAmount', { amount: formatAmount(paymentAmount) })} <Icon name="arrow" size={15} />
      </button>
    </article>;
  })}</div>;
}

function PaywallPanel({ plans, selectedPlanId, paymentLoading, onRecharge, onClose, language, t, checkoutLoading, checkoutError }) {
  return <div className="modal-backdrop" role="presentation" onClick={onClose}>
    <div className="account-modal paywall-modal" role="dialog" aria-modal="true" aria-labelledby="paywall-title" onClick={(event) => event.stopPropagation()}>
      <div className="modal-header"><div><span className="modal-kicker">CHEAPBUDDY PAYWALL</span><h2 id="paywall-title">{t('paywallTitle')}</h2></div><button className="modal-close" onClick={onClose} aria-label={t('close')}>×</button></div>
      <p className="paywall-intro">{paymentLoading ? t('creatingOrder') : t('paywallLead')}</p>
      <RechargePlanCards {...{ plans, selectedPlanId, paymentLoading, onRecharge, language, t, checkoutLoading, checkoutError }} />
      <p className="pricing-footnote"><span className="pricing-footnote-dot" />{t('paywallFootnote')}</p>
    </div>
  </div>;
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
      <div className="account-balance"><div><span>{t('currentBalance')}</span><strong>{formatLedgerAmount(balance || 0)}</strong><small>{t('sharedBalance')}</small></div><div className="account-actions"><button className="button button-primary" onClick={onRecharge}>{t('recharge')}</button><button className="button button-ghost" onClick={onOrders}>{t('paymentOrders')}</button><button className="button button-ghost" onClick={onConfig}>{t('generate')}</button><button className="button button-ghost" onClick={onAffiliate}>{t('affiliate')}</button></div></div>
      <div className="account-stats"><div><span>{t('totalRequests')}</span><strong>{formatCompactNumber(stats.total_requests)}</strong></div><div><span>{t('totalTokens')}</span><strong>{formatCompactNumber(stats.total_tokens)}</strong></div><div><span>{t('todayCost')}</span><strong>{formatLedgerAmount(stats.today_actual_cost || 0, 4)}</strong></div></div>
      <div className="account-usage-head"><div><span className="modal-kicker">USAGE</span><h3>{t('recentUsage')}</h3></div><button className="text-button" onClick={onRefresh} disabled={usageLoading}>{usageLoading ? t('syncing') : t('refreshData')}</button></div>
      {usageError && <p className="account-error">{usageError}</p>}
      {usageLoading ? <div className="account-loading"><span /><span /><span /></div> : usageModels.length ? <div className="account-usage-list">{usageModels.slice(0, 7).map((item) => { const model = models.find((entry) => entry.id === item.model); const requestCount = Number(item.total_requests ?? item.requests ?? 0); const mediaUsage = model?.modality === 'image' || model?.modality === 'video'; const usageValue = mediaUsage ? formatLedgerAmount(item.actual_cost || 0, 4) : formatCompactNumber(item.total_tokens); const usageLabel = mediaUsage ? t('mediaUsageCost') : 'tokens'; const maxRequests = Math.max(...usageModels.map((entry) => Number(entry.total_requests ?? entry.requests ?? 0)), 1); return <div className="account-usage-row" key={item.model}><span className="account-model-mark">{model?.mark || 'AI'}</span><div><b>{item.model || t('unknownModel')}</b><small>{t('requestCount', { count: formatCompactNumber(requestCount) })}</small></div><strong>{usageValue} <small>{usageLabel}</small></strong><i><em style={{ width: `${Math.min(100, Math.max(7, ((requestCount / maxRequests) * 100)))}%` }} /></i></div>; })}</div> : <div className="account-empty">{t('noUsage')}</div>}
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
        const paymentAmount = formatPaymentOrderAmount(order);
        const orderId = order.id ?? order.order_id ?? order.out_trade_no;
        return <article className="payment-order-row" key={orderId}>
          <div className="payment-order-main"><strong>{paymentAmount}</strong><span>{order.out_trade_no || `#${order.id ?? '—'}`}</span></div>
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
    ['affiliateAvailableBalance', formatLedgerAmount(detail?.availableQuota || 0)],
    ['affiliateTotalBalance', formatLedgerAmount(detail?.totalQuota || 0)],
  ];

  return <div className="modal-backdrop" role="presentation" onClick={onClose}>
    <div className="account-modal affiliate-modal" role="dialog" aria-modal="true" aria-labelledby="affiliate-title" onClick={(event) => event.stopPropagation()}>
      <div className="modal-header"><div><span className="modal-kicker">CHEAPBUDDY AFFILIATE</span><h2 id="affiliate-title">{t('affiliate')}</h2></div><button className="modal-close" onClick={onClose} aria-label={t('close')}>×</button></div>
      <div className="affiliate-toolbar"><p>{t('affiliateAccountData')}</p><button className="text-button" onClick={onRefresh} disabled={loading}>{loading ? t('syncing') : t('refreshData')}</button></div>
      {error && <p className="account-error">{error}</p>}
      {loading ? <div className="account-loading"><span /><span /><span /></div> : detail ? <>
        <div className="affiliate-stat-grid">{stats.map(([key, value]) => <div key={key}><span>{t(key)}</span><strong>{value}</strong></div>)}</div>
        {detail.frozenQuota > 0 && <p className="affiliate-frozen">{t('affiliateFrozenBalance', { amount: formatLedgerAmount(detail.frozenQuota) })}</p>}
        <section className="affiliate-share-card"><div><span className="modal-kicker">INVITE</span><h3>{t('affiliateInviteLink')}</h3></div><div className="affiliate-code-row"><code>{inviteLink || '—'}</code><button className="button button-ghost" type="button" disabled={!inviteLink} onClick={() => onCopyLink(inviteLink)}><Icon name="copy" size={15} /> {t('copy')}</button></div><div className="affiliate-code-meta"><span>{t('affiliateCode')}</span><code>{detail.affCode || '—'}</code><button className="text-button" type="button" disabled={!detail.affCode} onClick={() => onCopyCode(detail.affCode)}>{t('affiliateCopyCode')}</button></div></section>
        <section className="affiliate-transfer"><div><span className="modal-kicker">BALANCE</span><h3>{t('affiliateTransferTitle')}</h3><p>{t('affiliateTransferDescription')}</p></div><button className="button button-primary" type="button" disabled={transferring || detail.availableQuota <= 0} onClick={onTransfer}>{transferring ? t('processing') : t('affiliateTransfer')}</button></section>
        <section className="affiliate-invitees"><div className="account-usage-head"><div><span className="modal-kicker">RECORDS</span><h3>{t('affiliateInviteRecords')}</h3></div></div>{detail.invitees.length ? <div className="affiliate-table-wrap"><table><thead><tr><th>{t('affiliateInvitee')}</th><th>{t('affiliateJoinedAt')}</th><th>{t('affiliateRebate')}</th></tr></thead><tbody>{detail.invitees.map((invitee) => <tr key={`${invitee.userId}-${invitee.email}`}><td><b>{invitee.email || '—'}</b><small>{invitee.username || '—'}</small></td><td>{formatAffiliateDate(invitee.createdAt, language)}</td><td>{formatLedgerAmount(invitee.totalRebate)}</td></tr>)}</tbody></table></div> : <div className="account-empty">{t('affiliateNoInvitees')}</div>}</section>
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
  platformId, onPlatformChange, selectedModels, displayModels, selected, onToggleModel, onToggleAllModels,
  session, apiKeyLoading, onCopyApiKey, balance, onRecharge, paymentLoading, endpoint,
  testing, testState, testLatency, onTest, onCopyPrompt, onCopyConfig, onDownload,
  onCopyEndpoint, onClose, t,
}) {
  const [apiKeyVisible, setApiKeyVisible] = useState(false);
  useEffect(() => setApiKeyVisible(false), [session.apiKey]);
  const platform = platformOptions.find(({ id }) => id === platformId) || platformOptions[0];
  const allModelsSelected = displayModels.length > 0 && displayModels.every(({ id }) => selected.includes(id));
  const hasApiKey = Boolean(session.apiKey);
  const displayedApiKey = hasApiKey
    ? apiKeyVisible ? session.apiKey : `${session.apiKey.slice(0, 8)}••••${session.apiKey.slice(-4)}`
    : t('autoCreateKey');
  const previewArtifact = selectedModels.length ? createPlatformArtifact(platformId, {
    models: selectedModels,
    apiKey: session.apiKey || 'sk-cheapbuddy-••••••••',
    baseUrl: endpoint,
  }) : null;
  const preview = previewArtifact?.content || '';
  const selectedModelIds = selectedModels.map((model) => model.id).join(', ');
  const modelInstruction = platformId === 'claude'
    ? t('claudeModelInstruction', { model: selectedModels[0]?.id || '—', fastModel: selectedModels[1]?.id || selectedModels[0]?.id || '—' })
    : platformId === 'codex'
      ? t('codexModelInstruction', { model: selectedModels[0]?.id || '—' })
      : t('defaultModelInstruction', { model: selectedModels[0]?.id || '—' });

  return <div className="modal-backdrop" role="presentation" onClick={onClose}>
    <div className="generator-modal generator-modal-wide" role="dialog" aria-modal="true" aria-labelledby="generator-title" onClick={(event) => event.stopPropagation()}>
      <div className="modal-header"><div><span className="modal-kicker">CHEAPBUDDY CONFIG</span><h2 id="generator-title">{t('configCenter')}</h2></div><button className="modal-close" onClick={onClose} aria-label={t('close')}>×</button></div>
      <div className="modal-balance"><span>{t('currentBalance')}</span><strong>{balance === null ? t('loginToSync') : formatLedgerAmount(balance)}</strong><button onClick={onRecharge} disabled={paymentLoading}>{paymentLoading ? t('creatingOrder') : t('recharge')}</button></div>

      <div className="modal-field platform-field">
        <label>{t('choosePlatform')} <span>{platform.name}</span></label>
        <div className="platform-selector" role="tablist" aria-label={t('choosePlatform')}>
          {platformOptions.map((option) => <button className={option.id === platformId ? 'platform-option active' : 'platform-option'} key={option.id} type="button" role="tab" aria-selected={option.id === platformId} onClick={() => onPlatformChange(option.id)}><span>{option.mark}</span><div><b>{option.name}</b><small>{t(`platform_${option.id}`)}</small></div><i>{option.id === platformId ? <Icon name="check" size={14} /> : ''}</i></button>)}
        </div>
      </div>

      <div className="modal-field"><div className="model-selection-heading"><label>{t('chooseModels')} <span>{t('selectedModels', { selected: selectedModels.length, total: displayModels.length })}</span></label><button className="model-selection-toggle" type="button" onClick={onToggleAllModels} disabled={displayModels.length === 0}>{allModelsSelected ? t('clearModelSelection') : t('selectAllModels')}</button></div><p className="model-selection-hint">{t(`platformModelSelection_${platform.modelMode}`)}</p><div className="modal-models">{displayModels.map((model) => <button className={selected.includes(model.id) ? 'modal-model selected' : 'modal-model'} key={model.id} onClick={() => onToggleModel(model.id)}><ModelMark model={model} /><span><b>{model.id}</b><small>{model.description}</small><em className={`model-modality model-modality-${model.modality}`}>{model.modality === 'image' ? t('imageModel') : model.modality === 'video' ? t('videoModel') : t('textModel')}</em></span><span className="modal-check">{selected.includes(model.id) ? <Icon name="check" size={14} /> : ''}</span></button>)}</div></div>
      <div className="modal-field"><label>{t('userApiKey')} <span>{apiKeyLoading ? t('syncingKey') : t('managedByCheapBuddy')}</span></label><div className="key-field"><code>{displayedApiKey}</code><div className="key-field-actions"><button className="key-visibility-button" type="button" onClick={() => setApiKeyVisible((visible) => !visible)} disabled={!hasApiKey || apiKeyLoading} aria-label={t(apiKeyVisible ? 'hideApiKey' : 'showApiKey')} aria-pressed={apiKeyVisible} title={t(apiKeyVisible ? 'hideApiKey' : 'showApiKey')}><Icon name={apiKeyVisible ? 'eyeOff' : 'eye'} size={17} /></button><button type="button" onClick={onCopyApiKey} disabled={apiKeyLoading}><Icon name="copy" size={15} /> {t('copyApiKey')}</button></div></div></div>
      <div className="modal-field"><label>{t('endpoint')} <span>{t('openaiCompatible')}</span></label><div className="key-field"><code>{endpoint}</code><button onClick={onCopyEndpoint}><Icon name="copy" size={15} /> {t('copy')}</button></div></div>

      {previewArtifact && <div className="modal-field"><label>{t('generatedConfig')} <span>{previewArtifact.filename}</span></label><div className="config-preview"><div><span>{t('targetPath')}</span><code>{previewArtifact.configPath}</code></div><div className="config-model-summary"><span>{t('includedModels')}</span><code title={selectedModelIds}>{selectedModelIds}</code></div><pre>{preview}</pre>{previewArtifact.credentialEnvKey && <div className="config-model-summary"><span>{t('credentialEnvInstruction', { env: previewArtifact.credentialEnvKey })}</span><code>{previewArtifact.credentialEnvKey}={previewArtifact.apiKey}</code></div>}</div></div>}

      <div className="test-row"><button className="button button-ghost" onClick={onTest} disabled={testing}>{testing ? t('testing') : t('testConnection')} {testState === 'success' && <span className="success-mark">{t('latency', { latency: testLatency })}</span>}</button><span>{testState === 'success' ? t('connectionSuccess') : testState === 'error' ? t('connectionFailed') : t('testBeforeDownload')}</span></div>
      <div className="config-methods"><div className="config-methods-head"><span>{t('methodTitle')}</span><small>{t('readyForPlatform', { platform: platform.name })}</small></div><div className="config-method-grid"><div className="config-method featured"><div className="config-method-title"><span className="config-method-mark">01</span><div><b>{t('generatedActions')}</b><small>{previewArtifact?.filename || t('selectModelFirst')}</small></div></div><p>{t('platformConfigDescription', { platform: platform.name })}</p><div className="config-method-actions"><button className="button button-primary" onClick={onCopyPrompt} disabled={apiKeyLoading}><Icon name="copy" size={15} /> {t('copySetupPrompt')}</button><button className="button button-ghost" onClick={onCopyConfig} disabled={apiKeyLoading}><Icon name="copy" size={15} /> {t('copyConfig')}</button><button className="button button-blue" onClick={onDownload} disabled={apiKeyLoading}><Icon name="download" size={15} /> {t('downloadConfig')}</button></div></div></div><ol className="config-instructions"><li>{t('pathInstruction', { path: previewArtifact?.configPath || '—' })}</li><li>{t('backupInstruction')}</li><li>{modelInstruction}</li><li>{t('restartInstruction', { platform: platform.name })}</li><li>{previewArtifact?.credentialEnvKey ? t('credentialEnvInstruction', { env: previewArtifact.credentialEnvKey }) : t('configSecurityInstruction')}</li></ol></div>
    </div>
  </div>;
}

const USD_CNY_REFERENCE_RATE = USD_TO_CNY_RATE;

function PricingComparison({ plan, language, t }) {
  if (!plan || plan.paymentCurrency) return null;
  const usdValue = getPlanPaymentAmount(plan.amount, 'en');
  const displayAmount = language === 'en' ? usdValue : plan.amount;
  const displayCurrency = language === 'en' ? '$' : '¥';
  const workBuddyCredits = Math.round(plan.amount / 100 * 2000);
  const gpt6SolInputTokens = Math.round(usdValue / 2 * 1000000);
  const gpt6SolOutputTokens = Math.round(usdValue / 10 * 1000000);
  const claudeMonthlyPercent = Math.round(usdValue / 20 * 1000) / 10;
  const openCodeMonthlyPercent = Math.round(usdValue / 10 * 1000) / 10;

  return <section className="pricing-comparison" aria-labelledby="pricing-comparison-title">
    <div className="pricing-comparison-heading">
      <div><span className="section-index">REFERENCE</span><h3 id="pricing-comparison-title">{t('pricingComparisonTitle', { amount: formatAmount(displayAmount), currency: displayCurrency })}</h3></div>
      <p>{t('pricingComparisonLead', { amount: formatAmount(displayAmount), cny: formatAmount(plan.amount), usd: usdValue.toFixed(2), rate: USD_CNY_REFERENCE_RATE.toFixed(2) })}</p>
    </div>
    <div className="pricing-comparison-grid">
      <article className="pricing-comparison-card featured">
        <div className="pricing-comparison-label">WorkBuddy</div>
        <strong>≈ {workBuddyCredits.toLocaleString()} Credits</strong>
        <p>{t('pricingComparisonWorkbuddy', { amount: formatAmount(displayAmount), cny: formatAmount(plan.amount), usd: usdValue.toFixed(2), credits: workBuddyCredits.toLocaleString() })}</p>
        <a href="https://cloud.tencent.com/document/product/1831/134333" target="_blank" rel="noopener noreferrer">{t('officialPricingSource')} ↗</a>
      </article>
      <article className="pricing-comparison-card">
        <div className="pricing-comparison-label">Codex · GPT-6 Sol API</div>
        <strong>≈ {gpt6SolInputTokens.toLocaleString()} / {gpt6SolOutputTokens.toLocaleString()}</strong>
        <p>{t('pricingComparisonCodex', { amount: formatAmount(displayAmount), cny: formatAmount(plan.amount), usd: usdValue.toFixed(2), inputTokens: gpt6SolInputTokens.toLocaleString(), outputTokens: gpt6SolOutputTokens.toLocaleString() })}</p>
        <a href="https://developers.openai.com/api/docs/pricing" target="_blank" rel="noopener noreferrer">{t('apiPricingSource')} ↗</a>
      </article>
      <article className="pricing-comparison-card">
        <div className="pricing-comparison-label">Claude Code</div>
        <strong>{claudeMonthlyPercent}% {t('ofProMonth')}</strong>
        <p>{t('pricingComparisonClaude', { amount: formatAmount(displayAmount), cny: formatAmount(plan.amount), usd: usdValue.toFixed(2), percent: claudeMonthlyPercent })}</p>
        <a href="https://claude.com/pricing" target="_blank" rel="noopener noreferrer">{t('officialPricingSource')} ↗</a>
      </article>
      <article className="pricing-comparison-card">
        <div className="pricing-comparison-label">OpenCode Go</div>
        <strong>{openCodeMonthlyPercent}% {t('ofGoMonth')}</strong>
        <p>{t('pricingComparisonOpenCode', { amount: formatAmount(displayAmount), cny: formatAmount(plan.amount), usd: usdValue.toFixed(2), low: (15 * openCodeMonthlyPercent / 100).toFixed(2), high: (60 * openCodeMonthlyPercent / 100).toFixed(2) })}</p>
        <a href="https://dev.opencode.ai/docs/go/" target="_blank" rel="noopener noreferrer">{t('officialPricingSource')} ↗</a>
      </article>
    </div>
    <p className="pricing-comparison-note">{t('pricingComparisonNote', { rate: USD_CNY_REFERENCE_RATE })} <a href="https://www.imf.org/external/np/fin/ert/GUI/Pages/Report.aspx" target="_blank" rel="noopener noreferrer">{t('exchangeRateSource')} ↗</a></p>
  </section>;
}

function ApiCodeBlock({ label, code, codeId, copied, onCopy, t }) {
  return <div className="api-code-block">
    <div className="api-code-toolbar"><span>{label}</span><button type="button" onClick={() => onCopy(codeId, code)}><Icon name="copy" size={14} /> {copied === codeId ? t('apiDocsCopied') : t('apiDocsCopy')}</button></div>
    <pre><code>{code}</code></pre>
  </div>;
}

function ApiDocsPage() {
  const [language, setLanguage] = useState(getInitialLanguage);
  const [copied, setCopied] = useState('');
  const t = (key, variables) => translate(language, key, variables);

  useEffect(() => {
    setStoredLanguage(language);
    updateSeoMetadata({
      title: language === 'en' ? 'CheapBuddy OpenAI-compatible image and video API docs' : 'CheapBuddy OpenAI 兼容图片与视频 API 文档',
      description: language === 'en' ? 'CheapBuddy OpenAI-compatible image and video API reference with authentication, async task polling, and download examples.' : 'CheapBuddy OpenAI 兼容图片与视频 API 文档，包含认证、请求参数、异步任务查询和结果下载示例。',
      path: '/api-docs',
      type: 'article',
    });
  }, [language]);

  const videoRequest = [
    'curl -X POST ' + baseUrl + '/videos \\',
    '  -H "Authorization: Bearer $CHEAPBUDDY_API_KEY" \\',
    '  -H "Idempotency-Key: $IDEMPOTENCY_KEY" \\',
    '  -F "model=MiniMax-H3" \\',
    '  -F "prompt=A paper boat floats on a blue pond." \\',
    '  -F "seconds=8" \\',
    '  -F "ratio=16:9" \\',
    '  -F "resolution=768P"',
  ].join('\n');
  const videoImageRequest = [
    'curl -X POST ' + baseUrl + '/videos \\',
    '  -H "Authorization: Bearer $CHEAPBUDDY_API_KEY" \\',
    '  -H "Content-Type: application/json" \\',
    "  -d '{\"model\":\"MiniMax-H3\",\"prompt\":\"Create a smooth transition between these frames.\",\"first_frame\":\"https://example.com/start.png\",\"last_frame\":\"https://example.com/end.png\",\"seconds\":8,\"ratio\":\"adaptive\",\"resolution\":\"768P\"}'",
  ].join('\n');
  const videoReferenceRequest = [
    'curl -X POST ' + baseUrl + '/videos \\',
    '  -H "Authorization: Bearer $CHEAPBUDDY_API_KEY" \\',
    '  -H "Idempotency-Key: $IDEMPOTENCY_KEY" \\',
    '  -F "model=MiniMax-H3" \\',
    '  -F "prompt=Use the reference motion to create a cinematic dawn scene" \\',
    '  -F "seconds=8" \\',
    '  -F "ratio=adaptive" \\',
    '  -F "resolution=768P" \\',
    '  -F "reference_video=@reference.mp4"',
  ].join('\n');
  const videoPoll = 'curl ' + baseUrl + '/videos/{id} \\\n  -H "Authorization: Bearer $CHEAPBUDDY_API_KEY"';
  const videoDownload = 'curl ' + baseUrl + '/videos/{id}/content \\\n  -H "Authorization: Bearer $CHEAPBUDDY_API_KEY" \\\n  -o output.mp4';
  const imageRequest = [
    'curl ' + baseUrl + '/images/generations \\',
    '  -H "Authorization: Bearer $CHEAPBUDDY_API_KEY" \\',
    '  -H "Content-Type: application/json" \\',
    "  -d '{\"model\":\"gpt-image-2.5\",\"prompt\":\"a cinematic city at night\",\"size\":\"1024x1024\",\"n\":1}'",
  ].join('\n');
  const pricingRequest = [
    'curl -G ' + baseUrl + '/pricing \\',
    '  --data-urlencode "model=MiniMax-H3" \\',
    '  -H "Authorization: Bearer $CHEAPBUDDY_API_KEY"',
  ].join('\n');
  const pricingResponse = JSON.stringify({
    object: 'cheapbuddy.pricing',
    model: 'MiniMax-H3',
    data: { model_name: 'MiniMax-H3', note: 'current NewAPI rate-card fields and original units' },
    group_ratio: { default: '<current ratio>' },
    cheapbuddy: { billing_mode: 'paid', media_multiplier: '<current multiplier>', quota_per_usd: '<current conversion>', settlement: 'actual successful usage' },
  }, null, 2);

  const queuedResponse = JSON.stringify({ id: 'task_redacted_01', object: 'video', model: 'MiniMax-H3', status: 'queued', progress: 0, created_at: 1760000000 }, null, 2);
  const completedResponse = JSON.stringify({ id: 'task_redacted_01', object: 'video', model: 'MiniMax-H3', status: 'completed', progress: 100, created_at: 1760000000, completed_at: 1760000068 }, null, 2);
  const failedResponse = JSON.stringify({ id: 'task_redacted_02', object: 'video', model: 'MiniMax-H3', status: 'failed', progress: 0, created_at: 1760000100, error: { code: 'video_generation_failed', message: 'video generation failed' } }, null, 2);

  const copyCode = async (codeId, value) => {
    try {
      await writeClipboard(value);
      setCopied(codeId);
      window.setTimeout(() => setCopied((current) => current === codeId ? '' : current), 1800);
    } catch {
      setCopied('');
    }
  };

  return <div className="api-docs-shell">
    <header className="site-header api-docs-header">
      <div className="site-header-inner section-wrap">
        <Logo t={t} homeHref="/" />
        <div className="api-docs-top-actions"><a className="api-home-link" href="/">{t('apiDocsBackHome')} <Icon name="arrow" size={15} /></a><a className="api-home-link" href="/comfyui">{t('navComfyUI')} <Icon name="arrow" size={15} /></a><LanguageToggle language={language} onChange={setLanguage} /></div>
      </div>
    </header>

    <main>
      <section className="api-docs-hero section-wrap">
        <div className="api-docs-hero-copy"><span className="section-index">API / 01</span><h1>{t('apiDocsTitle')}<br /><em>{t('apiDocsTitleAccent')}</em></h1><p>{t('apiDocsLead')}</p><div className="api-docs-hero-tags"><span>OPENAI COMPATIBLE</span><span>ASYNC VIDEO</span><span>JSON + MULTIPART</span></div></div>
        <div className="api-docs-route-board"><div className="api-route-board-head"><span className="live-line" /> <span>{t('apiDocsRouteMap')}</span><span>v1</span></div><div className="api-route-line"><b>POST</b><code>/v1/videos</code><span>{t('apiDocsRouteCreate')}</span></div><div className="api-route-line"><b>GET</b><code>/v1/videos/{'{id}'}</code><span>{t('apiDocsRoutePoll')}</span></div><div className="api-route-line"><b>GET</b><code>/v1/videos/{'{id}'}/content</code><span>{t('apiDocsRouteDownload')}</span></div></div>
      </section>

      <div className="api-docs-layout section-wrap">
        <aside className="api-docs-sidebar"><span>{t('apiDocsOnThisPage')}</span><a href="#api-auth">{t('apiDocsAuthTitle')}</a><a href="#api-create">{t('apiDocsCreateTitle')}</a><a href="#api-poll">{t('apiDocsPollTitle')}</a><a href="#api-download">{t('apiDocsDownloadTitle')}</a><a href="#api-image">{t('apiDocsImagesTitle')}</a><a href="#api-pricing">{t('apiDocsPricingTitle')}</a></aside>
        <article className="api-docs-content">
          <section id="api-auth" className="api-doc-section api-auth-section"><div className="api-doc-section-heading"><span className="api-doc-number">01</span><div><h2>{t('apiDocsAuthTitle')}</h2><p>{t('apiDocsAuthText')}</p></div></div><div className="api-auth-card"><div><Icon name="shield" size={20} /><strong>Authorization: Bearer $CHEAPBUDDY_API_KEY</strong></div><p>{t('apiDocsAuthNote')}</p></div></section>

          <section id="api-create" className="api-doc-section"><div className="api-doc-section-heading"><span className="api-doc-number">02</span><div><div className="api-method-badge post">POST</div><h2>{t('apiDocsCreateTitle')}</h2><p>{t('apiDocsCreateText')}</p></div></div><div className="api-endpoint"><span>POST</span><code>/v1/videos</code><small>JSON or multipart/form-data</small></div><ApiCodeBlock label="Text-to-video · multipart" code={videoRequest} codeId="video-request" copied={copied} onCopy={copyCode} t={t} /><div className="api-field-grid"><div className="api-field-card"><code>model</code><strong>MiniMax-H3</strong><p>{t('apiDocsFieldModel')}</p></div><div className="api-field-card"><code>prompt</code><strong>string</strong><p>{t('apiDocsFieldPrompt')}</p></div><div className="api-field-card"><code>seconds / duration</code><strong>4–15 integer</strong><p>{t('apiDocsFieldSeconds')}</p></div><div className="api-field-card"><code>ratio</code><strong>16:9 / adaptive</strong><p>{t('apiDocsFieldRatio')}</p></div><div className="api-field-card"><code>resolution / size</code><strong>768P</strong><p>{t('apiDocsFieldResolution')}</p></div></div><div className="api-callout"><strong>{t('apiDocsImportant')}</strong><p>{t('apiDocsCreateNote')}</p></div><div className="api-video-modes"><div className="api-video-modes-heading"><h3>{t('apiDocsModesTitle')}</h3><p>{t('apiDocsModesText')}</p></div><article className="api-video-mode-card"><div><span className="api-video-mode-label">01</span><h4>{t('apiDocsModeTextTitle')}</h4><p>{t('apiDocsModeTextText')}</p></div><ApiCodeBlock label="multipart/form-data" code={videoRequest} codeId="video-mode-text" copied={copied} onCopy={copyCode} t={t} /></article><article className="api-video-mode-card"><div><span className="api-video-mode-label">02</span><h4>{t('apiDocsModeImageTitle')}</h4><p>{t('apiDocsModeImageText')}</p></div><ApiCodeBlock label="application/json" code={videoImageRequest} codeId="video-mode-image" copied={copied} onCopy={copyCode} t={t} /></article><article className="api-video-mode-card"><div><span className="api-video-mode-label">03</span><h4>{t('apiDocsModeReferenceTitle')}</h4><p>{t('apiDocsModeReferenceText')}</p></div><ApiCodeBlock label="multipart/form-data" code={videoReferenceRequest} codeId="video-mode-reference" copied={copied} onCopy={copyCode} t={t} /></article></div></section>

          <section id="api-poll" className="api-doc-section"><div className="api-doc-section-heading"><span className="api-doc-number">03</span><div><div className="api-method-badge get">GET</div><h2>{t('apiDocsPollTitle')}</h2><p>{t('apiDocsPollText')}</p></div></div><div className="api-endpoint"><span>GET</span><code>/v1/videos/{'{id}'}</code><small>application/json</small></div><ApiCodeBlock label="cURL" code={videoPoll} codeId="video-poll" copied={copied} onCopy={copyCode} t={t} /><div className="api-response-grid"><article className="api-response-card"><div className="api-response-label"><span className="api-status-dot queued" /> {t('apiDocsQueued')}</div><pre>{queuedResponse}</pre></article><article className="api-response-card success"><div className="api-response-label"><span className="api-status-dot completed" /> {t('apiDocsCompleted')}</div><pre>{completedResponse}</pre></article><article className="api-response-card failure"><div className="api-response-label"><span className="api-status-dot failed" /> {t('apiDocsFailed')}</div><pre>{failedResponse}</pre></article></div><div className="api-callout"><strong>{t('apiDocsResponseImportant')}</strong><p>{t('apiDocsResponseNote')}</p></div></section>

          <section id="api-download" className="api-doc-section"><div className="api-doc-section-heading"><span className="api-doc-number">04</span><div><div className="api-method-badge get">GET</div><h2>{t('apiDocsDownloadTitle')}</h2><p>{t('apiDocsDownloadText')}</p></div></div><div className="api-endpoint"><span>GET</span><code>/v1/videos/{'{id}'}/content</code><small>video/mp4</small></div><ApiCodeBlock label="cURL" code={videoDownload} codeId="video-download" copied={copied} onCopy={copyCode} t={t} /><div className="api-download-note"><Icon name="download" size={19} /><p>{t('apiDocsDownloadNote')}</p></div></section>

          <section id="api-image" className="api-doc-section api-image-section"><div className="api-doc-section-heading"><span className="api-doc-number">05</span><div><h2>{t('apiDocsImagesTitle')}</h2><p>{t('apiDocsImagesText')}</p></div></div><div className="api-endpoint"><span>POST</span><code>/v1/images/generations</code><small>application/json</small></div><ApiCodeBlock label="cURL" code={imageRequest} codeId="image-request" copied={copied} onCopy={copyCode} t={t} /><div className="api-image-note"><strong>{t('apiDocsImageNoteTitle')}</strong><p>{t('apiDocsImageNote')}</p></div></section>

          <section id="api-pricing" className="api-doc-section"><div className="api-doc-section-heading"><span className="api-doc-number">06</span><div><div className="api-method-badge get">GET</div><h2>{t('apiDocsPricingTitle')}</h2><p>{t('apiDocsPricingText')}</p></div></div><div className="api-endpoint"><span>GET</span><code>/v1/pricing?model={'{model}'}</code><small>application/json · read-only</small></div><ApiCodeBlock label="cURL" code={pricingRequest} codeId="pricing-request" copied={copied} onCopy={copyCode} t={t} /><div className="api-response-grid"><article className="api-response-card"><div className="api-response-label">{t('apiDocsPricingTitle')}</div><pre>{pricingResponse}</pre></article></div><div className="api-callout"><strong>{t('apiDocsImportant')}</strong><p>{t('apiDocsPricingNote')}</p></div></section>
        </article>
      </div>
    </main>
    <footer className="footer api-docs-footer section-wrap"><Logo t={t} homeHref="/" /><div className="footer-note">{t('footerNote')}<br /><span>{t('poweredBy')}</span></div><p>{t('apiDocsSideNote')}</p></footer>
  </div>;
}

function ComfyUIDocsPage() {
  const [language, setLanguage] = useState(getInitialLanguage);
  const t = (key, variables) => translate(language, key, variables);
  const installSteps = [
    ['01', 'comfyStepDownloadTitle', 'comfyStepDownloadText'],
    ['02', 'comfyStepInstallTitle', 'comfyStepInstallText'],
    ['03', 'comfyStepRestartTitle', 'comfyStepRestartText'],
    ['04', 'comfyStepConfigureTitle', 'comfyStepConfigureText'],
  ];
  const nodeCards = [
    ['TXT', 'comfyTextNodeTitle', 'comfyTextNodeText', 'prompt → text / optional image input'],
    ['IMG', 'comfyImageNodeTitle', 'comfyImageNodeText', 'prompt + images → IMAGE'],
    ['VID', 'comfyVideoNodeTitle', 'comfyVideoNodeText', 'prompt + media → VIDEO'],
  ];
  const scenarios = [
    ['comfyScenarioTextImage', 'comfyScenarioTextImageDetail'],
    ['comfyScenarioImageImage', 'comfyScenarioImageImageDetail'],
    ['comfyScenarioMultiImage', 'comfyScenarioMultiImageDetail'],
    ['comfyScenarioTextVideo', 'comfyScenarioTextVideoDetail'],
    ['comfyScenarioImageVideo', 'comfyScenarioImageVideoDetail'],
    ['comfyScenarioFramesVideo', 'comfyScenarioFramesVideoDetail'],
    ['comfyScenarioReferenceVideo', 'comfyScenarioReferenceVideoDetail'],
  ];

  useEffect(() => {
    setStoredLanguage(language);
    updateSeoMetadata({
      title: language === 'en' ? 'CheapBuddy ComfyUI nodes | Use cheapbuddy.cc in ComfyUI' : 'CheapBuddy ComfyUI 节点｜在 ComfyUI 中使用 cheapbuddy.cc',
      description: language === 'en' ? 'Install the CheapBuddy ComfyUI nodes and use text, image, and video models from cheapbuddy.cc in one workflow.' : '安装 CheapBuddy ComfyUI 节点，在同一工作流中使用 cheapbuddy.cc 的文本、图片和视频模型。',
      path: '/comfyui',
      type: 'article',
    });
  }, [language]);

  return <div className="api-docs-shell comfy-docs-shell">
    <header className="site-header api-docs-header">
      <div className="site-header-inner section-wrap">
        <Logo t={t} homeHref="/" />
        <div className="api-docs-top-actions"><a className="api-home-link" href="/">{t('apiDocsBackHome')} <Icon name="arrow" size={15} /></a><a className="api-home-link" href="/api-docs">{t('navMediaDocs')} <Icon name="arrow" size={15} /></a><LanguageToggle language={language} onChange={setLanguage} /></div>
      </div>
    </header>
    <main>
      <section className="api-docs-hero section-wrap comfy-docs-hero">
        <div className="api-docs-hero-copy"><span className="section-index">COMFYUI / 01</span><h1>{t('comfyTitle')}<br /><em>{t('comfyTitleAccent')}</em></h1><p>{t('comfyLead')}</p><div className="api-docs-hero-tags"><span>TEXT + IMAGE + VIDEO</span><span>DYNAMIC MODELS</span><span>COMFYUI WORKFLOWS</span></div><div className="comfy-hero-actions"><a className="button button-primary" href="/downloads/ComfyUI-CheapBuddy-0.1.0.zip" download>{t('comfyDownloadZip')} <Icon name="download" size={15} /></a><a className="button button-ghost" href="#comfy-install">{t('comfyStartInstall')} <Icon name="arrow" size={15} /></a></div></div>
        <div className="comfy-hero-board"><div className="api-route-board-head"><span className="live-line" /> <span>{t('comfyBoardTitle')}</span><span>0.1.0</span></div><div className="comfy-flow-row"><span>01</span><b>{t('comfyFlowPrompt')}</b><code>CheapBuddy Text</code></div><div className="comfy-flow-row"><span>02</span><b>{t('comfyFlowImage')}</b><code>CheapBuddy Image</code></div><div className="comfy-flow-row"><span>03</span><b>{t('comfyFlowVideo')}</b><code>CheapBuddy Video</code></div><div className="comfy-board-foot">{t('comfyBoardFoot')}</div></div>
      </section>

      <div className="comfy-docs-layout section-wrap">
        <aside className="api-docs-sidebar"><span>{t('comfyOnThisPage')}</span><a href="#comfy-install">{t('comfyInstallTitle')}</a><a href="#comfy-nodes">{t('comfyNodesTitle')}</a><a href="#comfy-scenarios">{t('comfyScenariosTitle')}</a><a href="#comfy-publish">{t('comfyPublishTitle')}</a><a href="#comfy-security">{t('comfySecurityTitle')}</a></aside>
        <article className="api-docs-content">
          <section id="comfy-install" className="api-doc-section"><div className="api-doc-section-heading"><span className="api-doc-number">01</span><div><h2>{t('comfyInstallTitle')}</h2><p>{t('comfyInstallLead')}</p></div></div><div className="comfy-install-grid">{installSteps.map(([number, titleKey, textKey]) => <article className="comfy-step-card" key={number}><span>{number}</span><div><h3>{t(titleKey)}</h3><p>{t(textKey)}</p></div></article>)}</div><div className="comfy-command-card"><div className="api-code-toolbar"><span>{t('comfyInstallPathLabel')}</span><code>ComfyUI/custom_nodes/ComfyUI-CheapBuddy</code></div><pre><code>{`# unzip the release into ComfyUI/custom_nodes\n# restart ComfyUI completely\n# search for CheapBuddy in the node menu`}</code></pre></div></section>

          <section id="comfy-nodes" className="api-doc-section"><div className="api-doc-section-heading"><span className="api-doc-number">02</span><div><h2>{t('comfyNodesTitle')}</h2><p>{t('comfyNodesLead')}</p></div></div><div className="comfy-node-grid">{nodeCards.map(([mark, titleKey, textKey, io]) => <article className="comfy-node-card" key={titleKey}><span className="comfy-node-mark">{mark}</span><div><h3>{t(titleKey)}</h3><p>{t(textKey)}</p><code>{io}</code></div></article>)}</div><div className="api-callout comfy-callout"><strong>{t('comfyModelCalloutTitle')}</strong><p>{t('comfyModelCalloutText')}</p></div></section>

          <section id="comfy-scenarios" className="api-doc-section"><div className="api-doc-section-heading"><span className="api-doc-number">03</span><div><h2>{t('comfyScenariosTitle')}</h2><p>{t('comfyScenariosLead')}</p></div></div><div className="comfy-scenario-table"><div className="comfy-scenario-head"><span>{t('comfyScenarioColumn')}</span><span>{t('comfyInputColumn')}</span><span>{t('comfyOutputColumn')}</span></div>{scenarios.map(([titleKey, detailKey]) => <div className="comfy-scenario-row" key={titleKey}><strong>{t(titleKey)}</strong><p>{t(detailKey)}</p><span>{titleKey === 'comfyScenarioTextVideo' || titleKey === 'comfyScenarioImageVideo' || titleKey === 'comfyScenarioFramesVideo' || titleKey === 'comfyScenarioReferenceVideo' ? 'VIDEO' : 'IMAGE'}</span></div>)}</div></section>

          <section id="comfy-publish" className="api-doc-section"><div className="api-doc-section-heading"><span className="api-doc-number">04</span><div><h2>{t('comfyPublishTitle')}</h2><p>{t('comfyPublishLead')}</p></div></div><div className="comfy-publish-grid"><article className="comfy-publish-card featured"><span className="comfy-publish-badge">01 / {t('comfyPublishRecommended')}</span><h3>{t('comfyPublishGithubTitle')}</h3><p>{t('comfyPublishGithubText')}</p><a href="/downloads/ComfyUI-CheapBuddy-0.1.0.zip" download>{t('comfyDownloadZip')} <Icon name="download" size={14} /></a></article><article className="comfy-publish-card"><span className="comfy-publish-badge">02 / {t('comfyPublishDiscovery')}</span><h3>{t('comfyPublishManagerTitle')}</h3><p>{t('comfyPublishManagerText')}</p><a href="https://github.com/ltdrdata/ComfyUI-Manager" target="_blank" rel="noopener noreferrer">{t('comfyManagerDocs')} <Icon name="arrow" size={14} /></a></article><article className="comfy-publish-card"><span className="comfy-publish-badge">03 / {t('comfyPublishMirror')}</span><h3>{t('comfyPublishPlatformTitle')}</h3><p>{t('comfyPublishPlatformText')}</p><span className="comfy-publish-muted">RunningHub · Comfy.icu</span></article></div><div className="comfy-publish-note"><strong>{t('comfyPublishDecision')}</strong><p>{t('comfyPublishDecisionText')}</p></div></section>

          <section id="comfy-security" className="api-doc-section"><div className="api-doc-section-heading"><span className="api-doc-number">05</span><div><h2>{t('comfySecurityTitle')}</h2><p>{t('comfySecurityLead')}</p></div></div><div className="api-auth-card comfy-security-card"><div><Icon name="shield" size={20} /><strong>{t('comfySecurityKeyTitle')}</strong></div><p>{t('comfySecurityKeyText')}</p></div><div className="comfy-security-list"><span>{t('comfySecurityItemOne')}</span><span>{t('comfySecurityItemTwo')}</span><span>{t('comfySecurityItemThree')}</span></div></section>
        </article>
      </div>
    </main>
    <footer className="footer api-docs-footer section-wrap"><Logo t={t} homeHref="/" /><div className="footer-note">{t('footerNote')}<br /><span>{t('poweredBy')}</span></div><p>{t('comfyFooterNote')}</p></footer>
  </div>;
}

function HypitDocsPage() {
  const [language, setLanguage] = useState(getInitialLanguage);
  const [copied, setCopied] = useState('');
  const t = (key, variables) => translate(language, key, variables);

  useEffect(() => {
    setStoredLanguage(language);
    updateSeoMetadata({
      title: language === 'en' ? 'CheapBuddy Hypit provider | Install and use MiniMax-H3' : 'CheapBuddy Hypit Provider｜安装并使用 MiniMax-H3',
      description: language === 'en' ? 'Install the published @cheapbuddy/provider package in Hypit, configure credentials, and build MiniMax-H3 videos at 768P.' : '在 Hypit 中安装 npm 已发布的 @cheapbuddy/provider，配置凭证，并生成 768P MiniMax-H3 视频。',
      path: '/hypit',
      type: 'article',
    });
  }, [language]);

  const installCommand = `# In your Hypit project (Node.js >= 22.15.0)
# If package.json does not exist yet: npm init -y
npm install @hypit/hypit@latest @cheapbuddy/provider@latest`;
  const runtimeConfig = `{
  "format": "hypit.runtime-local@1",
  "dataRoot": ".hypit/execution",
  "credentials": {
    "platform": { "use": "@hypit/credential-store-platform" }
  },
  "endpoints": {
    "cheapbuddy.media": {
      "use": "@cheapbuddy/provider",
      "pool": "cheapbuddy-media",
      "config": {
        "baseUrl": "https://api.cheapbuddy.cc",
        "apiKey": { "store": "platform", "key": "cheapbuddy.api" },
        "concurrency": 1,
        "pollIntervalMs": 5000
      }
    }
  },
  "bindings": {
    "@hypit/minimax-h3@1#minimax-h3": "cheapbuddy.media"
  }
}`;
  const authorExample = `<?svml using="@hypit/markup@1"?>
<svml>
  <import as="text" from="@hypit/text@1"/>
  <import as="h3" from="@hypit/minimax-h3@1"/>
  <text:Value id="prompt">A calm product close-up in a bright studio, slow camera move, no captions.</text:Value>
  <h3:TextVideo id="shot" prompt={prompt} duration="8" resolution="768P" aspect-ratio="16:9"/>
</svml>`;
  const runExample = `<?svml using="@hypit/run-markup@1"?>
<svrun version="1">
  <author source="../authors/generate.svml"/>
  <target output="shot.video"/>
</svrun>`;
  const buildCommands = `npx hypit runtime use hypit.runtime.json
npx hypit auth login cheapbuddy.media
npx hypit auth status cheapbuddy.media
npx hypit doctor --endpoint cheapbuddy.media
npx hypit check authors/generate.svml
npx hypit check runs/generate.svrun
npx hypit plan runs/generate.svrun
npx hypit build runs/generate.svrun --title "CheapBuddy video build" --follow
npx hypit get <build-id> --output shot.video --to assets/generated-shot.mp4`;

  const copyCode = async (codeId, value) => {
    try {
      await writeClipboard(value);
      setCopied(codeId);
      window.setTimeout(() => setCopied((current) => current === codeId ? '' : current), 1800);
    } catch {
      setCopied('');
    }
  };

  const steps = [
    ['01', 'hypitInstallStepTitle', 'hypitInstallStepText'],
    ['02', 'hypitRuntimeStepTitle', 'hypitRuntimeStepText'],
    ['03', 'hypitCredentialStepTitle', 'hypitCredentialStepText'],
    ['04', 'hypitBindStepTitle', 'hypitBindStepText'],
  ];

  return <div className="api-docs-shell hypit-docs-shell">
    <header className="site-header api-docs-header">
      <div className="site-header-inner section-wrap">
        <Logo t={t} homeHref="/" />
        <div className="api-docs-top-actions"><a className="api-home-link" href="/">{t('apiDocsBackHome')} <Icon name="arrow" size={15} /></a><a className="api-home-link" href="/api-docs">{t('navMediaApi')} <Icon name="arrow" size={15} /></a><LanguageToggle language={language} onChange={setLanguage} /></div>
      </div>
    </header>
    <main>
      <section className="api-docs-hero section-wrap hypit-docs-hero">
        <div className="api-docs-hero-copy"><span className="section-index">HYPIT / 01</span><h1>{t('hypitTitle')}<br /><em>{t('hypitTitleAccent')}</em></h1><p>{t('hypitLead')}</p><div className="api-docs-hero-tags"><span>INSTALL PROVIDER</span><span>CHEAPBUDDY.CC</span><span>CHECK → BUILD</span></div></div>
        <div className="hypit-hero-board"><div className="api-route-board-head"><span className="live-line" /> <span>{t('hypitBoardTitle')}</span><span>provider</span></div><div className="hypit-flow-row"><span>01</span><b>{t('hypitFlowInstall')}</b><code>npm install</code></div><div className="hypit-flow-row"><span>02</span><b>{t('hypitFlowRuntime')}</b><code>cheapbuddy.media</code></div><div className="hypit-flow-row"><span>03</span><b>{t('hypitFlowBuild')}</b><code>check → plan → build</code></div><div className="hypit-board-foot">{t('hypitBoardFoot')}</div></div>
      </section>

      <div className="comfy-docs-layout section-wrap">
        <aside className="api-docs-sidebar"><span>{t('hypitOnThisPage')}</span><a href="#hypit-install">{t('hypitInstallTitle')}</a><a href="#hypit-runtime">{t('hypitRuntimeTitle')}</a><a href="#hypit-author">{t('hypitAuthorTitle')}</a><a href="#hypit-build">{t('hypitBuildTitle')}</a><a href="#hypit-safety">{t('hypitSafetyTitle')}</a></aside>
        <article className="api-docs-content">
          <section id="hypit-install" className="api-doc-section"><div className="api-doc-section-heading"><span className="api-doc-number">01</span><div><h2>{t('hypitInstallTitle')}</h2><p>{t('hypitInstallLead')}</p></div></div><div className="comfy-install-grid">{steps.map(([number, titleKey, textKey]) => <article className="comfy-step-card" key={number}><span>{number}</span><div><h3>{t(titleKey)}</h3><p>{t(textKey)}</p></div></article>)}</div><ApiCodeBlock label="npm" code={installCommand} codeId="hypit-install" copied={copied} onCopy={copyCode} t={t} /></section>

          <section id="hypit-runtime" className="api-doc-section"><div className="api-doc-section-heading"><span className="api-doc-number">02</span><div><h2>{t('hypitRuntimeTitle')}</h2><p>{t('hypitRuntimeLead')}</p></div></div><ApiCodeBlock label="hypit.runtime.json" code={runtimeConfig} codeId="hypit-runtime" copied={copied} onCopy={copyCode} t={t} /><div className="api-callout"><strong>{t('hypitRuntimeNoteTitle')}</strong><p>{t('hypitRuntimeNote')}</p></div></section>

          <section id="hypit-author" className="api-doc-section"><div className="api-doc-section-heading"><span className="api-doc-number">03</span><div><h2>{t('hypitAuthorTitle')}</h2><p>{t('hypitAuthorLead')}</p></div></div><div className="hypit-code-grid"><ApiCodeBlock label="authors/generate.svml" code={authorExample} codeId="hypit-author" copied={copied} onCopy={copyCode} t={t} /><ApiCodeBlock label="runs/generate.svrun" code={runExample} codeId="hypit-run" copied={copied} onCopy={copyCode} t={t} /></div><div className="api-field-grid hypit-capability-grid"><div className="api-field-card"><code>@hypit/minimax-h3@1#minimax-h3</code><strong>MiniMax-H3</strong><p>{t('hypitVideoCapability')}</p></div></div></section>

          <section id="hypit-build" className="api-doc-section"><div className="api-doc-section-heading"><span className="api-doc-number">04</span><div><h2>{t('hypitBuildTitle')}</h2><p>{t('hypitBuildLead')}</p></div></div><ApiCodeBlock label="Hypit CLI" code={buildCommands} codeId="hypit-build" copied={copied} onCopy={copyCode} t={t} /><div className="api-callout"><strong>{t('hypitBuildNoteTitle')}</strong><p>{t('hypitBuildNote')}</p></div></section>

          <section id="hypit-safety" className="api-doc-section"><div className="api-doc-section-heading"><span className="api-doc-number">05</span><div><h2>{t('hypitSafetyTitle')}</h2><p>{t('hypitSafetyLead')}</p></div></div><div className="comfy-security-list hypit-safety-list"><span>{t('hypitSafetyItemOne')}</span><span>{t('hypitSafetyItemTwo')}</span><span>{t('hypitSafetyItemThree')}</span></div><div className="api-callout"><strong>{t('hypitSafetyWarningTitle')}</strong><p>{t('hypitSafetyWarning')}</p></div></section>
        </article>
      </div>
    </main>
    <footer className="footer api-docs-footer section-wrap"><Logo t={t} homeHref="/" /><div className="footer-note">{t('footerNote')}<br /><span>{t('poweredBy')}</span></div><p>{t('hypitFooterNote')}</p></footer>
  </div>;
}

const blogSources = import.meta.glob('../content/blog/*.md', { query: '?raw', import: 'default', eager: true });

function parseBlogPost(source) {
  const [, frontMatter = '', content = source] = source.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n([\s\S]*)$/) || [];
  const data = Object.fromEntries(frontMatter.split(/\r?\n/).filter(Boolean).map((line) => {
    const separator = line.indexOf(':');
    return separator < 0 ? [line, ''] : [line.slice(0, separator).trim(), line.slice(separator + 1).trim()];
  }));
  const [zh = '', en = ''] = content.split('<!-- en -->');
  const clean = (value) => value.replace('<!-- zh -->', '').trim();
  return {
    slug: data.slug,
    category: data.category || 'NOTES',
    date: data.date,
    readTime: Number(data.readTime || 1),
    accent: data.accent || 'green',
    title: { zh: data.title, en: data.title_en || data.title },
    excerpt: { zh: data.excerpt, en: data.excerpt_en || data.excerpt },
    markdown: { zh: clean(zh), en: clean(en) },
  };
}

function getBlogHeadings(markdown) {
  return [...markdown.matchAll(/^##\s+(.+)$/gm)].map((match) => match[1].trim());
}

function blogHeadingId(heading) {
  return heading.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, '-').replace(/^-|-$/g, '');
}

const blogPosts = Object.values(blogSources).map(parseBlogPost).sort((a, b) => String(b.date).localeCompare(String(a.date)));

function BlogPage() {
  const [language, setLanguage] = useState(getInitialLanguage);
  const t = (value) => value?.[language] || value?.zh || value?.en || '';
  const slug = window.location.pathname.split('/').filter(Boolean)[1] || '';
  const post = blogPosts.find((item) => item.slug === slug);
  const isDetail = Boolean(post);
  const markdown = post?.markdown[language] || post?.markdown.en || '';
  const headings = getBlogHeadings(markdown);
  const markdownSections = markdown.split(/^##\s+/gm).filter(Boolean).map((section) => {
    const [heading, ...body] = section.split('\n');
    return { heading: heading.trim(), body: body.join('\n').trim() };
  });

  useEffect(() => {
    setStoredLanguage(language);
    updateSeoMetadata({
      title: isDetail ? `${t(post.title)} | CheapBuddy Blog` : language === 'en' ? 'CheapBuddy Blog | Notes on models, APIs, and workflows' : 'CheapBuddy Blog｜模型、API 与工作流笔记',
      description: isDetail ? t(post.excerpt) : language === 'en' ? 'Product notes and practical guides for building with CheapBuddy models, media APIs, ComfyUI, and Hypit.' : 'CheapBuddy 的产品笔记与实战指南，覆盖模型、媒体 API、ComfyUI 和 Hypit 工作流。',
      path: isDetail ? `/blog/${post.slug}` : '/blog',
      type: 'article',
    });
  }, [language, isDetail, post]);

  const formatDate = (date) => new Intl.DateTimeFormat(language === 'zh' ? 'zh-CN' : 'en-US', { year: 'numeric', month: 'short', day: 'numeric' }).format(new Date(date));

  return <div className="blog-shell">
    <header className="site-header api-docs-header blog-header">
      <div className="site-header-inner section-wrap">
        <Logo t={(key) => key === 'homeAria' ? 'CheapBuddy home' : key} homeHref="/" />
        <div className="blog-top-actions"><a className="api-home-link" href="/">{language === 'zh' ? '返回首页' : 'Back home'} <Icon name="arrow" size={15} /></a><a className="api-home-link blog-current-link" href="/blog">Blog</a><LanguageToggle language={language} onChange={setLanguage} /></div>
      </div>
    </header>
    <main>
      {!isDetail ? <>
        <section className="blog-hero section-wrap"><div><span className="section-index">CHEAPBUDDY / JOURNAL</span><h1>{language === 'zh' ? <>把模型接入工作，<br /><em>把复杂留在幕后。</em></> : <>Make models useful.<br /><em>Keep complexity backstage.</em></>}</h1><p>{language === 'zh' ? '产品笔记、工程实践和可以直接复制的工作流。' : 'Product notes, engineering decisions, and workflows you can use immediately.'}</p></div><div className="blog-hero-signal"><span className="live-line" /><span>CURRENTLY WRITING</span><strong>{String(blogPosts.length).padStart(2, '0')}</strong><small>{language === 'zh' ? '篇公开文章' : 'published notes'}</small></div></section>
        <section className="blog-index section-wrap">{blogPosts.length ? <><div className="blog-featured-label"><span>{language === 'zh' ? '精选文章' : 'Featured note'}</span><span>01 / {String(blogPosts.length).padStart(2, '0')}</span></div><a className="blog-featured-card" href={`/blog/${blogPosts[0].slug}`}><div className={`blog-card-art art-${blogPosts[0].accent}`}><span>CB</span><i>01</i><b>ONE<br />BALANCE</b></div><div className="blog-featured-copy"><div className="blog-meta"><span>{blogPosts[0].category}</span><time>{formatDate(blogPosts[0].date)} · {blogPosts[0].readTime} min</time></div><h2>{t(blogPosts[0].title)}</h2><p>{t(blogPosts[0].excerpt)}</p><span className="blog-read-link">{language === 'zh' ? '阅读文章' : 'Read note'} <Icon name="arrow" size={15} /></span></div></a></> : <p className="blog-empty">{language === 'zh' ? '文章正在准备中。' : 'New notes are on the way.'}</p>}<div className="blog-list-heading"><h2>{language === 'zh' ? '全部文章' : 'All notes'}</h2><span>{language === 'zh' ? '从产品到生态' : 'Product to ecosystem'}</span></div><div className="blog-list">{blogPosts.slice(1).map((item, index) => <a className="blog-list-card" href={`/blog/${item.slug}`} key={item.slug}><div className={`blog-card-art art-${item.accent}`}><span>{String(index + 2).padStart(2, '0')}</span><i>↗</i></div><div><div className="blog-meta"><span>{item.category}</span><time>{formatDate(item.date)} · {item.readTime} min</time></div><h3>{t(item.title)}</h3><p>{t(item.excerpt)}</p><span className="blog-read-link">{language === 'zh' ? '查看内页' : 'Open note'} <Icon name="arrow" size={14} /></span></div></a>)}</div></section>
      </> : post ? <article className="blog-article section-wrap"><a className="blog-back-link" href="/blog"><Icon name="arrow" size={15} /> {language === 'zh' ? '返回 Blog' : 'Back to Blog'}</a><div className="blog-article-head"><div className="blog-meta"><span>{post.category}</span><time>{formatDate(post.date)} · {post.readTime} min read</time></div><h1>{t(post.title)}</h1><p>{t(post.excerpt)}</p></div><div className="blog-article-layout"><aside className="blog-article-aside"><span>{language === 'zh' ? '文章目录' : 'On this page'}</span>{headings.map((heading, index) => <a href={`#${blogHeadingId(heading)}`} key={heading}>{String(index + 1).padStart(2, '0')} {heading}</a>)}</aside><div className="blog-article-content">{markdownSections.map((section, index) => <section id={blogHeadingId(section.heading)} className="blog-content-section" key={section.heading}><div className="blog-content-number">{String(index + 1).padStart(2, '0')}</div><div><h2>{section.heading}</h2><ReactMarkdown remarkPlugins={[remarkGfm]}>{section.body}</ReactMarkdown></div></section>)}<div className="blog-article-footer"><span>{language === 'zh' ? '继续阅读' : 'Keep reading'}</span>{blogPosts.filter((item) => item.slug !== post.slug).slice(0, 2).map((item) => <a href={`/blog/${item.slug}`} key={item.slug}>{t(item.title)} <Icon name="arrow" size={14} /></a>)}</div></div></div></article> : <article className="blog-article section-wrap"><a className="blog-back-link" href="/blog"><Icon name="arrow" size={15} /> {language === 'zh' ? '返回 Blog' : 'Back to Blog'}</a><h1>{language === 'zh' ? '文章不存在' : 'Article not found'}</h1></article>}
    </main>
    <footer className="footer api-docs-footer section-wrap"><Logo t={(key) => key === 'homeAria' ? 'CheapBuddy home' : key} homeHref="/" /><div className="footer-note">{language === 'zh' ? '更多模型，就在你的工作流里。' : 'More models, right inside your workflow.'}<br /><span>cheapbuddy.cc · Powered by CheapBuddy</span></div><div className="footer-links"><a href="/">{language === 'zh' ? '首页' : 'Home'}</a><a href="/api-docs">{language === 'zh' ? '媒体 API' : 'Media API'}</a><a href="/comfyui">ComfyUI</a><a href="/hypit">Hypit</a></div><span className="footer-copy">© 2026 CheapBuddy</span></footer>
  </div>;
}

function MediaDocs({ t }) {
  const imageRequest = `curl ${baseUrl}/images/generations \\\n  -H "Authorization: Bearer $CHEAPBUDDY_API_KEY" \\\n  -H "Content-Type: application/json" \\\n  -d '{"model":"gpt-image-2.5","prompt":"a cinematic city at night","size":"1024x1024","n":1}'`;
  const videoRequest = `curl -X POST ${baseUrl}/videos -H "Authorization: Bearer $CHEAPBUDDY_API_KEY" -F "model=MiniMax-H3" -F "prompt=A slow camera move through a misty forest"`;
  const videoPoll = `curl ${baseUrl}/videos/{video_id} \\
  -H "Authorization: Bearer $CHEAPBUDDY_API_KEY"

curl ${baseUrl}/videos/{video_id}/content \\
  -H "Authorization: Bearer $CHEAPBUDDY_API_KEY" \\
  -o output.mp4`;

  return <section id="media-docs" className="media-docs-section section-wrap">
    <div className="section-heading compact"><span className="section-index">06</span><div><h2>{t('mediaDocsTitle')}</h2><p>{t('mediaDocsLead')}</p></div></div>
    <div className="media-docs-intro"><span className="media-docs-badge">OPENAI COMPATIBLE MEDIA</span><p>{t('mediaDocsIntro')}</p><code>{baseUrl}</code></div>
    <div className="media-doc-grid">
      <article className="media-doc-card media-doc-image"><div className="media-doc-card-head"><span className="media-doc-mark">IMG</span><div><h3>gpt-image-2.5</h3><p>{t('imageDocsSummary')}</p></div></div><div className="media-doc-meta"><span>POST</span><code>/v1/images/generations</code></div><div className="media-doc-meta"><span>EDIT</span><code>/v1/images/edits</code></div><pre><code>{imageRequest}</code></pre><ol><li>{t('imageDocsStepOne')}</li><li>{t('imageDocsStepTwo')}</li><li>{t('imageDocsStepThree')}</li></ol></article>
      <article className="media-doc-card media-doc-video"><div className="media-doc-card-head"><span className="media-doc-mark">H3</span><div><h3>MiniMax-H3</h3><p>{t('videoDocsSummary')}</p></div></div><div className="media-doc-meta"><span>POST</span><code>/v1/videos</code></div><pre><code>{videoRequest}</code></pre><div className="media-doc-meta"><span>GET</span><code>/v1/videos/{'{video_id}'}</code></div><pre><code>{videoPoll}</code></pre><ol><li>{t('videoDocsStepOne')}</li><li>{t('videoDocsStepTwo')}</li><li>{t('videoDocsStepThree')}</li></ol></article>
    </div>
    <div className="media-doc-note"><strong>{t('mediaDocsConfigTitle')}</strong><p>{t('mediaDocsConfigText')}</p><a href="/comfyui">{t('mediaDocsOpenComfyUI')} <Icon name="arrow" size={14} /></a></div>
  </section>;
}

function HomePage() {
  const [language, setLanguage] = useState(getInitialLanguage);
  const [selected, setSelected] = useState(models.map((model) => model.id));
  const [mobileOpen, setMobileOpen] = useState(false);
  const [toast, setToast] = useState('');
  const [showGenerator, setShowGenerator] = useState(false);
  const [platformId, setPlatformId] = useState('workbuddy');
  const [showAccount, setShowAccount] = useState(false);
  const [showPaywall, setShowPaywall] = useState(false);
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
  const [checkoutInfo, setCheckoutInfo] = useState(null);
  const [checkoutLoading, setCheckoutLoading] = useState(false);
  const [checkoutError, setCheckoutError] = useState(false);
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
    updateSeoMetadata({
      title: language === 'en' ? 'CheapBuddy | WorkBuddy multi-model API access' : 'CheapBuddy｜WorkBuddy 多模型 API 接入',
      description: language === 'en' ? 'Use multiple leading AI models in WorkBuddy with one shared balance, usage-based billing, and an OpenAI-compatible API.' : 'CheapBuddy：在 WorkBuddy 中使用多个主流 AI 模型，共享余额，按实际用量计费，并提供 OpenAI 兼容接口。',
      path: '/',
    });
  }, [language]);

  const activePlatform = platformOptions.find(({ id }) => id === platformId) || platformOptions[0];
  const displayModels = useMemo(() => localizeModels(models, language), [language]);
  const selectedModels = useMemo(() => displayModels.filter((model) => selected.includes(model.id)), [displayModels, selected]);
  const configDisplayModels = [...displayModels.filter((model) => model.featured), ...displayModels.filter((model) => !model.featured)];
  const heroModels = [...displayModels.filter((model) => model.featured), ...displayModels.filter((model) => !model.featured)].slice(0, 4);
  const usageExampleModels = [...displayModels.filter((model) => model.showInUsageExample), ...displayModels.filter((model) => !model.showInUsageExample)].slice(0, 7);
  const consoleModels = displayModels.slice(0, 2);
  const displayPricingPlans = useMemo(() => session.token
    ? getCheckoutRechargePlans(checkoutInfo, language)
    : pricingPlans.map((plan) => ({ ...plan, name: t(plan.nameKey), description: t(plan.descriptionKey), tag: t(plan.tagKey) })), [language, session.token, checkoutInfo]);
  const selectedPricingPlan = displayPricingPlans.find((plan) => plan.id === selectedPlanId) || displayPricingPlans[0];

  useEffect(() => {
    let active = true;
    setCheckoutInfo(null);
    setCheckoutError(false);
    setCheckoutLoading(Boolean(session.token));
    if (session.token) getCheckoutInfo().then((info) => {
      if (active) setCheckoutInfo(info);
    }).catch(() => {
      if (active) setCheckoutError(true);
    }).finally(() => {
      if (active) setCheckoutLoading(false);
    });
    return () => { active = false; };
  }, [session.token]);

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
    setPlatformId(nextPlatformId);
  };

  const toggleModel = (id) => setSelected((current) => {
    if (current.includes(id)) return current.filter((item) => item !== id);
    return [...current, id];
  });

  const toggleAllModels = () => setSelected((current) => {
    const modelIds = configDisplayModels.map(({ id }) => id);
    if (modelIds.every((id) => current.includes(id))) {
      return current.filter((id) => !modelIds.includes(id));
    }
    return [...new Set([...current, ...modelIds])];
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

  const copyUserApiKey = async () => {
    setApiKeyLoading(true);
    try {
      const apiKey = session.apiKey || await getOrCreateApiKey();
      if (!apiKey) throw new Error(t('missingApiKey'));
      setSession((current) => ({ ...current, apiKey }));
      await writeClipboard(apiKey);
      notify(t('apiKeyCopied'));
    } catch (error) {
      notify(error.message || t('copyFailed'));
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
      const [stats, modelResult, mediaResult] = await Promise.all([
        getUsageDashboardStats(),
        getUsageDashboardModels({ start_date: toDate(startDate), end_date: toDate(endDate) }),
        listApiKeys().then((keys) => keys.find((item) => item.status === 'active')?.key || keys[0]?.key || '').then((apiKey) => getMediaUsageDashboardModels(apiKey, { start_date: toDate(startDate), end_date: toDate(endDate) })).catch((error) => {
          if (error?.status !== 404 && error?.status !== 405) console.warn('Media usage is unavailable', error);
          return { models: [], summary: {} };
        }),
      ]);
      const textModels = Array.isArray(modelResult?.models) ? modelResult.models : Array.isArray(modelResult) ? modelResult : [];
      const mediaModels = Array.isArray(mediaResult?.models) ? mediaResult.models : [];
      setUsageSummary(stats || {});
      setUsageModels(mergeUsageModels(textModels, mediaModels));
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

  useEffect(() => {
    const openAccountLink = () => {
      if (window.location.hash === '#account') openAccount();
    };
    openAccountLink();
    window.addEventListener('hashchange', openAccountLink);
    return () => window.removeEventListener('hashchange', openAccountLink);
  }, [session.token]);

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
      notify(t('affiliateTransferSuccess', { amount: formatLedgerAmount(result?.transferred_quota || 0) }));
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
    if (!plan) return notify(language === 'en' ? 'No recharge offer is available.' : '当前暂无可用的充值商品。');
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
      setCheckoutInfo(checkout);
      const currentOffer = getCheckoutRechargePlans(checkout, language).find((offer) => offer.id === plan.id);
      if (!currentOffer) throw new Error(language === 'en' ? 'This recharge offer is unavailable. Please refresh.' : '该充值商品暂不可用，请刷新后重试。');
      const paymentType = currentOffer.paymentType;
      const paymentResultUrl = `${window.location.origin}/payment/result`;
      const order = await createPaymentOrder({ amount: currentOffer.amount, payment_type: currentOffer.paymentType, order_type: 'balance', payment_source: 'cheapbuddy', return_url: paymentResultUrl, is_mobile: window.innerWidth < 700 });
      if (isStripePaymentType(paymentType) && order.client_secret) {
        const stripeUrl = buildStripePaymentUrl({ orderId: order.order_id || order.id, clientSecret: order.client_secret, resumeToken: order.resume_token });
        if (!stripeUrl) throw new Error(t('stripePaymentFailed'));
        window.location.assign(stripeUrl);
      } else if (order.pay_url) window.location.assign(order.pay_url);
      else if (order.qr_code) notify(t('orderCreatedQr'));
      else notify(isStripePaymentType(paymentType) ? t('stripePaymentFailed') : t('orderCreated'));
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

  const openPaywall = () => {
    setShowAccount(false);
    setShowGenerator(false);
    setShowPaywall(true);
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
      const selectedModel = selectedModels[0];
      // The public API subdomain is Railway DNS-only and duplicates CORS
      // headers on POST responses. Test through the same-origin Worker alias.
      const connectionBaseUrl = ['cheapbuddy.cc', 'www.cheapbuddy.cc'].includes(window.location.hostname)
        ? `${window.location.origin}/v1`
        : baseUrl;
      const mediaRequest = selectedModel.modality === 'image'
        ? {
          method: 'GET',
          url: `${connectionBaseUrl}/models`,
          isValid: (body) => Array.isArray(body.data) && body.data.some((model) => model.id === selectedModel.id),
        }
          : selectedModel.modality === 'video'
            ? {
            method: 'GET',
            url: `${connectionBaseUrl}/models`,
            isValid: (body) => Array.isArray(body.data) && body.data.some((model) => model.id === selectedModel.id),
          }
          : null;

      const protocolRequest = mediaRequest || {
        workbuddy: {
          url: `${connectionBaseUrl}/chat/completions`,
          body: {
            model: selectedModel.id,
            messages: [{ role: 'user', content: 'Reply with OK only.' }],
            temperature: 0,
            max_tokens: 8,
            stream: false,
          },
          isValid: (body) => Array.isArray(body.choices) && body.choices.length > 0,
        },
        opencode: {
          url: `${connectionBaseUrl}/chat/completions`,
          body: {
            model: selectedModel.id,
            messages: [{ role: 'user', content: 'Reply with OK only.' }],
            temperature: 0,
            max_tokens: 8,
            stream: false,
          },
          isValid: (body) => Array.isArray(body.choices) && body.choices.length > 0,
        },
        claude: {
          url: `${connectionBaseUrl}/messages`,
          headers: { 'anthropic-version': '2023-06-01' },
          body: {
            model: selectedModel.id,
            max_tokens: 8,
            messages: [{ role: 'user', content: 'Reply with OK only.' }],
            stream: false,
          },
          isValid: (body) => Array.isArray(body.content) && body.content.length > 0,
        },
        codex: {
          url: `${connectionBaseUrl}/responses`,
          body: {
            model: selectedModel.id,
            input: 'Reply with OK only.',
            max_output_tokens: 8,
            stream: false,
          },
          isValid: (body) => Boolean(body.id) || (Array.isArray(body.output) && body.output.length > 0),
        },
      }[platformId] || null;
      if (!protocolRequest) throw new Error(t('connectionTestFailed'));
      const response = await fetch(protocolRequest.url, {
        method: protocolRequest.method || 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${apiKey}`,
          ...(protocolRequest.headers || {}),
        },
        body: protocolRequest.body ? JSON.stringify(protocolRequest.body) : undefined,
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
          <a href="/blog" onClick={closeNav}>Blog</a>
          <div className="nav-menu">
            <button className="nav-menu-trigger" type="button" aria-haspopup="true">{t('navMediaDocs')} <Icon name="chevron" size={14} /></button>
            <div className="nav-menu-panel" role="menu">
              <a href="/api-docs" onClick={closeNav} role="menuitem"><span>{t('navMediaApi')}</span><small>{t('navMediaApiHint')}</small></a>
              <a href="/comfyui" onClick={closeNav} role="menuitem"><span>{t('navComfyUI')}</span><small>{t('navComfyUIHint')}</small></a>
              <a href="/hypit" onClick={closeNav} role="menuitem"><span>{t('navHypit')}</span><small>{t('navHypitHint')}</small></a>
            </div>
          </div>
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
          <p className="hero-lead">{t('heroLead1')}<br className="hero-mobile-break" />{t('heroLead2')}<br className="hero-mobile-break" />{t('heroLead3')}</p>
          <div className="hero-actions"><button className="button button-primary" onClick={openGenerator}>{t('generateConfig')} <Icon name="arrow" /></button><a className="button button-ghost" href="#models">{t('viewModels')} <Icon name="chevron" size={16} /></a></div>
          <div className="hero-trust"><span><Icon name="check" size={15} /> {t('streaming')}</span><span><Icon name="check" size={15} /> {t('toolCalls')}</span><span><Icon name="check" size={15} /> {t('usageAvailable')}</span></div>
        </div>
        <div className="hero-visual reveal reveal-delay" aria-label={t('currentBalance')}>
          <div className="routing-grid" />
          <div className="orbit orbit-one" /><div className="orbit orbit-two" /><div className="orbit orbit-three" />
          <div className="visual-core"><span className="core-spark">✦</span><small>ONE BALANCE</small><strong>{t('balanceCore')}<br />{t('modelsCore', { count: models.length })}</strong><span className="core-url">cheapbuddy.cc / v1</span></div>
          {heroModels.map((model, index) => <div className={`floating-card route-card route-${index + 1}`} key={model.id}><ModelMark model={model} /><div><small>{model.vendor}</small><strong>{model.short}</strong></div></div>)}
          <div className="visual-caption"><span className="live-line" /> <span>ROUTING / READY</span><span className="caption-separator" /><span>OPENAI COMPATIBLE</span></div>
        </div>
      </section>

      <section id="models" className="models-section section-wrap">
        <div className="section-heading"><span className="section-index">01</span><div><h2>{t('modelShelfTitle')}</h2><p>{t('modelShelfLead', { count: models.length })}</p></div><a href="#generator" className="heading-link" onClick={(event) => { event.preventDefault(); openGenerator(); }}>{t('startCombining')} <Icon name="arrow" size={15} /></a></div>
        <div className="model-grid">{displayModels.map((model) => <article className={`model-card model-card-${model.modality}`} key={model.id}><div className="model-card-top"><ModelMark model={model} /><span className="model-state"><span className="mini-dot" /> {t('available')}</span></div><div className="model-card-name"><small>{model.vendor} / {model.short}</small><h3>{model.id}</h3></div><p>{model.description}</p><div className="model-prices" title={model.priceUnit}>{model.modality === 'text' ? <><span>{t('input')} <b>{model.input}</b> / M</span><span>{t('output')} <b>{model.output}</b> / M</span></> : <><span>{model.billingUnit}</span><span><b>{model.input}</b> · <b>{model.output}</b></span></>}</div><div className="model-card-meta"><span className={`model-modality model-modality-${model.modality}`}>{model.modality === 'image' ? t('imageModel') : model.modality === 'video' ? t('videoModel') : t('textModel')}</span><b>{model.endpointPath}</b></div></article>)}</div>
        <div className="shelf-note"><span className="shelf-line" /><span>{t('priceNote')}</span><span className="shelf-line" /></div>
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

      <section id="pricing" className="pricing-section section-wrap"><div className="pricing-head"><div><span className="section-index">04</span><h2>{t('pricingTitle')}<br /><em>{t('pricingTitleAccent')}</em></h2></div><p>{t('pricingLead')}</p></div><RechargePlanCards checkoutLoading={checkoutLoading} checkoutError={checkoutError} plans={displayPricingPlans} selectedPlanId={selectedPlanId} paymentLoading={paymentLoading} onRecharge={startRecharge} language={language} t={t} /><p className="pricing-footnote"><span className="pricing-footnote-dot" />{t('pricingFootnote')}</p><PricingComparison plan={selectedPricingPlan} language={language} t={t} /><div className="pricing-grid"><div className="balance-card"><div className="balance-label">{t('currentBalance')} <span>{t('allModelsShared')}</span></div><div className="balance-amount">{balance === null ? <strong className="balance-login">{t('loginToSync')}</strong> : <><strong>{formatLedgerAmount(balance)}</strong><span>{t('availableBalance')}</span></>}</div><div className="rate-highlight"><span>{t('actualBilling')}</span><strong>{t('perModelRates')}</strong><small>{t('officialPriceBilling')}</small></div><button className="button button-blue full-width" onClick={() => startRecharge(selectedPricingPlan)} disabled={paymentLoading || checkoutLoading || checkoutError || !selectedPricingPlan}>{paymentLoading ? t('creatingOrder') : selectedPricingPlan ? t(language === 'en' ? 'rechargeUsdAmount' : 'rechargeAmount', { amount: formatAmount(selectedPricingPlan.payAmount ?? getPlanPaymentAmount(selectedPricingPlan.amount, language)) }) : language === 'en' ? 'Recharge unavailable' : '暂不可充值'} <Icon name="arrow" size={16} /></button></div><div className="usage-card"><div className="usage-top"><span>{t('usageExample')}</span><span className="usage-range">{t('inputOutput')} <Icon name="chevron" size={14} /></span></div><div className="usage-list">{usageExampleModels.map((model) => <div className="usage-row" key={model.id}><ModelMark model={model} /><span>{model.id}</span><b title={model.priceUnit}>{model.input} / {model.output}{model.priceSourceUrl && <> · <a href={model.priceSourceUrl} target="_blank" rel="noopener noreferrer" aria-label={t('officialPricingSource')}>↗</a></>}</b><i><em style={{ width: `${Math.min(92, 18 + usageExampleModels.indexOf(model) * 15)}%` }} /></i></div>)}</div><div className="usage-footer"><span><i className="usage-dot" /> {t('usageRealtime')}</span><span>{t('transparentBilling')}</span></div></div></div></section>

          <section id="guide" className="guide-section section-wrap"><div className="guide-copy"><span className="section-index">05</span><h2>{t('guideTitle')}<br />{t('guideTitleAccent')}</h2><p>{t('guideLead')}</p><button className="button button-primary guide-config-button" type="button" onClick={openGenerator}>{t('choosePlatformAndGenerate')} <Icon name="arrow" size={15} /></button><p className="guide-prompt-hint">{t('promptDescription')}</p></div><div className="guide-detail"><div className="guide-method"><span className="guide-method-mark">01</span><div><b>{t('guideStepDownload')}</b><p>{t('guideStepDownloadText')}</p></div></div><div className="guide-method"><span className="guide-method-mark">02</span><div><b>{t('guideStepRestart')}</b><p>{t('guideStepRestartText')}</p></div></div><div className="os-list platform-guide-list">{platformOptions.map((platform) => <button className={platform.id === platformId ? 'os-row active' : 'os-row'} key={platform.id} type="button" onClick={() => { changePlatform(platform.id); openGenerator(); }}><span className="os-icon">{platform.mark}</span><div><b>{platform.name}</b><small>{t(`platform_${platform.id}`)}</small></div><Icon name="arrow" size={17} /></button>)}</div></div></section>
    </main>

    <footer className="footer section-wrap"><Logo t={t} /><div className="footer-note">{t('footerNote')}<br /><span>{t('poweredBy')}</span></div><div className="footer-links"><a href="#models">{t('footerModels')}</a><a href="#guide">{t('footerGuide')}</a><a href="/blog">Blog</a><a href="/api-docs">{t('footerMediaDocs')}</a><a href="/comfyui">{t('navComfyUI')}</a><a href="/hypit">{t('navHypit')}</a><a href="#" onClick={(event) => { event.preventDefault(); notify(t('serviceStatus')); }}>{t('serviceStatus')}</a></div><div className="footer-contact" aria-label={t('contact')}><div className="footer-contact-info"><span className="footer-contact-label">{t('contact')}</span><a className="footer-x-link" href="https://x.com/dennis_huangbei" target="_blank" rel="noopener noreferrer" aria-label={t('contactOnX')}><span className="footer-x-mark" aria-hidden="true">X</span><span>@dennis_huangbei</span><Icon name="arrow" size={14} /></a></div><img className="footer-qr" src="/wechat-contact-qr.png" width="128" height="128" loading="lazy" decoding="async" alt={t('wechatQr')} /></div><span className="footer-copy">© 2026 CheapBuddy</span></footer>

    {showAccount && <AccountPanel user={session.user} balance={balance} usageSummary={usageSummary} usageModels={usageModels} usageLoading={usageLoading} usageError={usageError} onAffiliate={() => { setShowAccount(false); openAffiliate(); }} onOrders={openPaymentOrders} onClose={() => setShowAccount(false)} onRefresh={loadUsage} onRecharge={openPaywall} onConfig={() => { setShowAccount(false); openGenerator(); }} onLogout={logout} t={t} />}
    {showPaywall && <PaywallPanel checkoutLoading={checkoutLoading} checkoutError={checkoutError} plans={displayPricingPlans} selectedPlanId={selectedPlanId} paymentLoading={paymentLoading} onRecharge={startRecharge} onClose={() => setShowPaywall(false)} language={language} t={t} />}
    {showPaymentOrders && <PaymentOrdersPanel orders={paymentOrders} error={paymentOrdersError} language={language} loading={paymentOrdersLoading} cancellingId={paymentOrderCancellingId} onClose={() => setShowPaymentOrders(false)} onRefresh={loadPaymentOrders} onCancel={cancelUserPaymentOrder} t={t} />}

    {showAffiliate && <AffiliatePanel detail={affiliateDetail} error={affiliateError} language={language} loading={affiliateLoading} transferring={affiliateTransferLoading} onClose={() => setShowAffiliate(false)} onCopyCode={(code) => copyAffiliateValue(code, 'affiliateCodeCopied')} onCopyLink={(link) => copyAffiliateValue(link, 'affiliateLinkCopied')} onRefresh={loadAffiliate} onTransfer={transferAffiliateBalance} t={t} />}

    {showAnnouncements && <AnnouncementsPanel announcements={announcements} loading={announcementLoading} error={announcementError} language={language} onClose={() => setShowAnnouncements(false)} onRefresh={loadAnnouncements} t={t} />}

    {showGenerator && <ConfigGeneratorModal platformId={platformId} onPlatformChange={changePlatform} selectedModels={selectedModels} displayModels={configDisplayModels} selected={selected} onToggleModel={toggleModel} onToggleAllModels={toggleAllModels} session={session} apiKeyLoading={apiKeyLoading} onCopyApiKey={copyUserApiKey} balance={balance} onRecharge={openPaywall} paymentLoading={paymentLoading} endpoint={baseUrl} testing={testing} testState={testState} testLatency={testLatency} onTest={testConnection} onCopyPrompt={copyInstallPrompt} onCopyConfig={copyConfig} onDownload={downloadConfig} onCopyEndpoint={() => writeClipboard(baseUrl).then(() => notify(t('endpointCopied'))).catch(() => notify(t('copyFailed')))} onClose={() => setShowGenerator(false)} t={t} />}
    {showAuth && <div className="modal-backdrop" role="presentation" onClick={() => setShowAuth(false)}><div className="generator-modal auth-modal" role="dialog" aria-modal="true" aria-labelledby="auth-title" onClick={(event) => event.stopPropagation()}><div className="modal-header"><div><span className="modal-kicker">CHEAPBUDDY ACCOUNT</span><h2 id="auth-title">{t(authMode === 'login' ? 'loginTitle' : 'registerTitle')}</h2></div><button className="modal-close" onClick={() => setShowAuth(false)} aria-label={t('close')}>×</button></div><div className="auth-tabs" role="tablist" aria-label={t('accountOperations')}><button className={authMode === 'login' ? 'auth-tab active' : 'auth-tab'} type="button" onClick={() => switchAuthMode('login')} role="tab" aria-selected={authMode === 'login'}>{t('loginTab')}</button>{!isAdminPortalHost && <button className={authMode === 'register' ? 'auth-tab active' : 'auth-tab'} type="button" onClick={() => switchAuthMode('register')} role="tab" aria-selected={authMode === 'register'}>{t('registerTab')}</button>}</div><p className="auth-intro">{t(authMode === 'login' ? 'loginIntro' : 'registerIntro')}</p>{authMode === 'register' && referralCode && <p className="affiliate-registration-notice">{t('affiliateRegistrationNotice', { code: referralCode })}</p>}<form className="auth-form" onSubmit={submitLogin}><label>{t('email')}<input type="email" value={authForm.email} onChange={(event) => setAuthForm((current) => ({ ...current, email: event.target.value }))} placeholder={t('emailPlaceholder')} autoComplete="email" required /></label><label>{t('password')}<input type="password" value={authForm.password} onChange={(event) => setAuthForm((current) => ({ ...current, password: event.target.value }))} placeholder={t(authMode === 'register' ? 'registerPasswordPlaceholder' : 'loginPasswordPlaceholder')} autoComplete={authMode === 'register' ? 'new-password' : 'current-password'} minLength={6} required /></label>{turnstileRequired && turnstileSiteKey && <TurnstileWidget key={`${authMode}-${turnstileResetKey}`} siteKey={turnstileSiteKey} action={authMode} resetKey={turnstileResetKey} onToken={(token) => { setTurnstileToken(token); setTurnstileError(''); setAuthError(''); }} onError={(message) => { setTurnstileToken(''); setTurnstileError(message); }} t={t} />}{turnstileError && <p className="auth-error">{turnstileError}</p>}{turnstileRequired && !turnstileSiteKey && <p className="auth-error">{t('turnstileMissing', { action: t(authMode === 'register' ? 'registerTab' : 'loginTab').toLowerCase() })}</p>}{authError && <p className="auth-error">{authError}</p>}<button className="button button-primary full-width" disabled={authLoading || (turnstileRequired && (!turnstileSiteKey || !turnstileToken))}>{authLoading ? authMode === 'register' ? t('processing') : t('loggingIn') : authMode === 'register' ? t('registerTrial') : t('loginContinue')} <Icon name="arrow" size={16} /></button></form><p className="auth-footnote">{t('authFootnote')}</p></div></div>}
    {showAdminPicker && <AdminConsolePicker onClose={() => setShowAdminPicker(false)} t={t} />}
    {toast && <div className="toast"><span className="toast-icon">✓</span>{toast}</div>}
  </div>;
}

function App() {
  const isApiDocsPage = window.location.pathname === '/api-docs' || window.location.pathname === '/api-docs/';
  const isComfyUIDocsPage = window.location.pathname === '/comfyui' || window.location.pathname === '/comfyui/';
  const isHypitDocsPage = window.location.pathname === '/hypit' || window.location.pathname === '/hypit/';
  const isBlogPage = window.location.pathname === '/blog' || window.location.pathname === '/blog/' || window.location.pathname.startsWith('/blog/');
  if (isHypitDocsPage) return <HypitDocsPage />;
  if (isComfyUIDocsPage) return <ComfyUIDocsPage />;
  if (isBlogPage) return <BlogPage />;
  return isApiDocsPage ? <ApiDocsPage /> : <HomePage />;
}

createRoot(document.getElementById('root')).render(<StrictMode><App /></StrictMode>);
