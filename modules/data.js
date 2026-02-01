import {
  addDaysToKey,
  avg,
  formatDayKey,
  isFiniteNumber,
  isPlainObject,
  lbToKg,
  toNumber,
  validateTimeZone,
} from "./utils.js";

function parseDate(value) {
  if (typeof value !== "string") return null;
  const dt = new Date(value);
  return Number.isFinite(dt.getTime()) ? dt : null;
}

function normalizeSleepStages(raw) {
  if (!isPlainObject(raw)) return null;
  const awake = toNumber(raw.awake ?? raw.wake);
  const rem = toNumber(raw.rem);
  const light = toNumber(raw.light ?? raw.core);
  const deep = toNumber(raw.deep);

  const hasAny = [awake, rem, light, deep].some((v) => isFiniteNumber(v) && v > 0);
  if (!hasAny) return null;

  return {
    awake: awake === null ? null : Math.max(0, awake),
    rem: rem === null ? null : Math.max(0, rem),
    light: light === null ? null : Math.max(0, light),
    deep: deep === null ? null : Math.max(0, deep),
  };
}

function pickPrimarySleepSession(sessions) {
  if (!Array.isArray(sessions) || sessions.length === 0) return null;
  let best = null;
  for (const s of sessions) {
    if (!s?.start || !s?.end) continue;
    const durationMin =
      typeof s.durationMin === "number" && Number.isFinite(s.durationMin)
        ? s.durationMin
        : (s.end.getTime() - s.start.getTime()) / 60000;
    if (!Number.isFinite(durationMin) || durationMin <= 0) continue;
    if (!best) {
      best = { ...s, durationMin };
      continue;
    }
    if (durationMin > best.durationMin) {
      best = { ...s, durationMin };
      continue;
    }
    if (durationMin === best.durationMin && s.start < best.start) {
      best = { ...s, durationMin };
    }
  }
  return best;
}

function latestSample(samples) {
  if (!samples || samples.length === 0) return null;
  let latest = samples[0];
  for (let i = 1; i < samples.length; i += 1) {
    if (samples[i].t > latest.t) latest = samples[i];
  }
  return latest;
}

export function normalizePayload(raw) {
  if (Array.isArray(raw)) {
    return { user: {}, records: raw };
  }
  if (isPlainObject(raw)) {
    const records = Array.isArray(raw.records) ? raw.records : null;
    if (!records) return null;
    const user = isPlainObject(raw.user) ? raw.user : {};
    return { user, records };
  }
  return null;
}

function checkRecordsSortOrder(normalized) {
  if (normalized.length < 2) return;

  let outOfOrderCount = 0;
  for (let i = 1; i < normalized.length; i += 1) {
    const prevRec = normalized[i - 1];
    const currRec = normalized[i];
    const prevTime = prevRec.timestamp ?? prevRec.start ?? prevRec.end;
    const currTime = currRec.timestamp ?? currRec.start ?? currRec.end;
    if (prevTime && currTime && currTime < prevTime) {
      outOfOrderCount += 1;
    }
  }

  const outOfOrderPct = outOfOrderCount / (normalized.length - 1);
  if (outOfOrderPct > 0.1) {
    console.warn(
      `[data.js] Records appear unsorted: ${outOfOrderCount}/${normalized.length - 1} (${(outOfOrderPct * 100).toFixed(1)}%) are out of timestamp order. Consider sorting records chronologically for consistent results.`
    );
  }
}

