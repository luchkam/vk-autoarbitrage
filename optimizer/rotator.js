import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.join(__dirname, '..');
const dataDir = path.join(rootDir, 'data');
const statsPath = path.join(dataDir, 'rotator-stats.json');
const rotatorsPath = path.join(rootDir, 'config', 'rotators.json');

async function ensureFiles() {
  await fs.mkdir(dataDir, { recursive: true });
  try { await fs.access(statsPath); } catch { await fs.writeFile(statsPath, '{}'); }
}

async function loadJSON(p) {
  try { return JSON.parse(await fs.readFile(p, 'utf8') || '{}'); }
  catch { return {}; }
}
async function saveJSON(p, obj) {
  await fs.writeFile(p, JSON.stringify(obj, null, 2));
}

export async function chooseTargetForClick(rotatorKey) {
  await ensureFiles();
  const cfgAll = await loadJSON(rotatorsPath);
  const rotor = cfgAll[rotatorKey];
  if (!rotor) throw new Error(`rotator ${rotatorKey} not found`);
  const variants = rotor.variants;

  const statsAll = await loadJSON(statsPath);
  const s = statsAll[rotatorKey] || {};

  // Warmup: по кругу первые 10 кликов на вариант
  const totalClicks = Object.values(s).reduce((a, v) => a + (v.clicks || 0), 0);
  if (totalClicks < variants.length * 10) {
    const idx = totalClicks % variants.length;
    const v = variants[idx];
    return { variant_id: v.id, target: v.target };
  }

  // epsilon-greedy: 20% — случайно, 80% — лучший EPC
  const epsilon = 0.2;
  if (Math.random() < epsilon) {
    const v = variants[Math.floor(Math.random() * variants.length)];
    return { variant_id: v.id, target: v.target };
  }

  let best = variants[0], bestEPC = -Infinity;
  for (const v of variants) {
    const vs = s[v.id] || {};
    const epc = (vs.revenue_approved || 0) / Math.max(1, vs.clicks || 0);
    if (epc > bestEPC) { bestEPC = epc; best = v; }
  }
  return { variant_id: best.id, target: best.target };
}

export async function recordClick(rotatorKey, variantId) {
  await ensureFiles();
  const statsAll = await loadJSON(statsPath);
  statsAll[rotatorKey] = statsAll[rotatorKey] || {};
  statsAll[rotatorKey][variantId] = statsAll[rotatorKey][variantId] || {};
  statsAll[rotatorKey][variantId].clicks = (statsAll[rotatorKey][variantId].clicks || 0) + 1;
  await saveJSON(statsPath, statsAll);
}

export async function recordPostback({ rotatorKey, variantId, status, payout }) {
  await ensureFiles();
  const statsAll = await loadJSON(statsPath);
  statsAll[rotatorKey] = statsAll[rotatorKey] || {};
  statsAll[rotatorKey][variantId] = statsAll[rotatorKey][variantId] || {};
  statsAll[rotatorKey][variantId].actions = (statsAll[rotatorKey][variantId].actions || 0) + 1;
  if (status === 'approved') {
    statsAll[rotatorKey][variantId].approved = (statsAll[rotatorKey][variantId].approved || 0) + 1;
    statsAll[rotatorKey][variantId].revenue_approved =
      (statsAll[rotatorKey][variantId].revenue_approved || 0) + (Number(payout) || 0);
  }
  await saveJSON(statsPath, statsAll);
}
