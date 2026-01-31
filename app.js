(() => {
  "use strict";

  const CONFIG = {
    shortSleepHours: 6,
    minDaysForCorrelation: 6,
    baselineLookbackDays: 14,
    baselineMinPoints: 5,
    zScoreThreshold: 2.0,
    rhrElevationSd: 1.5,
    rhrStreakDays: 3,
  };

  const METRICS = {
    sleep_hours: { label: "Sleep", unit: "h", kind: "bar", color: "#5856D6" }, // systemIndigo
    sugar_g: { label: "Sugar", unit: "g", kind: "bar", color: "#FF2D55" }, // systemPink
    workout_load: { label: "Training load", unit: "au", kind: "line", color: "#FF9500" }, // systemOrange
    rhr_bpm: { label: "Resting HR", unit: "bpm", kind: "line", color: "#FF3B30" }, // systemRed
    weight_kg: { label: "Weight", unit: "kg", kind: "line", color: "#34C759" }, // systemGreen
    steps: { label: "Steps", unit: "steps", kind: "line", color: "#5AC8FA" }, // systemTeal
    calories: { label: "Calories", unit: "kcal", kind: "line", color: "#AF52DE" }, // systemPurple
    protein_g: { label: "Protein", unit: "g", kind: "line", color: "#007AFF" }, // systemBlue
  };

  const dom = {
    tzPill: document.getElementById("tzPill"),
    statusPill: document.getElementById("statusPill"),
    fileInput: document.getElementById("fileInput"),
    jsonInput: document.getElementById("jsonInput"),
    loadSampleBtn: document.getElementById("loadSampleBtn"),
    analyzeBtn: document.getElementById("analyzeBtn"),
    clearBtn: document.getElementById("clearBtn"),
    errors: document.getElementById("errors"),
    rangeValue: document.getElementById("rangeValue"),
    daysValue: document.getElementById("daysValue"),
    recordsValue: document.getElementById("recordsValue"),
    sourcesValue: document.getElementById("sourcesValue"),
    coverageValue: document.getElementById("coverageValue"),
    topStoryValue: document.getElementById("topStoryValue"),
    storyList: document.getElementById("storyList"),
    insightFeed: document.getElementById("insightFeed"),
    correlationTables: document.getElementById("correlationTables"),
    tooltip: document.getElementById("tooltip"),
    charts: {
      sleep: document.getElementById("chartSleep"),
      sugar: document.getElementById("chartSugar"),
      load: document.getElementById("chartLoad"),
      rhr: document.getElementById("chartRhr"),
      weight: document.getElementById("chartWeight"),
    },
  };

  const DEFAULT_TZ =
    Intl.DateTimeFormat().resolvedOptions().timeZone || "America/New_York";

  dom.tzPill.textContent = `TZ: ${DEFAULT_TZ}`;

  let themeColors = null;

  function readThemeColors() {
    const styles = getComputedStyle(document.documentElement);
    const get = (name, fallback) => {
      const value = styles.getPropertyValue(name).trim();
      return value || fallback;
    };
    return {
      chartGrid: get("--chart-grid", "rgba(60, 60, 67, 0.12)"),
      chartLabel: get("--chart-label", "rgba(60, 60, 67, 0.75)"),
      chartHover: get("--chart-hover", "rgba(60, 60, 67, 0.25)"),
      chartAnomaly: get("--chart-anomaly", "rgba(255, 59, 48, 0.10)"),
    };
  }

  function updateThemeColors() {
    themeColors = readThemeColors();
  }

  updateThemeColors();

  function setStatus(text, kind = "info") {
    dom.statusPill.textContent = text;
    dom.statusPill.classList.remove(
      "status--info",
      "status--warn",
      "status--error",
      "status--success"
    );
    const cls =
      kind === "success"
        ? "status--success"
        : kind === "error"
          ? "status--error"
          : kind === "warn"
            ? "status--warn"
            : "status--info";
    dom.statusPill.classList.add(cls);
  }

  function clearErrors() {
    dom.errors.innerHTML = "";
  }

  function showErrors(errors) {
    dom.errors.innerHTML = errors
      .slice(0, 8)
      .map((e) => `<div class="error-item">${escapeHtml(e)}</div>`)
      .join("");
    if (errors.length > 8) {
      dom.errors.innerHTML += `<div class="error-item">…and ${errors.length - 8} more</div>`;
    }
  }

  function escapeHtml(s) {
    return String(s)
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;");
  }

  function safeJsonParse(text) {
    try {
      return { ok: true, value: JSON.parse(text) };
    } catch (err) {
      return { ok: false, error: err };
    }
  }

  function isPlainObject(value) {
    return (
      value !== null &&
      typeof value === "object" &&
      Object.prototype.toString.call(value) === "[object Object]"
    );
  }

  function toNumber(value) {
    if (typeof value === "number" && Number.isFinite(value)) return value;
    if (typeof value === "string" && value.trim() !== "") {
      const num = Number(value);
      return Number.isFinite(num) ? num : null;
    }
    return null;
  }

  function parseDate(value) {
    if (typeof value !== "string") return null;
    const dt = new Date(value);
    return Number.isFinite(dt.getTime()) ? dt : null;
  }

  function validateTimeZone(timeZone) {
    try {
      new Intl.DateTimeFormat("en-US", { timeZone }).format(new Date());
      return true;
    } catch {
      return false;
    }
  }

  const dayKeyFormatterCache = new Map();
  function formatDayKey(date, timeZone) {
    const tz = validateTimeZone(timeZone) ? timeZone : DEFAULT_TZ;
    const cacheKey = tz;
    let fmt = dayKeyFormatterCache.get(cacheKey);
    if (!fmt) {
      fmt = new Intl.DateTimeFormat("en-CA", {
        timeZone: tz,
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
      });
      dayKeyFormatterCache.set(cacheKey, fmt);
    }
    return fmt.format(date);
  }

  function addDaysToKey(dayKey, days) {
    const dt = new Date(`${dayKey}T00:00:00Z`);
    dt.setUTCDate(dt.getUTCDate() + days);
    return dt.toISOString().slice(0, 10);
  }

  function formatRangeLabel(minDayKey, maxDayKey) {
    if (!minDayKey || !maxDayKey) return "—";
    const fmt = new Intl.DateTimeFormat("en-US", { month: "short", day: "2-digit" });
    const a = fmt.format(new Date(`${minDayKey}T00:00:00Z`));
    const b = fmt.format(new Date(`${maxDayKey}T00:00:00Z`));
    return `${a} → ${b}`;
  }

  function normalizePayload(raw) {
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

  function normalizeAndValidateRecords(records) {
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
        errors.push(
          `Record #${i + 1} (${type}): provide either "timestamp" or both "start" and "end".`
        );
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

    return { normalized, errors, sources };
  }

  function aggregateDaily(records, timeZone) {
    const dayMap = new Map();

    function getDay(dayKey) {
      let day = dayMap.get(dayKey);
      if (!day) {
        day = {
          dayKey,
          sleepMinutes: 0,
          sleepQualities: [],
          sugar_g: 0,
          calories: 0,
          protein_g: 0,
          steps: 0,
          workout_minutes: 0,
          workout_calories: 0,
          workout_load: 0,
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
        const dayKey = formatDayKey(rec.end, timeZone);
        const day = getDay(dayKey);
        day.sleepMinutes += durationMin;
        const q = toNumber(rec.data.quality);
        if (q !== null) day.sleepQualities.push(q);
        continue;
      }

      const t = rec.timestamp || rec.start || rec.end;
      if (!t) continue;
      const dayKey = formatDayKey(t, timeZone);
      const day = getDay(dayKey);

      switch (rec.type) {
        case "nutrition": {
          const calories = toNumber(rec.data.calories);
          const protein = toNumber(rec.data.protein_g);
          const sugar = toNumber(rec.data.sugar_g);
          if (calories !== null) day.calories += calories;
          if (protein !== null) day.protein_g += protein;
          if (sugar !== null) day.sugar_g += sugar;
          break;
        }
        case "steps": {
          const count = toNumber(rec.data.count);
          if (count !== null) day.steps += count;
          break;
        }
        case "workout": {
          const intensity =
            typeof rec.data.intensity === "string" ? rec.data.intensity : "moderate";
          const intensityFactor =
            intensity === "hard" ? 1.35 : intensity === "easy" ? 0.8 : 1.0;
          const durationMin =
            toNumber(rec.data.duration_min) ??
            (rec.start && rec.end ? (rec.end.getTime() - rec.start.getTime()) / 60000 : null);
          const calories = toNumber(rec.data.calories);
          if (durationMin !== null) day.workout_minutes += durationMin;
          if (calories !== null) day.workout_calories += calories;
          if (durationMin !== null) day.workout_load += durationMin * intensityFactor;
          break;
        }
        case "resting_heart_rate": {
          const bpm = toNumber(rec.data.bpm);
          if (bpm !== null) day.rhrSamples.push(bpm);
          break;
        }
        case "weight": {
          const kg = toNumber(rec.data.kg);
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
      const sleep_quality =
        day.sleepQualities.length > 0 ? avg(day.sleepQualities) : null;
      const rhr_bpm = day.rhrSamples.length > 0 ? avg(day.rhrSamples) : null;
      const weight_kg = latestSample(day.weightSamples)?.kg ?? null;
      const bp = latestSample(day.bpSamples);
      const bp_systolic = bp?.systolic ?? null;
      const bp_diastolic = bp?.diastolic ?? null;

      return {
        dayKey,
        sleep_hours,
        sleep_quality,
        sugar_g: day.sugar_g > 0 ? day.sugar_g : null,
        calories: day.calories > 0 ? day.calories : null,
        protein_g: day.protein_g > 0 ? day.protein_g : null,
        steps: day.steps > 0 ? day.steps : null,
        workout_minutes: day.workout_minutes > 0 ? day.workout_minutes : null,
        workout_calories: day.workout_calories > 0 ? day.workout_calories : null,
        workout_load: day.workout_load > 0 ? day.workout_load : null,
        rhr_bpm,
        weight_kg,
        bp_systolic,
        bp_diastolic,
      };
    });

    return { days, minDayKey, maxDayKey };
  }

  function avg(nums) {
    if (nums.length === 0) return null;
    let sum = 0;
    for (const n of nums) sum += n;
    return sum / nums.length;
  }

  function median(nums) {
    if (nums.length === 0) return null;
    const sorted = [...nums].sort((a, b) => a - b);
    const mid = Math.floor(sorted.length / 2);
    if (sorted.length % 2 === 1) return sorted[mid];
    return (sorted[mid - 1] + sorted[mid]) / 2;
  }

  function stddev(nums) {
    if (nums.length === 0) return null;
    const mean = avg(nums);
    if (mean === null) return null;
    let variance = 0;
    for (const v of nums) variance += (v - mean) ** 2;
    variance /= nums.length;
    return Math.sqrt(variance);
  }

  function latestSample(samples) {
    if (!samples || samples.length === 0) return null;
    let latest = samples[0];
    for (let i = 1; i < samples.length; i += 1) {
      if (samples[i].t > latest.t) latest = samples[i];
    }
    return latest;
  }

  function pearsonCorrelation(xs, ys) {
    if (xs.length !== ys.length || xs.length === 0) return null;
    const meanX = avg(xs);
    const meanY = avg(ys);
    if (meanX === null || meanY === null) return null;
    let num = 0;
    let dx = 0;
    let dy = 0;
    for (let i = 0; i < xs.length; i += 1) {
      const a = xs[i] - meanX;
      const b = ys[i] - meanY;
      num += a * b;
      dx += a * a;
      dy += b * b;
    }
    const denom = Math.sqrt(dx * dy);
    if (!Number.isFinite(denom) || denom === 0) return null;
    return num / denom;
  }

  function computePairwiseCorrelations(days, metricKeys, lagDays = 0) {
    const results = [];
    for (let i = 0; i < metricKeys.length; i += 1) {
      for (let j = i + 1; j < metricKeys.length; j += 1) {
        const xKey = metricKeys[i];
        const yKey = metricKeys[j];
        const xs = [];
        const ys = [];

        for (let k = 0; k < days.length; k += 1) {
          const a = days[k][xKey];
          const bIndex = k + lagDays;
          if (bIndex < 0 || bIndex >= days.length) continue;
          const b = days[bIndex][yKey];
          if (typeof a === "number" && typeof b === "number") {
            xs.push(a);
            ys.push(b);
          }
        }

        if (xs.length < CONFIG.minDaysForCorrelation) continue;
        const r = pearsonCorrelation(xs, ys);
        if (r === null) continue;
        results.push({ xKey, yKey, lagDays, r, n: xs.length });
      }
    }
    results.sort((a, b) => Math.abs(b.r) - Math.abs(a.r));
    return results;
  }

  function computeRollingStats(values, lookbackDays) {
    const means = new Array(values.length).fill(null);
    const sds = new Array(values.length).fill(null);

    for (let i = 0; i < values.length; i += 1) {
      const window = [];
      const start = Math.max(0, i - lookbackDays);
      for (let j = start; j < i; j += 1) {
        const v = values[j];
        if (typeof v === "number" && Number.isFinite(v)) window.push(v);
      }

      if (window.length < CONFIG.baselineMinPoints) continue;
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

  function detectZScoreAnomalies(values) {
    const { means, sds } = computeRollingStats(values, CONFIG.baselineLookbackDays);
    const anomalyIndices = new Set();

    for (let i = 0; i < values.length; i += 1) {
      const v = values[i];
      const mean = means[i];
      const sd = sds[i];
      if (typeof v !== "number" || typeof mean !== "number" || typeof sd !== "number") continue;
      if (sd === 0) continue;
      const z = (v - mean) / sd;
      if (Math.abs(z) >= CONFIG.zScoreThreshold) anomalyIndices.add(i);
    }

    return { anomalyIndices, means, sds };
  }

  function detectRhrStreak(days) {
    const values = days.map((d) => d.rhr_bpm);
    const numeric = values.filter((v) => typeof v === "number" && Number.isFinite(v));
    if (numeric.length < CONFIG.baselineMinPoints) return { qualifying: [] };

    const baselineMedian = median(numeric);
    const absDevs = numeric.map((v) => Math.abs(v - baselineMedian));
    const mad = median(absDevs);
    let robustSd = mad * 1.4826;
    if (!Number.isFinite(robustSd) || robustSd === 0) {
      robustSd = stddev(numeric);
    }
    if (!Number.isFinite(robustSd) || robustSd === 0) return { qualifying: [] };

    const threshold = baselineMedian + CONFIG.rhrElevationSd * robustSd;

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

    const qualifying = streaks.filter((s) => s.len >= CONFIG.rhrStreakDays);
    return { qualifying, threshold, baselineMedian, robustSd };
  }

  function computeCoverage(days, keys) {
    const cover = {};
    for (const k of keys) {
      cover[k] = days.reduce((acc, d) => (typeof d[k] === "number" ? acc + 1 : acc), 0);
    }
    return cover;
  }

  function buildInsights(days) {
    const insights = [];
    const story = [];
    const anomaliesByMetric = {};

    const sleep = days.map((d) => d.sleep_hours);
    const sugar = days.map((d) => d.sugar_g);
    const rhr = days.map((d) => d.rhr_bpm);
    const weight = days.map((d) => d.weight_kg);
    const workoutLoad = days.map((d) => d.workout_load);

    {
      const { anomalyIndices } = detectZScoreAnomalies(sleep);
      anomaliesByMetric.sleep_hours = anomalyIndices;
    }

    // Sleep ↔ Sugar (same-day)
    {
      const paired = days
        .map((d) => ({ sleep: d.sleep_hours, sugar: d.sugar_g, dayKey: d.dayKey }))
        .filter((p) => typeof p.sleep === "number" && typeof p.sugar === "number");

      const low = paired.filter((p) => p.sleep < CONFIG.shortSleepHours);
      const ok = paired.filter((p) => p.sleep >= CONFIG.shortSleepHours);

      if (low.length >= 2 && ok.length >= 2) {
        const lowAvg = avg(low.map((p) => p.sugar));
        const okAvg = avg(ok.map((p) => p.sugar));
        const pct = okAvg > 0 ? ((lowAvg - okAvg) / okAvg) * 100 : null;

        const r = pearsonCorrelation(
          paired.map((p) => p.sleep),
          paired.map((p) => p.sugar)
        );

        insights.push({
          severity: pct !== null && pct > 20 ? "warn" : "info",
          title: "Short sleep days correlate with higher sugar",
          body:
            `On days with < ${CONFIG.shortSleepHours}h sleep, sugar intake averaged ` +
            `${formatNumber(lowAvg, 0)}g vs ${formatNumber(okAvg, 0)}g ` +
            `(${pct === null ? "n/a" : `${formatNumber(pct, 0)}%`} higher).` +
            (r === null
              ? ""
              : ` Same-day correlation r=${formatNumber(r, 2)} (n=${paired.length}).`),
        });

        const streak = findStreakIndices(
          days.map((d) => (typeof d.sleep_hours === "number" ? d.sleep_hours < CONFIG.shortSleepHours : false))
        );
        if (streak.longest.len >= 2) {
          const a = streak.longest.start;
          const b = streak.longest.end;
          story.push({
            when: `${days[a].dayKey} → ${days[b].dayKey}`,
            what:
              `A short-sleep streak (<${CONFIG.shortSleepHours}h) coincided with higher sugar intake. ` +
              `Consider protecting sleep on high-demand weeks and planning lower-sugar snacks.`,
          });
        }
      }
    }

    // RHR elevated streaks + anomalies
    {
      const { qualifying } = detectRhrStreak(days);
      const { anomalyIndices } = detectZScoreAnomalies(rhr);
      anomaliesByMetric.rhr_bpm = anomalyIndices;

      for (const s of qualifying) {
        const slice = days.slice(s.start, s.end + 1);
        const avgRhr = avg(slice.map((d) => d.rhr_bpm).filter((v) => typeof v === "number"));
        const avgSleep = avg(slice.map((d) => d.sleep_hours).filter((v) => typeof v === "number"));
        const avgSugar = avg(slice.map((d) => d.sugar_g).filter((v) => typeof v === "number"));

        insights.push({
          severity: "alert",
          title: "Resting heart rate elevated for multiple days",
          body:
            `Resting HR was elevated for ${s.len} consecutive days (${slice[0].dayKey} → ${slice[slice.length - 1].dayKey}). ` +
            `Average was ${formatNumber(avgRhr, 0)} bpm.` +
            (avgSleep !== null
              ? ` During the same window, average sleep was ${formatNumber(avgSleep, 1)}h`
              : "") +
            (avgSugar !== null ? ` and sugar was ${formatNumber(avgSugar, 0)}g.` : "") +
            ` Elevated RHR can coincide with stress, poor recovery, or illness—use it as a signal to review recent habits.`,
        });

        story.push({
          when: `${slice[0].dayKey} → ${slice[slice.length - 1].dayKey}`,
          what:
            `A multi-day RHR elevation streak suggests reduced recovery. Consider deloading training, prioritizing sleep, and monitoring hydration/stress.`,
        });
      }
    }

    // Sugar anomalies
    {
      const { anomalyIndices } = detectZScoreAnomalies(sugar);
      anomaliesByMetric.sugar_g = anomalyIndices;
      if (anomalyIndices.size > 0) {
        const first = Math.min(...anomalyIndices);
        const last = Math.max(...anomalyIndices);
        insights.push({
          severity: "info",
          title: "Detected unusually high/low sugar days",
          body:
            `Sugar intake deviated from your recent baseline on ${anomalyIndices.size} day(s). ` +
            `First detected: ${days[first].dayKey}. Last detected: ${days[last].dayKey}.`,
        });
      }
    }

    // Weight trend
    {
      const { anomalyIndices } = detectZScoreAnomalies(weight);
      anomaliesByMetric.weight_kg = anomalyIndices;

      const w = weight
        .map((v, idx) => ({ v, idx }))
        .filter((p) => typeof p.v === "number");
      if (w.length >= 2) {
        const delta = w[w.length - 1].v - w[0].v;
        const daysSpan = w[w.length - 1].idx - w[0].idx;
        const perWeek = daysSpan > 0 ? (delta / daysSpan) * 7 : null;
        insights.push({
          severity: Math.abs(delta) >= 0.4 ? "warn" : "info",
          title: "Weight trend snapshot",
          body:
            `Over the observed period, weight changed by ${formatSigned(delta, 1)} kg` +
            (perWeek === null ? "." : ` (~${formatSigned(perWeek, 1)} kg/week).`) +
            ` For better signal, compare weekly averages rather than day-to-day noise.`,
        });
      }
    }

    // Workout load anomalies
    {
      const { anomalyIndices } = detectZScoreAnomalies(workoutLoad);
      anomaliesByMetric.workout_load = anomalyIndices;
    }

    // Data coverage guidance
    {
      const coverage = computeCoverage(days, [
        "sleep_hours",
        "sugar_g",
        "workout_load",
        "rhr_bpm",
        "weight_kg",
      ]);
      const missing = Object.entries(coverage)
        .filter(([, count]) => count === 0)
        .map(([k]) => METRICS[k]?.label ?? k);

      if (missing.length > 0) {
        insights.push({
          severity: "info",
          title: "Some metrics are missing",
          body:
            `No data detected for: ${missing.join(", ")}. ` +
            `Importing these metrics unlocks stronger correlations and better anomaly detection.`,
        });
      }
    }

    return { insights, story, anomaliesByMetric };
  }

  function findStreakIndices(bools) {
    let currentStart = null;
    let currentLen = 0;
    let longest = { start: 0, end: -1, len: 0 };

    for (let i = 0; i < bools.length; i += 1) {
      if (bools[i]) {
        if (currentStart === null) currentStart = i;
        currentLen += 1;
        if (currentLen > longest.len) {
          longest = { start: currentStart, end: i, len: currentLen };
        }
      } else {
        currentStart = null;
        currentLen = 0;
      }
    }

    return { longest };
  }

  function formatNumber(value, digits) {
    if (value === null || value === undefined || !Number.isFinite(value)) return "—";
    return Number(value).toFixed(digits);
  }

  function formatSigned(value, digits) {
    if (value === null || value === undefined || !Number.isFinite(value)) return "—";
    const sign = value > 0 ? "+" : "";
    return `${sign}${Number(value).toFixed(digits)}`;
  }

  function buildCorrelationModel(days) {
    const keys = ["sleep_hours", "sugar_g", "workout_load", "rhr_bpm", "weight_kg", "steps"];
    const topSameDay = computePairwiseCorrelations(days, keys, 0).slice(0, 8);
    const lagPairs = [
      { x: "sleep_hours", y: "sugar_g" },
      { x: "sleep_hours", y: "workout_load" },
      { x: "sleep_hours", y: "rhr_bpm" },
    ];

    const lagResults = [];
    for (const p of lagPairs) {
      const xs = [];
      const ys = [];
      for (let i = 0; i < days.length - 1; i += 1) {
        const a = days[i][p.x];
        const b = days[i + 1][p.y];
        if (typeof a === "number" && typeof b === "number") {
          xs.push(a);
          ys.push(b);
        }
      }
      if (xs.length < CONFIG.minDaysForCorrelation) continue;
      const r = pearsonCorrelation(xs, ys);
      if (r === null) continue;
      lagResults.push({ xKey: p.x, yKey: p.y, lagDays: 1, r, n: xs.length });
    }
    lagResults.sort((a, b) => Math.abs(b.r) - Math.abs(a.r));

    return { topSameDay, lagResults };
  }

  function renderOverview(model) {
    const { minDayKey, maxDayKey, days, recordCount, sources } = model;
    dom.rangeValue.textContent = formatRangeLabel(minDayKey, maxDayKey);
    dom.daysValue.textContent = `${days.length} days`;
    dom.recordsValue.textContent = `${recordCount}`;
    dom.sourcesValue.textContent = `${sources.size} sources`;

    const coverage = computeCoverage(days, [
      "sleep_hours",
      "sugar_g",
      "workout_load",
      "rhr_bpm",
      "weight_kg",
    ]);
    const parts = Object.entries(coverage).map(([k, v]) => {
      const label = METRICS[k]?.label ?? k;
      return `${label}: ${v}/${days.length}`;
    });
    dom.coverageValue.textContent = parts.join(" • ");

    const topStory = model.story.length > 0 ? model.story[0].what : "No major patterns yet";
    dom.topStoryValue.textContent = topStory;
  }

  function renderStory(story) {
    if (story.length === 0) {
      dom.storyList.innerHTML =
        `<div class="story-item"><div class="what">Import data to generate a daily story.</div></div>`;
      return;
    }

    dom.storyList.innerHTML = story
      .slice(0, 6)
      .map(
        (s) =>
          `<div class="story-item"><div class="when">${escapeHtml(
            s.when
          )}</div><div class="what">${escapeHtml(s.what)}</div></div>`
      )
      .join("");
  }

  function renderInsights(insights) {
    if (insights.length === 0) {
      dom.insightFeed.innerHTML =
        `<div class="insight"><div class="body">No insights yet — import more days of data.</div></div>`;
      return;
    }

    dom.insightFeed.innerHTML = insights
      .slice(0, 10)
      .map((ins) => {
        const tagClass = ins.severity === "alert" ? "alert" : ins.severity === "warn" ? "warn" : "info";
        const tagText = ins.severity === "alert" ? "Alert" : ins.severity === "warn" ? "Watch" : "Insight";
        return `
        <div class="insight">
          <div class="meta">
            <span class="tag ${tagClass}">${tagText}</span>
          </div>
          <div class="title">${escapeHtml(ins.title)}</div>
          <div class="body">${escapeHtml(ins.body)}</div>
        </div>`;
      })
      .join("");
  }

  function renderCorrelations(correlationModel) {
    const { topSameDay, lagResults } = correlationModel;
    dom.correlationTables.innerHTML = `
      <div class="muted" style="margin-bottom: 10px;">
        Correlation coefficient <span class="mono">r</span> ranges from -1 to 1. Positive means metrics tend to move together.
      </div>
      ${renderCorrelationTable("Top same-day correlations", topSameDay)}
      <div style="height: 12px;"></div>
      ${renderCorrelationTable("Lag correlations (today → tomorrow)", lagResults)}
    `;
  }

  function renderCorrelationTable(title, rows) {
    if (rows.length === 0) {
      return `<div class="muted">${escapeHtml(title)}: not enough overlapping data.</div>`;
    }

    const body = rows
      .map((r) => {
        const a = METRICS[r.xKey]?.label ?? r.xKey;
        const b = METRICS[r.yKey]?.label ?? r.yKey;
        const lag = r.lagDays ? `${r.lagDays}d` : "0d";
        return `<tr>
          <td>${escapeHtml(a)} ↔ ${escapeHtml(b)}</td>
          <td class="mono">${lag}</td>
          <td class="mono">${formatNumber(r.r, 2)}</td>
          <td class="mono">${r.n}</td>
        </tr>`;
      })
      .join("");

    return `
      <div style="margin-bottom: 8px; font-weight: 800;">${escapeHtml(title)}</div>
      <table>
        <thead>
          <tr>
            <th>Pair</th>
            <th>Lag</th>
            <th>r</th>
            <th>n</th>
          </tr>
        </thead>
        <tbody>${body}</tbody>
      </table>
    `;
  }

  class MiniChart {
    constructor(canvas, tooltipDiv, { heightPx = 140 } = {}) {
      this.canvas = canvas;
      this.tooltipDiv = tooltipDiv;
      this.heightPx = heightPx;
      this.series = null;
      this.hoverIndex = null;
      this.resizeObserver = new ResizeObserver(() => this.render());
      this.resizeObserver.observe(this.canvas);

      this.canvas.addEventListener("mousemove", (ev) => this.onMove(ev));
      this.canvas.addEventListener("mouseleave", () => this.onLeave());
    }

    setSeries(series) {
      this.series = series;
      this.render();
    }

    onLeave() {
      this.hoverIndex = null;
      this.tooltipDiv.hidden = true;
      this.render();
    }

    onMove(ev) {
      if (!this.series) return;
      const rect = this.canvas.getBoundingClientRect();
      const x = ev.clientX - rect.left;
      const idx = this.pickIndex(x, rect.width);
      if (idx === null) return;
      this.hoverIndex = idx;
      this.showTooltip(ev.clientX, ev.clientY);
      this.render();
    }

    pickIndex(x, width) {
      const { dates } = this.series;
      const n = dates.length;
      if (n === 0) return null;

      const padL = 44;
      const padR = 12;
      const innerW = Math.max(1, width - padL - padR);
      if (n === 1) return 0;
      const step = innerW / (n - 1);
      const raw = (x - padL) / step;
      const idx = Math.max(0, Math.min(n - 1, Math.round(raw)));
      return idx;
    }

    showTooltip(clientX, clientY) {
      if (!this.series || this.hoverIndex === null) return;
      const { dates, values, label, unit } = this.series;
      const dayKey = dates[this.hoverIndex];
      const value = values[this.hoverIndex];

      const valueLabel =
        typeof value === "number" ? `${formatNumber(value, unit === "kg" ? 1 : 0)} ${unit}` : "—";
      this.tooltipDiv.innerHTML = `<div class="tip-title">${escapeHtml(label)}</div>
        <div class="mono">${escapeHtml(dayKey)}</div>
        <div>${escapeHtml(valueLabel)}</div>`;

      const margin = 14;
      this.tooltipDiv.hidden = false;
      const rect = this.tooltipDiv.getBoundingClientRect();
      const left = Math.min(window.innerWidth - rect.width - margin, clientX + 12);
      const top = Math.min(window.innerHeight - rect.height - margin, clientY + 12);
      this.tooltipDiv.style.left = `${Math.max(margin, left)}px`;
      this.tooltipDiv.style.top = `${Math.max(margin, top)}px`;
    }

    render() {
      const series = this.series;
      if (!series) return;

      const cssWidth = Math.max(1, this.canvas.clientWidth);
      const cssHeight = this.heightPx;
      const dpr = window.devicePixelRatio || 1;
      this.canvas.width = Math.round(cssWidth * dpr);
      this.canvas.height = Math.round(cssHeight * dpr);
      const ctx = this.canvas.getContext("2d");
      if (!ctx) return;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

      const { dates, values, color, kind, anomalies, unit } = series;
      const n = dates.length;

      const padL = 44;
      const padR = 12;
      const padT = 10;
      const padB = 22;

      const plotW = cssWidth - padL - padR;
      const plotH = cssHeight - padT - padB;

      ctx.clearRect(0, 0, cssWidth, cssHeight);

      // grid
      const colors = themeColors ?? readThemeColors();
      ctx.strokeStyle = colors.chartGrid;
      ctx.lineWidth = 1;
      for (let i = 0; i <= 2; i += 1) {
        const y = padT + (plotH * i) / 2;
        ctx.beginPath();
        ctx.moveTo(padL, y);
        ctx.lineTo(cssWidth - padR, y);
        ctx.stroke();
      }

      // y scale
      const defined = values.filter((v) => typeof v === "number" && Number.isFinite(v));
      let min = defined.length > 0 ? Math.min(...defined) : 0;
      let max = defined.length > 0 ? Math.max(...defined) : 1;
      if (kind === "bar") min = 0;
      if (max === min) {
        max += 1;
        min -= 1;
      }
      const pad = (max - min) * 0.08;
      max += pad;
      min -= pad;

      const yFor = (v) => padT + ((max - v) / (max - min)) * plotH;

      // y labels
      const digits = unit === "kg" || unit === "h" ? 1 : 0;
      ctx.fillStyle = colors.chartLabel;
      ctx.font = "11px ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, 'Liberation Mono', 'Courier New', monospace";
      ctx.textAlign = "left";
      ctx.textBaseline = "middle";
      ctx.fillText(formatNumber(max, digits), 6, padT);
      ctx.fillText(formatNumber((min + max) / 2, digits), 6, padT + plotH / 2);
      ctx.fillText(formatNumber(min, digits), 6, padT + plotH);

      // anomaly shading
      if (anomalies && anomalies.size > 0 && n > 1) {
        const step = plotW / (n - 1);
        for (const idx of anomalies) {
          const x = padL + idx * step;
          ctx.fillStyle = colors.chartAnomaly;
          ctx.fillRect(x - step * 0.35, padT, step * 0.7, plotH);
        }
      }

      // series
      ctx.strokeStyle = color;
      ctx.fillStyle = color;
      ctx.lineWidth = 2;

      if (n === 1) {
        const v = values[0];
        if (typeof v === "number") {
          ctx.beginPath();
          ctx.arc(padL, yFor(v), 3, 0, Math.PI * 2);
          ctx.fill();
        }
      } else if (kind === "bar") {
        const step = plotW / (n - 1);
        const barW = Math.max(4, Math.min(18, step * 0.65));
        for (let i = 0; i < n; i += 1) {
          const v = values[i];
          if (typeof v !== "number") continue;
          const x = padL + i * step;
          const y = yFor(v);
          ctx.globalAlpha = 0.85;
          ctx.fillRect(x - barW / 2, y, barW, padT + plotH - y);
          ctx.globalAlpha = 1;
        }
      } else {
        ctx.beginPath();
        let started = false;
        const step = plotW / (n - 1);
        for (let i = 0; i < n; i += 1) {
          const v = values[i];
          if (typeof v !== "number") continue;
          const x = padL + i * step;
          const y = yFor(v);
          if (!started) {
            ctx.moveTo(x, y);
            started = true;
          } else {
            ctx.lineTo(x, y);
          }
        }
        ctx.stroke();

        // points
        for (let i = 0; i < n; i += 1) {
          const v = values[i];
          if (typeof v !== "number") continue;
          const x = padL + i * step;
          const y = yFor(v);
          ctx.globalAlpha = 0.9;
          ctx.beginPath();
          ctx.arc(x, y, 2.2, 0, Math.PI * 2);
          ctx.fill();
          ctx.globalAlpha = 1;
        }
      }

      // x labels (first/middle/last)
      ctx.fillStyle = colors.chartLabel;
      ctx.font = "11px ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, 'Liberation Mono', 'Courier New', monospace";
      ctx.textBaseline = "alphabetic";
      ctx.textAlign = "center";
      const labels = [0, Math.floor((n - 1) / 2), n - 1].filter(
        (v, idx, arr) => arr.indexOf(v) === idx
      );
      for (const idx of labels) {
        const x = padL + (plotW * idx) / (n - 1);
        ctx.fillText(dates[idx].slice(5), x, cssHeight - 6);
      }

      // hover marker
      if (this.hoverIndex !== null && n > 1) {
        const step = plotW / (n - 1);
        const x = padL + this.hoverIndex * step;
        ctx.strokeStyle = colors.chartHover;
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(x, padT);
        ctx.lineTo(x, padT + plotH);
        ctx.stroke();
      }
    }
  }

  const charts = {
    sleep: new MiniChart(dom.charts.sleep, dom.tooltip),
    sugar: new MiniChart(dom.charts.sugar, dom.tooltip),
    load: new MiniChart(dom.charts.load, dom.tooltip),
    rhr: new MiniChart(dom.charts.rhr, dom.tooltip),
    weight: new MiniChart(dom.charts.weight, dom.tooltip),
  };

  const colorSchemeMedia = window.matchMedia?.("(prefers-color-scheme: dark)") ?? null;
  const onThemeChange = () => {
    updateThemeColors();
    for (const chart of Object.values(charts)) chart.render();
  };
  if (colorSchemeMedia) {
    if (typeof colorSchemeMedia.addEventListener === "function") {
      colorSchemeMedia.addEventListener("change", onThemeChange);
    } else if (typeof colorSchemeMedia.addListener === "function") {
      colorSchemeMedia.addListener(onThemeChange);
    }
  }

  function renderCharts(days, anomaliesByMetric) {
    const dates = days.map((d) => d.dayKey);

    charts.sleep.setSeries({
      dates,
      values: days.map((d) => d.sleep_hours),
      label: METRICS.sleep_hours.label,
      unit: METRICS.sleep_hours.unit,
      kind: METRICS.sleep_hours.kind,
      color: METRICS.sleep_hours.color,
      anomalies: anomaliesByMetric.sleep_hours ?? new Set(),
    });

    charts.sugar.setSeries({
      dates,
      values: days.map((d) => d.sugar_g),
      label: METRICS.sugar_g.label,
      unit: METRICS.sugar_g.unit,
      kind: METRICS.sugar_g.kind,
      color: METRICS.sugar_g.color,
      anomalies: anomaliesByMetric.sugar_g ?? new Set(),
    });

    charts.load.setSeries({
      dates,
      values: days.map((d) => d.workout_load),
      label: METRICS.workout_load.label,
      unit: METRICS.workout_load.unit,
      kind: METRICS.workout_load.kind,
      color: METRICS.workout_load.color,
      anomalies: anomaliesByMetric.workout_load ?? new Set(),
    });

    charts.rhr.setSeries({
      dates,
      values: days.map((d) => d.rhr_bpm),
      label: METRICS.rhr_bpm.label,
      unit: METRICS.rhr_bpm.unit,
      kind: METRICS.rhr_bpm.kind,
      color: METRICS.rhr_bpm.color,
      anomalies: anomaliesByMetric.rhr_bpm ?? new Set(),
    });

    charts.weight.setSeries({
      dates,
      values: days.map((d) => d.weight_kg),
      label: METRICS.weight_kg.label,
      unit: METRICS.weight_kg.unit,
      kind: METRICS.weight_kg.kind,
      color: METRICS.weight_kg.color,
      anomalies: anomaliesByMetric.weight_kg ?? new Set(),
    });
  }

  function analyzeFromText(text) {
    clearErrors();
    setStatus("Analyzing…");

    const parsed = safeJsonParse(text);
    if (!parsed.ok) {
      showErrors([`JSON parse error: ${parsed.error.message}`]);
      setStatus("Parse error", "error");
      return;
    }

    const payload = normalizePayload(parsed.value);
    if (!payload) {
      showErrors([
        `Expected a JSON object with a "records" array, or a raw array of records.`,
      ]);
      setStatus("Invalid JSON shape", "error");
      return;
    }

    const timeZone =
      typeof payload.user.tz === "string" && validateTimeZone(payload.user.tz)
        ? payload.user.tz
        : DEFAULT_TZ;
    dom.tzPill.textContent = `TZ: ${timeZone}`;

    const { normalized, errors, sources } = normalizeAndValidateRecords(payload.records);
    if (errors.length > 0) {
      showErrors(errors);
      setStatus("Validation errors", "error");
      return;
    }

    const { days, minDayKey, maxDayKey } = aggregateDaily(normalized, timeZone);
    if (days.length === 0) {
      showErrors([`No usable daily data found after aggregation.`]);
      setStatus("No data", "warn");
      return;
    }

    const { insights, story, anomaliesByMetric } = buildInsights(days);
    const correlationModel = buildCorrelationModel(days);

    const model = {
      days,
      minDayKey,
      maxDayKey,
      recordCount: normalized.length,
      sources,
      insights,
      story,
      anomaliesByMetric,
      correlationModel,
      timeZone,
    };

    renderOverview(model);
    renderStory(model.story);
    renderInsights(model.insights);
    renderCorrelations(model.correlationModel);
    renderCharts(model.days, model.anomaliesByMetric);
    setStatus("Done", "success");
  }

  async function loadSample() {
    clearErrors();
    setStatus("Loading sample…");
    try {
      const res = await fetch("./data/sample-health-data.json", { cache: "no-store" });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const text = await res.text();
      dom.jsonInput.value = text;
      analyzeFromText(text);
    } catch (err) {
      setStatus("Sample load failed", "warn");
      showErrors([
        `Could not fetch ./data/sample-health-data.json (${String(err)}).`,
        `If you're opening the file directly (file://), run a local server (see README) or upload the sample file via the picker.`,
      ]);
    }
  }

  function clearAll() {
    dom.jsonInput.value = "";
    dom.fileInput.value = "";
    dom.errors.innerHTML = "";
    dom.storyList.innerHTML = "";
    dom.insightFeed.innerHTML = "";
    dom.correlationTables.innerHTML = "";
    dom.rangeValue.textContent = "—";
    dom.daysValue.textContent = "—";
    dom.recordsValue.textContent = "—";
    dom.sourcesValue.textContent = "—";
    dom.coverageValue.textContent = "—";
    dom.topStoryValue.textContent = "—";
    setStatus("Ready");
  }

  function readFileAsText(file) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onerror = () => reject(new Error("File read error"));
      reader.onload = () => resolve(String(reader.result || ""));
      reader.readAsText(file);
    });
  }

  dom.loadSampleBtn.addEventListener("click", () => void loadSample());
  dom.analyzeBtn.addEventListener("click", () => analyzeFromText(dom.jsonInput.value));
  dom.clearBtn.addEventListener("click", () => clearAll());
  dom.fileInput.addEventListener("change", async () => {
    const file = dom.fileInput.files?.[0];
    if (!file) return;
    clearErrors();
    setStatus("Reading file…");
    try {
      const text = await readFileAsText(file);
      dom.jsonInput.value = text;
      analyzeFromText(text);
    } catch (err) {
      setStatus("Read failed", "error");
      showErrors([`Could not read file: ${String(err)}`]);
    }
  });
})();