export function normalizeAndValidateRecords(records) {
  const errors = [];
  const normalized = [];
  const sources = new Set();

  for (let i = 0; i < records.length; i += 1) {
    const rec = records[i];
    if (!isPlainObject(rec)) {
      errors.push(`Record #${i + 1}: expected an object.`);
      continue;
    }
    const type = typeof rec.type === "string" ? rec.type : "";
    if (!type) {
      errors.push(`Record #${i + 1}: missing required field "type".`);
      continue;
    }

    const data = isPlainObject(rec.data) ? rec.data : null;
    if (!data) {
      errors.push(`Record #${i + 1} (${type}): missing required field "data".`);
      continue;
    }

    const timestamp = parseDate(rec.timestamp);
    const start = parseDate(rec.start);
    const end = parseDate(rec.end);

    if (!timestamp && !(start && end)) {
      errors.push(`Record #${i + 1} (${type}): provide either "timestamp" or both "start" and "end".`);
      continue;
    }
    if (start && end && end <= start) {
      errors.push(`Record #${i + 1} (${type}): "end" must be after "start".`);
      continue;
    }

    const source = typeof rec.source === "string" && rec.source ? rec.source : "Unknown";
    sources.add(source);

    normalized.push({
      type,
      data,
      source,
      timestamp,
      start,
      end,
      _index: i,
    });
  }

  checkRecordsSortOrder(normalized);

  return { normalized, errors, sources };
}

