import { URL } from 'url';

// Строит deeplink для Admitad. Поддерживает два случая:
// 1) base_deeplink с плейсхолдером {target}
// 2) base_deeplink без плейсхолдера — тогда добавим ?ulp=target
export function buildDeepLink({ offer, target, subs = {} }) {
  let url = offer.base_deeplink || '';

  // 1) Вставка цели: {target} или ulp=<target> (перезапишет ulp, если он уже есть)
  if (url.includes('{target}')) {
    url = url.replace('{target}', encodeURIComponent(target || ''));
  } else if (target) {
    const u = new URL(url);
    u.searchParams.set('ulp', target); // URLSearchParams сам кодирует
    url = u.toString();
  }

  // 2) Нормализуем субы: sub1 -> subid (как любит Admitad)
  const normalizedSubs = { ...subs };
  if (normalizedSubs.sub1 && !normalizedSubs.subid) {
    normalizedSubs.subid = normalizedSubs.sub1;
    delete normalizedSubs.sub1;
  }

  // 3) Добавляем субы
  const u2 = new URL(url);
  Object.entries(normalizedSubs).forEach(([k, v]) => u2.searchParams.set(k, v));
  return u2.toString();
}
