export const thresholds = {
  CTR_MIN: Number(process.env.CTR_MIN || 0.008),
  CPL_MAX_FACTOR: Number(process.env.CPL_MAX_FACTOR || 0.4), // 0.4×выплаты
  CLICKS_WITHOUT_ACTION: Number(process.env.CLICKS_WITHOUT_ACTION || 50)
};

// Здесь позже реализуем расчёт KPI и решения (pause/scale)
export function evaluateCreative(/* { clicks, impressions, conversions, spend, payout } */) {
  return { actions: [], reasons: [] };
}
