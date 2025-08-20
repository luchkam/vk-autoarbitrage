import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const DATA_PATH = path.join(__dirname, '..', 'data', 'events.json');

function ensureFile() {
  const dir = path.dirname(DATA_PATH);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  if (!fs.existsSync(DATA_PATH)) fs.writeFileSync(DATA_PATH, JSON.stringify({ clicks: [], conversions: [] }, null, 2));
}

export function saveClick(click) {
  ensureFile();
  const db = JSON.parse(fs.readFileSync(DATA_PATH, 'utf8'));
  db.clicks.push(click);
  fs.writeFileSync(DATA_PATH, JSON.stringify(db, null, 2));
}

export function findClick(click_id) {
  ensureFile();
  const db = JSON.parse(fs.readFileSync(DATA_PATH, 'utf8'));
  return db.clicks.find(c => c.click_id === click_id);
}

export function saveConversion(conv) {
  ensureFile();
  const db = JSON.parse(fs.readFileSync(DATA_PATH, 'utf8'));
  db.conversions.push(conv);
  fs.writeFileSync(DATA_PATH, JSON.stringify(db, null, 2));
}
