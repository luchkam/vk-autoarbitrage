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

// === Шаг 1: Старт авторизации (PKCE) ===
router.get('/oauth/vk/login', (req, res) => {
  try {
    const guard = req.query.key || '';
    if (guard !== need('OAUTH_SETUP_SECRET')) return res.status(403).send('forbidden');

    const clientId = need('VK_APP_ID');
    const redirectUri = need('VK_REDIRECT_URI');

    const codeVerifier = b64url(crypto.randomBytes(32));
    const challenge = b64url(crypto.createHash('sha256').update(codeVerifier).digest());
    const state = b64url(crypto.randomBytes(16));

    // PKCE + CSRF
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

    // OAuth 2.1 авторизация VK ID
    const authUrl = `https://id.vk.com/authorize?${params}`;
    return res.redirect(authUrl);
  } catch (e) {
    console.error(e);
    return res.status(500).send(e.message);
  }
});

// Вспомогательная: POST x-www-form-urlencoded и вернуть {ok, json, text, status}
async function postForm(url, form) {
  const r = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      'Accept': 'application/json',
      'User-Agent': 'vk-autoarbitrage/1.0',
    },
    body: form
  });
  const text = await r.text();
  let json = null;
  try { json = JSON.parse(text); } catch { /* может прийти HTML, оставим text */ }
  return { ok: r.ok, status: r.status, json, text };
}

// === Шаг 2: Приём code и обмен на токены ===
router.get('/oauth/vk/callback', async (req, res) => {
  try {
    const clientId = need('VK_APP_ID');
    const clientSecret = need('VK_APP_SECRET'); // для Web разрешён
    const redirectUri = need('VK_REDIRECT_URI');

    const { code = '', state = '' } = req.query;
    const cookieState = req.cookies?.vk_pkce_state || '';
    const codeVerifier = req.cookies?.vk_pkce_verifier || '';

    if (!code || !state || !codeVerifier || state !== cookieState) {
      return res.status(400).send('Invalid state or code');
    }

    // Готовим форму для VK ID (OAuth 2.1)
    const baseForm = new URLSearchParams({
      grant_type: 'authorization_code',
      client_id: clientId,
      client_secret: clientSecret,
      redirect_uri: redirectUri,
      code: String(code),
      code_verifier: codeVerifier,
    });

    // 1) Основной endpoint VK ID
    const PRIMARY_TOKEN_URL = 'https://id.vk.com/oauth2/auth';
    let resp = await postForm(PRIMARY_TOKEN_URL, baseForm);

    // Если не ок/нет JSON/нет access_token — пробуем «наследный» endpoint
    if (!resp.ok || !resp.json || (!resp.json.access_token && !resp.json.token)) {
      console.warn('Primary token endpoint failed:', resp.status, (resp.text || '').slice(0, 300));

      const LEGACY_TOKEN_URL = 'https://oauth.vk.com/access_token';
      const legacyForm = new URLSearchParams({
        client_id: clientId,
        client_secret: clientSecret,
        redirect_uri: redirectUri,
        code: String(code),
        // code_verifier старый endpoint может игнорировать — оставляем только базовые поля
      });

      resp = await postForm(LEGACY_TOKEN_URL, legacyForm);
    }

    // Итоговая проверка
    if (!resp.ok || !resp.json) {
      return res
        .status(400)
        .send(
          `VK token endpoint error:
HTTP ${resp.status}
Body (first 1000 chars):
${(resp.text || '').slice(0, 1000)}`
        );
    }

    const j = resp.json;
    const accessToken = j.access_token || j.token; // вдруг поле называется иначе
    if (!accessToken) {
      return res
        .status(400)
        .send(
          `VK error: no access_token in response
Raw (first 1000):
${(resp.text || '').slice(0, 1000)}`
        );
    }

    // Убираем PKCE-куки
    res.clearCookie('vk_pkce_verifier');
    res.clearCookie('vk_pkce_state');

    // Выводим пользователю что скопировать
    const html = `
<pre style="font-size:14px;line-height:1.4;white-space:pre-wrap;">
VK_ACCESS_TOKEN = ${accessToken}
VK_REFRESH_TOKEN = ${j.refresh_token || '(нет в ответе)'}
EXPIRES_IN      = ${j.expires_in || 'unknown'} сек

Скопируй VK_ACCESS_TOKEN и (если есть) VK_REFRESH_TOKEN в Render → Environment.
Для проверки вызови:
/cron/pull-vk?key=ТВОЙ_CRON_SECRET
</pre>`;
    return res.status(200).send(html);
  } catch (e) {
    console.error(e);
    return res.status(500).send(e.message);
  }
});

export default router;
