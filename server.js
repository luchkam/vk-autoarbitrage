import express from 'express';
import morgan from 'morgan';
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';
import trackingRouter from './tracking/router.js';

dotenv.config();

const app = express();
app.use(express.json());
app.use(morgan('dev'));

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Статика для будущих прелендов (картинки/HTML)
app.use('/static', express.static(path.join(__dirname, 'public')));

// Трекинг: /click и /postback
app.use('/', trackingRouter);

app.get('/health', (req, res) => {
  res.json({ ok: true, time: new Date().toISOString() });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Server listening on ${PORT}`);
});
