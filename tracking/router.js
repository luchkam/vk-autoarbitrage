import express from 'express';
import { v4 as uuidv4 } from 'uuid';
import { saveClick, findClick, saveConversion } from './storage.js';
import offers from '../config/offers.json' with { type: 'json' };
import * as admitad from '../adapters/admitad.js';
import * as cityads from '../adapters/cityads.js';
import { sendAlert } from '../alerts/telegram.js';

const router = express.Router();

const adapters = { admitad, cityads };

function getOffer(offer_id) {
  return offers[offer_id];
}

router.get('/click', async (req, res) => {
  try {
    const { offer_id, target, campaign_id, ad_id, creative_id, dry } = req.query;
    if (!offer_id) return res.status(400).json({ error: 'offer_id is required' });

    const offer = getOffer(offer_id);
    if (!offer) return res.status(400).json({ error: `Unknown offer_id: ${offer_id}` });
    if (!target && offer.requiresTarget) return res.status(400).json({ error: 'target is required for this offer' });

    const click_id = uuidv4();
    const ip = req.headers['x-forwarded-for']?.split(',')[0] || req.socket.remoteAddress;
    const ua = req.headers['user-agent'] || '';

    const adapter = adapters[offer.network];
    if (!adapter?.buildDeepLink) return res.status(500).json({ error: `No adapter for network ${offer.network}` });

    const deeplink = adapter.buildDeepLink({ offer, target, subs: { sub1: click_id } });

    const click = {
      click_id,
      ts: Date.now(),
      offer_id,
      network: offer.network,
      campaign_id,
      ad_id,
      creative_id,
      ip,
      ua,
      deeplink
    };
    saveClick(click);

    if (dry === '1') return res.json({ ok: true, click_id, redirect_to: deeplink, note: 'dry run: no redirect' });

    return res.redirect(302, deeplink);
  } catch (e) {
    console.error(e);
    return res.status(500).json({ error: 'internal_error' });
  }
});

function verifyPostback(req) {
  const secret = process.env.POSTBACK_SECRET;
  const key = req.query.key || req.query.secret || '';
  return !!secret && key === secret;
}

router.get('/postback', async (req, res) => {
  try {
    if (!verifyPostback(req)) {
      await sendAlert(`🚫 Postback rejected (bad secret). IP: ${req.ip}`);
      return res.status(403).send('forbidden');
    }

    const { sub1, payout, currency, status, order_id, network } = req.query;
    if (!sub1) return res.status(400).send('missing sub1 (click_id)');

    const click = findClick(sub1);
    const normalized = {
      ts: Date.now(),
      click_id: sub1,
      payout: payout ? Number(payout) : 0,
      currency: currency || 'RUB',
      status: (status || 'pending').toLowerCase(),
      order_id: order_id || null,
      network: network || click?.network || null,
      raw: req.query
    };

    saveConversion(normalized);

    await sendAlert(
      `✅ Postback: ${normalized.status} ${normalized.payout} ${normalized.currency}\n` +
      `click_id ${sub1}\n` +
      `offer ${click?.offer_id || '?'} net ${normalized.network}`
    );

    res.status(200).send('OK');
  } catch (e) {
    console.error(e);
    res.status(500).send('internal_error');
  }
});

export default router;
