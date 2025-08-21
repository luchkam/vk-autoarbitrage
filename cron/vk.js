// cron/vk.js
import express from 'express';

const router = express.Router();

function need(name) {
  const v = process.env[name];
  if (!v) throw new Error(`ENV ${name} is required`);
  return v;
}

// простой вызов методов VK API (OAuth 2.1 токен уже есть в ENV)
async function vkCall(method, params = {}) {
  const url = `https://api.vk.com/method/${method}`;
  const body = new URLSearchParams({
    v: '5.199',
    access_token: need('VK_ACCESS_TOKEN'),
    ...Object.fromEntries(Object.entries(params).map(([k, v]) => [k, String(v)])),
  });

  const r = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body,
  });

  const json = await r.json();
  if (!r.ok) throw new Error(`HTTP ${r.status}: ${await r.text()}`);
  if (json.error) {
    const { error_code, error_msg } = json.error;
    throw new Error(`VK error ${error_code}: ${error_msg}`);
  }
  return json.response;
}

// GET /cron/pull-vk?key=...
router.get('/cron/pull-vk', async (req, res) => {
  try {
    const guard = req.query.key || '';
    if (guard !== need('CRON_SECRET')) return res.status(403).json({ ok: false, error: 'forbidden' });

    const accountId = need('VK_ADS_ACCOUNT_ID');

    // 1) Список кампаний
    const campaigns = await vkCall('ads.getCampaigns', { account_id: accountId });

    // Если кампаний много — ограничим до 200 id на один запрос статистики
    const ids = campaigns.map(c => c.id);
    const chunk = (arr, n) => arr.length ? [arr.slice(0, n), ...chunk(arr.slice(n), n)] : [];
    const chunks = chunk(ids, 200);

    // 2) Свежая статистика по кампаниям (за сегодня, period=day)
    const statsAll = [];
    for (const part of chunks) {
      const stats = await vkCall('ads.getStatistics', {
        account_id: accountId,
        ids_type: 'campaign',
        ids: part.join(','),
        period: 'day',
        date_from: '0',
        date_to: '0',
        // можно добавить metrics: 'impressions,clicks,spent' — но метод возвращает фиксированный набор
      });
      statsAll.push(...stats);
    }

    return res.json({
      ok: true,
      account_id: accountId,
      campaigns_count: campaigns.length,
      stats_rows: statsAll.length,
      sample: statsAll.slice(0, 5), // чтобы глазами посмотреть структуру
    });
  } catch (e) {
    return res.status(400).json({ ok: false, error: e.message });
  }
});

export default router;
