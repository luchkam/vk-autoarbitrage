import { URL } from 'url';

// Аналогично: {target} или ?url=target
export function buildDeepLink({ offer, target, subs = {} }) {
  let url = offer.base_deeplink || '';
  if (url.includes('{target}')) {
    url = url.replace('{target}', encodeURIComponent(target || ''));
  } else if (target) {
    const u = new URL(url);
    u.searchParams.set('url', target);
    url = u.toString();
  }
  const u2 = new URL(url);
  Object.entries(subs).forEach(([k, v]) => u2.searchParams.set(k, v));
  return u2.toString();
}
