/* B2B-only page analytics. Never read account state, form values, or API keys. */
(function initializeB2BAnalytics() {
  const measurementId = 'G-2M5FE2EC3Q';
  const pages = {
    '/B2B/api/': 'SpyConverter API | SpyConverter',
    '/B2B/api/pricing/': 'API Pricing | SpyConverter',
    '/B2B/api/docs/': 'API Documentation | SpyConverter',
    '/B2B/api/dashboard/': 'Developer Dashboard | SpyConverter',
    '/B2B/api/terms/': 'B2B API Terms of Service | SpyConverter',
  };
  const path = location.pathname.replace(/\/(?:index\.html)?$/, '') + '/';
  if (location.protocol !== 'https:' ||
      !['spyconverter.com', 'www.spyconverter.com'].includes(location.hostname) ||
      !Object.hasOwn(pages, path) || window.__scB2BAnalyticsInitialized ||
      window['ga-disable-' + measurementId] || navigator.globalPrivacyControl === true ||
      navigator.doNotTrack === '1' || window.doNotTrack === '1') return;
  window.__scB2BAnalyticsInitialized = true;

  // Referrer origin retains source attribution without sharing its path or query.
  let referrer = '';
  try {
    const source = new URL(document.referrer);
    if (['https:', 'http:'].includes(source.protocol)) referrer = source.origin + '/';
  } catch { /* Direct visits have no referrer. */ }
  const page = {
    page_location: 'https://spyconverter.com' + path,
    page_referrer: referrer,
    page_title: pages[path],
    content_group: 'B2B API',
    allow_google_signals: false,
    allow_ad_personalization_signals: false,
  };
  window.dataLayer = window.dataLayer || [];
  window.gtag = window.gtag || function gtag() { window.dataLayer.push(arguments); };
  window.gtag('js', new Date());
  // Set safe defaults before config generates its single initial page_view.
  // In particular, OAuth tokens and checkout/organization parameters never go
  // into the page_location or page_referrer sent by this integration.
  window.gtag('set', page);
  window.gtag('config', measurementId, { ...page, send_page_view: true });

  if (!document.querySelector(`script[src*="googletagmanager.com/gtag/js?id=${measurementId}"]`)) {
    const tag = document.createElement('script');
    tag.async = true;
    tag.referrerPolicy = 'origin';
    tag.src = `https://www.googletagmanager.com/gtag/js?id=${measurementId}`;
    document.head.appendChild(tag);
  }

  // Only a fixed plan name is recorded. No generic form/click text collection.
  document.querySelectorAll('a[data-b2b-plan]').forEach(link => {
    link.addEventListener('click', () => {
      const plan = link.dataset.b2bPlan;
      if (!['developer', 'pro', 'business'].includes(plan)) return;
      window.gtag('event', 'b2b_plan_selected', {
        send_to: measurementId, ...page, plan,
      });
    });
  });
})();