export function aggregateDaily(records, timeZone, { fallbackTimeZone = "UTC" } = {}) {
  const dayMap = new Map();

  function getDay(dayKey) {
    let day = dayMap.get(dayKey);
    if (!day) {
      day = {
        dayKey,
        sleepMinutes: 0,
        sleepQualities: [],
        sleepSessions: [],
        sugar_g: 0,
        calories: 0,
        carbs_g: 0,
        protein_g: 0,
        fat_g: 0,
        steps: 0,
        workout_minutes: 0,
        workout_calories: 0,
        workout_load: 0,
        workoutByActivity: new Map(),
        rhrSamples: [],
        weightSamples: [],
        bpSamples: [],
      };
      dayMap.set(dayKey, day);
    }
    return day;
  }

  for (const rec of records) {
    if (rec.type === "sleep_session") {
      if (!rec.start || !rec.end) continue;
      const durationMin = (rec.end.getTime() - rec.start.getTime()) / 60000;
      const dayKey = formatDayKey(rec.end, timeZone, fallbackTimeZone);
      const day = getDay(dayKey);
      day.sleepMinutes += durationMin;
      const q = toNumber(rec.data.quality);
      if (q !== null) day.sleepQualities.push(q);
      const respirationRpm = toNumber(rec.data.respiration_rpm);
      const stages = normalizeSleepStages(rec.data.stages_min ?? rec.data.stages);
      day.sleepSessions.push({
        start: rec.start,
        end: rec.end,
        durationMin,
        quality: q,
        respiration_rpm: respirationRpm,
        stages_min: stages,
        source: rec.source,
      });
      continue;
    }

    const t = rec.timestamp || rec.start || rec.end;
    if (!t) continue;
    const dayKey = formatDayKey(t, timeZone, fallbackTimeZone);
    const day = getDay(dayKey);

    switch (rec.type) {
      case "nutrition": {
        const calories = toNumber(rec.data.calories);
        const carbs = toNumber(rec.data.carbs_g);
        const protein = toNumber(rec.data.protein_g);
        const fat = toNumber(rec.data.fat_g);
        const sugar = toNumber(rec.data.sugar_g);
        if (calories !== null) day.calories += calories;
        if (carbs !== null) day.carbs_g += carbs;
        if (protein !== null) day.protein_g += protein;
        if (fat !== null) day.fat_g += fat;
        if (sugar !== null) day.sugar_g += sugar;
        break;
      }
      case "steps": {
        const count = toNumber(rec.data.count);
        if (count !== null) day.steps += count;
        break;
      }
      case "workout": {
        const activity =
          typeof rec.data.activity === "string" && rec.data.activity.trim() ? rec.data.activity.trim() : "Workout";
        const intensity = typeof rec.data.intensity === "string" ? rec.data.intensity : "moderate";
        const intensityFactor = intensity === "hard" ? 1.35 : intensity === "easy" ? 0.8 : 1.0;
        const durationMin =
          toNumber(rec.data.duration_min) ?? (rec.start && rec.end ? (rec.end.getTime() - rec.start.getTime()) / 60000 : null);
        const calories = toNumber(rec.data.calories);
        if (durationMin !== null) day.workout_minutes += durationMin;
        if (calories !== null) day.workout_calories += calories;
        if (durationMin !== null) day.workout_load += durationMin * intensityFactor;

        if (durationMin !== null) {
          const existing = day.workoutByActivity.get(activity) ?? {
            duration_min: 0,
            calories: 0,
            hasCalories: false,
          };
          existing.duration_min += durationMin;
          if (calories !== null) {
            existing.calories += calories;
            existing.hasCalories = true;
          }
          day.workoutByActivity.set(activity, existing);
        }
        break;
      }
      case "resting_heart_rate": {
        const bpm = toNumber(rec.data.bpm);
        if (bpm !== null) day.rhrSamples.push(bpm);
        break;
      }
      case "weight": {
        let kg = toNumber(rec.data.kg);
        if (kg === null) {
          const lb = toNumber(rec.data.lb);
          if (lb !== null) kg = lbToKg(lb);
        }
        if (kg !== null && rec.timestamp) day.weightSamples.push({ t: rec.timestamp, kg });
        break;
      }
      case "blood_pressure": {
        const systolic = toNumber(rec.data.systolic);
        const diastolic = toNumber(rec.data.diastolic);
        if (systolic !== null && diastolic !== null && rec.timestamp) {
          day.bpSamples.push({ t: rec.timestamp, systolic, diastolic });
        }
        break;
      }
      default:
        break;
    }
  }

  const dayKeys = [...dayMap.keys()].sort();
  if (dayKeys.length === 0) return { days: [], minDayKey: null, maxDayKey: null };

  const minDayKey = dayKeys[0];
  const maxDayKey = dayKeys[dayKeys.length - 1];

  const fullKeys = [];
  for (let k = minDayKey; k <= maxDayKey; k = addDaysToKey(k, 1)) fullKeys.push(k);

  const days = fullKeys.map((dayKey) => {
    const day = dayMap.get(dayKey) ?? getDay(dayKey);

    const sleep_hours = day.sleepMinutes > 0 ? day.sleepMinutes / 60 : null;
    const sleep_quality = day.sleepQualities.length > 0 ? avg(day.sleepQualities) : null;
    const sleep_primary = pickPrimarySleepSession(day.sleepSessions);
    const rhr_bpm = day.rhrSamples.length > 0 ? avg(day.rhrSamples) : null;
    const weight_kg = latestSample(day.weightSamples)?.kg ?? null;
    const bp_systolic =
      day.bpSamples.length > 0 ? avg(day.bpSamples.map((s) => s.systolic).filter(isFiniteNumber)) : null;
    const bp_diastolic =
      day.bpSamples.length > 0 ? avg(day.bpSamples.map((s) => s.diastolic).filter(isFiniteNumber)) : null;
    const workout_by_activity = [...day.workoutByActivity.entries()]
      .map(([activity, entry]) => ({
        activity,
        duration_min: entry.duration_min,
        calories: entry.hasCalories ? entry.calories : null,
      }))
      .filter((e) => isFiniteNumber(e.duration_min) && e.duration_min > 0);

    return {
      dayKey,
      sleep_hours,
      sleep_minutes: day.sleepMinutes > 0 ? day.sleepMinutes : null,
      sleep_quality,
      sleep_primary,
      sugar_g: day.sugar_g > 0 ? day.sugar_g : null,
      calories: day.calories > 0 ? day.calories : null,
      carbs_g: day.carbs_g > 0 ? day.carbs_g : null,
      protein_g: day.protein_g > 0 ? day.protein_g : null,
      fat_g: day.fat_g > 0 ? day.fat_g : null,
      steps: day.steps > 0 ? day.steps : null,
      workout_minutes: day.workout_minutes > 0 ? day.workout_minutes : null,
      workout_calories: day.workout_calories > 0 ? day.workout_calories : null,
      workout_load: day.workout_load > 0 ? day.workout_load : null,
      workout_by_activity,
      rhr_bpm,
      weight_kg,
      bp_systolic,
      bp_diastolic,
    };
  });

  return { days, minDayKey, maxDayKey };
}
