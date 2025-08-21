// oauth/vk.js
import express from 'express';
import crypto from 'crypto';

const router = express.Router();

function need(name) {
  const v = process.env[name];
  if (!v) throw new Error(`ENV ${name} is required`);
  return v;
}

function b64url(input) {
  return Buffer.from(input)
    .toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/g, '');
}

// === Шаг 1. Старт авторизации (PKCE) ===
router.get('/oauth/vk/login', (req, res) => {
  try {
    const guard = req.query.key || '';
    if (guard !== need('OAUTH_SETUP_SECRET')) return res.status(403).send('forbidden');

    const clientId    = need('VK_APP_ID');
    const redirectUri = need('VK_REDIRECT_URI');

    const codeVerifier = b64url(crypto.randomBytes(32));
    const challenge    = b64url(crypto.createHash('sha256').update(codeVerifier).digest());
    const state        = b64url(crypto.randomBytes(16));

    // PKCE + anti-CSRF
    res.cookie('vk_pkce_verifier', codeVerifier, { httpOnly: true, maxAge: 10 * 60 * 1000, sameSite: 'lax' });
    res.cookie('vk_pkce_state',    state,        { httpOnly: true, maxAge: 10 * 60 * 1000, sameSite: 'lax' });

    const params = new URLSearchParams({
      client_id: clientId,
      response_type: 'code',
      scope: 'ads',                 // токен с доступом к Ads API
      redirect_uri: redirectUri,
      state,
      code_challenge: challenge,
      code_challenge_method: 'S256',
    });

    // Авторизация OAuth VK ID
    const authUrl = `https://id.vk.com/authorize?${params}`;
    return res.redirect(authUrl);
  } catch (e) {
    console.error(e);
    return res.status(500).send(e.message);
  }
});

// === Шаг 2. Колбэк: обмен code (+device_id!) на токены ===
router.get('/oauth/vk/callback', async (req, res) => {
  try {
    const clientId     = need('VK_APP_ID');
    const clientSecret = need('VK_APP_SECRET');   // для web-приложений допустим
    const redirectUri  = need('VK_REDIRECT_URI');

    const { code = '', state = '', device_id = '' } = req.query;
    const cookieState    = req.cookies?.vk_pkce_state || '';
    const codeVerifier   = req.cookies?.vk_pkce_verifier || '';

    if (!code || !state || state !== cookieState || !codeVerifier) {
      return res.status(400).send('Invalid state or code');
    }

    // ВАЖНО: device_id должен прийти из колбэка и уйти в обмен
    if (!device_id) {
      return res.status(400).send('Missing device_id from VK callback');
    }

    const form = new URLSearchParams({
      grant_type: 'authorization_code',
      client_id: clientId,
      client_secret: clientSecret,     // если получите invalid_client — временно уберите эту строку
      redirect_uri: redirectUri,
      code: String(code),
      code_verifier: codeVerifier,
      device_id: String(device_id),
    });

    // Правильный токен-эндпоинт VK ID OAuth 2.1
    const r = await fetch('https://id.vk.com/oauth2/auth', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        'Accept': 'application/json',
      },
      body: form
    });

    const text = await r.text();
    let j; try { j = JSON.parse(text); } catch { j = null; }

    if (!r.ok) {
      return res.status(400).send(
        `VK token endpoint error: HTTP ${r.status} Body (first 1000 chars): ${text.slice(0,1000)}`
      );
    }
    if (!j || (j.error && !j.access_token)) {
      return res.status(400).send(
        `VK error: ${j?.error_description || j?.error || 'unknown'}\nRaw:\n${text.slice(0,1000)}`
      );
    }

    // Чистим PKCE-куки
    res.clearCookie('vk_pkce_verifier');
    res.clearCookie('vk_pkce_state');

    // Показываем, что положить в Render
    return res.status(200).send(
`<pre style="font-size:14px;line-height:1.4;white-space:pre-wrap;">
VK_ACCESS_TOKEN = ${j.access_token}
VK_REFRESH_TOKEN = ${j.refresh_token || '(нет в ответе)'}
EXPIRES_IN      = ${j.expires_in || 'unknown'} сек

Скопируй VK_ACCESS_TOKEN (и при наличии VK_REFRESH_TOKEN) в Render → Environment.
Для теста запросов к Ads API можно дернуть:
/cron/pull-vk?key=ТВОЙ_CRON_SECRET
</pre>`
    );
  } catch (e) {
    console.error(e);
    return res.status(500).send(e.message);
  }
});

export default router;
