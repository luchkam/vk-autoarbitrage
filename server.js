import express from 'express';
import morgan from 'morgan';
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';
import trackingRouter from './tracking/router.js';
import cronVkRouter from './cron/vk.js';
import cookieParser from 'cookie-parser';
import vkOauthRouter from './oauth/vk.js';

dotenv.config();

const app = express();
app.use(express.json());
app.use(morgan('dev'));
app.use(cookieParser());

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Статика для будущих прелендов (картинки/HTML)
app.use('/static', express.static(path.join(__dirname, 'public')));

app.get('/', (req, res) => {
  res.type('html').send(`
<!doctype html><html><head>
<meta name="verify-admitad" content="9f4abf99af" />
<meta charset="utf-8">
<title>OK</title>
</head><body>OK</body></html>`);
});

// Трекинг: /click и /postback
app.use('/', trackingRouter);
app.use('/', cronVkRouter);
app.use('/', vkOauthRouter);

app.get('/health', (req, res) => {
  res.json({ ok: true, time: new Date().toISOString() });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Server listening on ${PORT}`);
});
