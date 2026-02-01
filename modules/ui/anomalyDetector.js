import { avg, median, stddev, isFiniteNumber } from "../utils.js";

export function computeRollingStats(values, lookbackDays, config) {
  const means = new Array(values.length).fill(null);
  const sds = new Array(values.length).fill(null);

  for (let i = 0; i < values.length; i += 1) {
    const window = [];
    const start = Math.max(0, i - lookbackDays);
    for (let j = start; j < i; j += 1) {
      const v = values[j];
      if (typeof v === "number" && Number.isFinite(v)) window.push(v);
    }

    if (window.length < config.baselineMinPoints) continue;
    const mean = avg(window);
    let variance = 0;
    for (const v of window) variance += (v - mean) ** 2;
    variance /= window.length;
    const sd = Math.sqrt(variance);

    means[i] = mean;
    sds[i] = sd;
  }

  return { means, sds };
}

export function detectZScoreAnomalies(values, config) {
  const { means, sds } = computeRollingStats(values, config.baselineLookbackDays, config);
  const anomalyIndices = new Set();

  for (let i = 0; i < values.length; i += 1) {
    const v = values[i];
    const mean = means[i];
    const sd = sds[i];
    if (typeof v !== "number" || typeof mean !== "number" || typeof sd !== "number") continue;
    if (sd === 0) continue;
    const z = (v - mean) / sd;
    if (Math.abs(z) >= config.zScoreThreshold) anomalyIndices.add(i);
  }

  return { anomalyIndices, means, sds };
}

export function detectRhrStreak(days, config) {
  const values = days.map((d) => d.rhr_bpm);
  const numeric = values.filter((v) => typeof v === "number" && Number.isFinite(v));
  if (numeric.length < config.baselineMinPoints) return { qualifying: [] };

  const baselineMedian = median(numeric);
  const absDevs = numeric.map((v) => Math.abs(v - baselineMedian));
  const mad = median(absDevs);
  let robustSd = mad * 1.4826;
  if (!Number.isFinite(robustSd) || robustSd === 0) {
    robustSd = stddev(numeric);
  }
  if (!Number.isFinite(robustSd) || robustSd === 0) return { qualifying: [] };

  const threshold = baselineMedian + config.rhrElevationSd * robustSd;

  let streakStart = null;
  let streakLen = 0;
  const streaks = [];

  for (let i = 0; i < values.length; i += 1) {
    const v = values[i];
    const elevated = typeof v === "number" && Number.isFinite(v) ? v >= threshold : false;
    if (elevated) {
      if (streakStart === null) streakStart = i;
      streakLen += 1;
    } else {
      if (streakLen > 0) streaks.push({ start: streakStart, end: i - 1, len: streakLen });
      streakStart = null;
      streakLen = 0;
    }
  }
  if (streakLen > 0) streaks.push({ start: streakStart, end: values.length - 1, len: streakLen });

  const qualifying = streaks.filter((s) => s.len >= config.rhrStreakDays);
  return { qualifying, threshold, baselineMedian, robustSd };
}
