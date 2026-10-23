'use strict';

(() => {
  // Empty until the protected backend is deployed and its collection route is verified.
  const endpoint = document.querySelector('meta[name="portfolio-analytics-endpoint"]')?.content;
  if (!endpoint || navigator.doNotTrack === '1' || navigator.globalPrivacyControl) return;

  async function recordVisit() {
    try {
      const target = new URL(endpoint);
      if (target.protocol !== 'https:' || target.pathname !== '/api/collect') {
        throw new Error('Invalid portfolio analytics endpoint.');
      }
      const referrer = document.referrer ? new URL(document.referrer).origin : '';
      const response = await fetch(target.href, {
        method: 'POST',
        mode: 'cors',
        credentials: 'omit',
        referrerPolicy: 'no-referrer',
        keepalive: true,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ path: location.pathname, referrer })
      });
      if (!response.ok) throw new Error(`Portfolio analytics: HTTP ${response.status}`);
    } catch (error) {
      console.warn('Visit statistics could not be recorded.', error);
    }
  }

  if (document.visibilityState === 'visible') {
    void recordVisit();
  } else {
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'visible') void recordVisit();
    }, { once: true });
  }
})();
