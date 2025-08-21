import express from 'express';
import { randomUUID } from 'crypto';
import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';

import { buildDeepLink as buildAdmitad } from '../adapters/admitad.js';
import { buildDeepLink as buildCityAds } from '../adapters/cityads.js';
import { chooseTargetForClick, recordClick, recordPostback } from '../optimizer/rotator.js';

const router = express.Router();
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.join(__dirname, '..');
const dataDir = path.join(rootDir, 'data');
const eventsPath = path.join(dataDir, 'events.json');
const offersPath = path.join(rootDir, 'config', 'offers.json');
const rotatorsPath = path.join(rootDir, 'config', 'rotators.json');

// helpers
async function ensureFiles() {
  await fs.mkdir(dataDir, { recursive: true });
  try { await fs.access(eventsPath); } catch { await fs.writeFile(eventsPath, '[]'); }
}
async function loadJSON(p) {
  try { return JSON.parse(await fs.readFile(p, 'utf8') || 'null'); }
  catch { return null; }
}
async function saveJSON(p, obj) {
  await fs.writeFile(p, JSON.stringify(obj, null, 2));
}
function pickAdapter(network) {
  if (network === 'admitad') return buildAdmitad;
  if (network === 'cityads') return buildCityAds;
  throw new Error(`Unknown network: ${network}`);
}

// CLICK
router.get('/click', async (req, res) => {
  try {
    await ensureFiles();
    let { offer_id, target, dry } = req.query;
    const offers = await loadJSON(offersPath);
    const rotators = await loadJSON(rotatorsPath) || {};

    let rotatorMeta = null;

    // Авто-ротатор
    if (offer_id === 'auto_apteki') {
      const choice = await chooseTargetForClick('auto_apteki');
      offer_id = rotators['auto_apteki'].offer;     // -> "admitad_apteki"
      target = choice.target;
      rotatorMeta = { rotator_key: 'auto_apteki', variant_id: choice.variant_id };
      await recordClick('auto_apteki', choice.variant_id);
    }

    const offer = offers?.[offer_id];
    if (!offer) return res.status(400).json({ ok: false, error: 'Unknown offer_id' });

    const click_id = randomUUID();

    // Субметки
    const subs = { sub1: click_id };

    // Построить deeplink
    const adapter = pickAdapter(offer.network);
    const redirect_to = adapter({ offer, target, subs });

    // Сохранить событие
    const events = await loadJSON(eventsPath) || [];
    events.push({
      type: 'click',
      ts: Date.now(),
      click_id,
      offer_id,
      network: offer.network,
      target: target || null,
      meta: rotatorMeta || null
    });
    await saveJSON(eventsPath, events);

    if (dry) return res.json({ ok: true, click_id, redirect_to, note: 'dry run: no redirect' });
    res.redirect(302, redirect_to);
  } catch (e) {
    console.error(e);
    res.status(500).json({ ok: false, error: e.message });
  }
});

// POSTBACK
router.get('/postback', async (req, res) => {
  try {
    await ensureFiles();
    const {
      sub1, payout, currency, status, order_id, network, key
    } = req.query;

    if (!key || key !== process.env.POSTBACK_SECRET) return res.status(403).send('forbidden');
    const click_id = sub1;

    const events = await loadJSON(eventsPath) || [];
    const click = events.find(ev => ev.type === 'click' && ev.click_id === click_id);

    events.push({
      type: 'postback',
      ts: Date.now(),
      click_id,
      payout: Number(payout) || 0,
      currency: currency || 'RUB',
      status: status || 'unknown',
      order_id: order_id || null,
      network: network || click?.network || null,
      offer_id: click?.offer_id || null,
      meta: click?.meta || null
    });
    await saveJSON(eventsPath, events);

    // Обновим статистику ротатора (если клик был из него)
    if (click?.meta?.rotator_key && click?.meta?.variant_id) {
      await recordPostback({
        rotatorKey: click.meta.rotator_key,
        variantId: click.meta.variant_id,
        status: status || 'unknown',
        payout: Number(payout) || 0
      });
    }

    // Телеграм-уведомление (не блокирующее)
    try {
      const msg =
        `✅ Postback: ${status || 'unknown'} ${payout || 0} ${currency || 'RUB'}\n` +
        `click_id ${click_id}\n` +
        `offer ${click?.offer_id || '?'} net ${network || click?.network || 'null'}\n` +
        (click?.meta?.variant_id ? `variant ${click.meta.variant_id}\n` : '');
      const token = process.env.TELEGRAM_BOT_TOKEN;
      const chat = process.env.TELEGRAM_CHAT_ID;
      if (token && chat) {
        await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ chat_id: chat, text: msg })
        });
      }
    } catch (err) {
      console.error('tg error', err.message);
    }

    res.send('OK');
  } catch (e) {
    console.error(e);
    res.status(500).send('error');
  }
});

export default router;
