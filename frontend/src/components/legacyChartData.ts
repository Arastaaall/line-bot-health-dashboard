export const LEGACY_RADAR_LABELS = [
  'たんぱく質',
  '脂質',
  '炭水化物',
  '食物繊維',
  'ビタミン類',
  '亜鉛',
  'マグネシウム',
  '塩分(ナトリウム)',
] as const;

type LegacyStats = {
  avgProtein?: number;
  avgFat?: number;
  avgCarbs?: number;
  avgFiber?: number;
  avgVitamins?: number;
  avgZinc?: number;
  avgMagnesium?: number;
  avgSodium?: number;
};

type LegacyIdeal = {
  protein?: number;
  fat?: number;
  carbs?: number;
  fiber?: number;
  vitamins?: number;
  zinc?: number;
  magnesium?: number;
  sodium?: number;
};

function numberOrZero(value: unknown) {
  const number = Number(value);
  return Number.isFinite(number) ? number : 0;
}

function targetPercent(value: unknown, target: unknown) {
  const targetValue = numberOrZero(target);
  if (targetValue <= 0) return 0;
  return Math.round((numberOrZero(value) / targetValue) * 100);
}

/**
 * Legacy renderRadarChartと同じ軸順・正規化方法。
 * 欠損時に旧テンプレートのダミー値を補わず、現在値なしは0%とする。
 */
export function legacyRadarValues(stats: LegacyStats, ideal: LegacyIdeal) {
  return [
    targetPercent(stats.avgProtein, ideal.protein),
    targetPercent(stats.avgFat, ideal.fat),
    targetPercent(stats.avgCarbs, ideal.carbs),
    targetPercent(stats.avgFiber, ideal.fiber),
    numberOrZero(stats.avgVitamins),
    targetPercent(stats.avgZinc, ideal.zinc),
    targetPercent(stats.avgMagnesium, ideal.magnesium),
    targetPercent(stats.avgSodium, ideal.sodium),
  ];
}

