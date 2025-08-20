import { URL } from 'url';

// Строит deeplink для Admitad. Поддерживает два случая:
// 1) base_deeplink с плейсхолдером {target}
// 2) base_deeplink без плейсхолдера — тогда добавим ?ulp=target
export function buildDeepLink({ offer, target, subs = {} }) {
  let url = offer.base_deeplink || '';
  if (url.includes('{target}')) {
    url = url.replace('{target}', encodeURIComponent(target || ''));
  } else if (target) {
    const u = new URL(url);
    u.searchParams.set('ulp', target);
    url = u.toString();
  }
  const u2 = new URL(url);
  Object.entries(subs).forEach(([k, v]) => u2.searchParams.set(k, v));
  return u2.toString();
}
