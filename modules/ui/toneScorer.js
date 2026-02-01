import { avg, sum, clamp, isFiniteNumber, toNumber, kgToLb, addDaysToKey } from "../utils.js";
import { windowDays } from "./insightsBuilder.js";

function clampToneScore(value, config) {
  const score = toToneScore(value, config);
  return isFiniteNumber(score) ? clamp(score, config.toneScoreMin, config.toneScoreMax) : null;
}

function toToneScore(value, config) {
  const num = toNumber(value);
  if (num === null) return null;
  return clamp(Math.round(num), config.toneScoreMin, config.toneScoreMax);
}

export function scoreSleepTone(dayByKey, dayKey, config) {
  const window = windowDays(dayByKey, dayKey, 7);
  const values = window.map((d) => d.sleep_hours).filter(isFiniteNumber);
  if (values.length === 0) return null;

  const avgSleep = avg(values);
  if (!isFiniteNumber(avgSleep)) return null;

  let score =
    avgSleep >= 7.6
      ? 88
      : avgSleep >= 7.0
        ? 78
        : avgSleep >= 6.5
          ? 68
          : avgSleep >= 6.0
            ? 55
            : avgSleep >= 5.5
              ? 40
              : 25;

  const shortCount = window.reduce((acc, d) => {
    const v = d.sleep_hours;
    return acc + (isFiniteNumber(v) && v < 6 ? 1 : 0);
  }, 0);
  if (shortCount >= 3) score -= 10;
  if (shortCount >= 5) score -= 8;

  return clampToneScore(score, config);
}

export function scoreStressTone(dayByKey, dayKey, config, computeStressForDay) {
  const prevDayKey = addDaysToKey(dayKey, -1);
  const stress = computeStressForDay(dayByKey, prevDayKey, config);
  return clampToneScore(stress?.score ?? null, config);
}

export function scoreExerciseTone(dayByKey, dayKey, config) {
  const window = windowDays(dayByKey, dayKey, 7);
  const mins = window.map((d) => d.workout_minutes).filter(isFiniteNumber);
  if (mins.length === 0) return null;
  const total = sum(mins);

  const score =
    total >= 210
      ? 88
      : total >= 150
        ? 78
        : total >= 90
          ? 62
          : total >= 45
            ? 48
            : total > 0
              ? 32
              : 20;
  return clampToneScore(score, config);
}

export function scoreNutritionTone(profileId, dayByKey, dayKey, config) {
  const day = dayByKey.get(dayKey) ?? null;
  const calories = day && isFiniteNumber(day.calories) ? day.calories : null;
  const protein = day && isFiniteNumber(day.protein_g) ? day.protein_g : null;
  const sugar = day && isFiniteNumber(day.sugar_g) ? day.sugar_g : null;
  if (calories === null && protein === null && sugar === null) return null;

  let score = 74;

  if (isFiniteNumber(protein)) {
    if (protein < 45) score -= 55;
    else if (protein < 60) score -= 42;
    else if (protein < 80) score -= 28;
    else if (protein < 110) score -= 14;
    else score += 6;
  } else {
    score -= 10;
  }

  if (isFiniteNumber(sugar)) {
    if (sugar > 90) score -= 28;
    else if (sugar > 70) score -= 18;
    else if (sugar > 55) score -= 10;
    else if (sugar > 40) score -= 6;
  }

  if (isFiniteNumber(calories)) {
    if (profileId === "weightloss-wally") {
      if (calories > 3000) score -= 32;
      else if (calories > 2700) score -= 22;
      else if (calories > 2450) score -= 14;
      else if (calories < 1700) score -= 10;
    } else if (profileId === "athlete-anna") {
      if (calories < 2300) score -= 10;
    } else {
      if (calories > 3400) score -= 12;
      else if (calories < 1600) score -= 12;
    }
  }

  if (profileId === "athlete-anna" && isFiniteNumber(calories) && isFiniteNumber(protein) && calories > 0) {
    const proteinPct = (protein * 4) / calories;
    if (proteinPct >= 0.27) score += 10;
    else if (proteinPct >= 0.23) score += 6;
    else if (proteinPct < 0.17) score -= 14;
    else if (proteinPct < 0.14) score -= 26;
  }

  if (profileId === "protein-paul" && isFiniteNumber(protein)) {
    if (protein < 55) score -= 14;
    if (protein < 45) score -= 10;
  }

  return clampToneScore(score, config);
}

