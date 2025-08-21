// oauth/vk.js
import express from 'express';
import crypto from 'crypto';

const router = express.Router();

// маленький хелпер
function need(name) {
  const v = process.env[name];
  if (!v) throw new Error(`ENV ${name} is required`);
  return v;
}

// base64url без '=' и с заменами
function b64url(input) {
  return Buffer.from(input)
    .toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/g, '');
}

// GET /oauth/vk/login?key=OAUTH_SETUP_SECRET
router.get('/oauth/vk/login', (req, res) => {
  try {
    const guard = req.query.key || '';
    if (guard !== need('OAUTH_SETUP_SECRET')) {
      return res.status(403).send('forbidden');
    }

    const clientId = need('VK_APP_ID');
    const redirectUri = need('VK_REDIRECT_URI');

    // PKCE
    const codeVerifier = b64url(crypto.randomBytes(32));
    const challenge = b64url(crypto.createHash('sha256').update(codeVerifier).digest());
    const state = b64url(crypto.randomBytes(16));

    // сохраним verifier/state в httpOnly-куки на 10 минут
    res.cookie('vk_pkce_verifier', codeVerifier, { httpOnly: true, maxAge: 10 * 60 * 1000, sameSite: 'lax' });
    res.cookie('vk_pkce_state', state, { httpOnly: true, maxAge: 10 * 60 * 1000, sameSite: 'lax' });

    const params = new URLSearchParams({
      client_id: clientId,
      response_type: 'code',
      scope: 'ads',
      redirect_uri: redirectUri,
      state,
      code_challenge: challenge,
      code_challenge_method: 'S256',
    });

    const authUrl = `https://id.vk.com/authorize?${params.toString()}`;
    return res.redirect(authUrl);
  } catch (e) {
    console.error(e);
    return res.status(500).send(e.message);
  }
});

// GET /oauth/vk/callback?code=...&state=...
router.get('/oauth/vk/callback', async (req, res) => {
  try {
    const clientId = need('VK_APP_ID');
    const clientSecret = need('VK_APP_SECRET');
    const redirectUri = need('VK_REDIRECT_URI');

    const { code = '', state = '' } = req.query;
    const cookieState = req.cookies?.vk_pkce_state || '';
    const codeVerifier = req.cookies?.vk_pkce_verifier || '';

    if (!code || !state || !codeVerifier || state !== cookieState) {
      return res.status(400).send('Invalid state or code');
    }

    // обмен кода на токены
    const body = new URLSearchParams({
      grant_type: 'authorization_code',
      client_id: clientId,
      client_secret: clientSecret,
      redirect_uri: redirectUri,
      code: String(code),
      code_verifier: codeVerifier,
    });

    const r = await fetch('https://id.vk.com/oauth2/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body,
    });
    const j = await r.json();

    if (j.error) {
      console.error('VK token error:', j);
      return res.status(400).send(`VK error: ${j.error_description || j.error}`);
    }

    // очистим куки
    res.clearCookie('vk_pkce_verifier');
    res.clearCookie('vk_pkce_state');

    // покажем красиво, что копировать в Render
    const html = `
      <pre style="font-size:14px; line-height:1.4; white-space:pre-wrap;">
VK_ACCESS_TOKEN = ${j.access_token}
VK_REFRESH_TOKEN = ${j.refresh_token || '(нет в ответе)'}
EXPIRES_IN = ${j.expires_in || 'unknown'} сек

Скопируй VK_ACCESS_TOKEN и (если есть) VK_REFRESH_TOKEN в Render → Environment.
Проверка: открой
/cron/pull-vk?key=ТВОЙ_CRON_SECRET
      </pre>`;
    return res.status(200).send(html);
  } catch (e) {
    console.error(e);
    return res.status(500).send(e.message);
  }
});

export default router;