export function scoreBpTone(dayByKey, dayKey, config, latestBpReading) {
  const window = windowDays(dayByKey, dayKey, 30);
  const latest = latestBpReading(window);
  if (!latest) return null;
  const sys = latest.systolic;
  const dia = latest.diastolic;

  let score = 80;
  if (sys >= config.stageHypertensionSystolic || dia >= config.stageHypertensionDiastolic) score = 18;
  else if (sys >= config.highBpSystolic || dia >= config.highBpDiastolic) score = 35;
  else if (sys >= config.elevatedBpSystolic || dia >= config.elevatedBpDiastolic) score = 55;
  else if (sys >= 120 && dia < config.elevatedBpDiastolic) score = 72;
  else score = 86;

  return clampToneScore(score, config);
}

export function scoreWeightTone(profileId, dayByKey, dayKey, config, weightHelpers) {
  const { firstNumberInDays, latestNumberInDays } = weightHelpers;
  const window = windowDays(dayByKey, dayKey, 30);
  const first = firstNumberInDays(window, "weight_kg");
  const latest = latestNumberInDays(window, "weight_kg");
  if (!first || !latest || !isFiniteNumber(first.value) || !isFiniteNumber(latest.value)) return null;

  const deltaLb = kgToLb(latest.value) - kgToLb(first.value);
  let score = 75;

  if (profileId === "weightloss-wally") {
    score = deltaLb <= -2.5 ? 86 : deltaLb <= -1.0 ? 76 : deltaLb <= 0.5 ? 64 : 48;
  } else {
    const abs = Math.abs(deltaLb);
    score = abs < 2 ? 80 : abs < 4 ? 68 : abs < 7 ? 54 : 40;
  }

  return clampToneScore(score, config);
}

export function computeLocalToneScores(profileId, dayKey, model, options) {
  const { CONFIG, computeStressForDay, latestBpReading, weightHelpers } = options;
  const days = Array.isArray(model?.days) ? model.days : [];
  const dayByKey = new Map(days.map((d) => [d.dayKey, d]));

  const sleep = scoreSleepTone(dayByKey, dayKey, CONFIG);
  const stress = scoreStressTone(dayByKey, dayKey, CONFIG, computeStressForDay);
  const exercise = scoreExerciseTone(dayByKey, dayKey, CONFIG);
  const nutrition = scoreNutritionTone(profileId, dayByKey, dayKey, CONFIG);
  const bp = scoreBpTone(dayByKey, dayKey, CONFIG, latestBpReading);
  const weight = scoreWeightTone(profileId, dayByKey, dayKey, CONFIG, weightHelpers);

  const components = [sleep, stress, exercise, nutrition, bp, weight].filter(isFiniteNumber);
  const overall = components.length > 0 ? clampToneScore(avg(components), CONFIG) : null;

  return { overall, sleep, stress, exercise, nutrition, bp, weight };
}

export function applyLocalToneScores(profileId, dayKey, model, insights, options) {
  const { isPlainObject } = options;
  if (!isPlainObject(insights)) return insights;
  const scores = computeLocalToneScores(profileId, dayKey, model, options);
  const withTone = (block, score) => {
    if (!isPlainObject(block)) return block;
    if (!isFiniteNumber(score)) return { ...block, toneScore: null, toneDayKey: null };
    return { ...block, toneScore: score, toneDayKey: dayKey };
  };

  return {
    overall: withTone(insights.overall, scores.overall),
    sleep: withTone(insights.sleep, scores.sleep),
    stress: withTone(insights.stress, scores.stress),
    exercise: withTone(insights.exercise, scores.exercise),
    nutrition: withTone(insights.nutrition, scores.nutrition),
    bp: withTone(insights.bp, scores.bp),
    weight: withTone(insights.weight, scores.weight),
  };
}
