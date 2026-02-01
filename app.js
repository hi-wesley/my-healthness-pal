(() => {
  "use strict";

  const CONFIG = {
    shortSleepHours: 6,
    baselineLookbackDays: 14,
    baselineMinPoints: 5,
    zScoreThreshold: 2.0,
    rhrElevationSd: 1.5,
    rhrStreakDays: 3,
    stressZToFull: 2.0,
    stressPctToFull: 0.2,
    stressLowMax: 33,
    stressModerateMax: 66,
  };

  const METRICS = {
    sleep_hours: { label: "Sleep", unit: "h", kind: "bar", color: "#1E3A8A" }, // deep blue
    sugar_g: { label: "Sugar", unit: "g", kind: "bar", color: "#FF2D55" }, // systemPink
    workout_minutes: { label: "Exercise", unit: "min", kind: "bar", color: "#F59E0B" }, // amber
    workout_load: { label: "Training load", unit: "au", kind: "line", color: "#F59E0B" }, // amber
    rhr_bpm: { label: "Resting HR", unit: "bpm", kind: "line", color: "#FF3B30" }, // systemRed
    weight_kg: { label: "Weight", unit: "lb", kind: "line", color: "#C4B5FD" }, // light purple
    steps: { label: "Steps", unit: "steps", kind: "line", color: "#5AC8FA" }, // systemTeal
    calories: { label: "Calories", unit: "Cal", kind: "line", color: "#14B8A6" }, // teal
    protein_g: { label: "Protein", unit: "g", kind: "line", color: "#007AFF" }, // systemBlue
  };

  const dom = {
    helloPill: document.getElementById("helloPill"),
    statusPill: document.getElementById("statusPill"),
    fileInput: document.getElementById("fileInput"),
    jsonInput: document.getElementById("jsonInput"),
    loadSampleBtn: document.getElementById("loadSampleBtn"),
    analyzeBtn: document.getElementById("analyzeBtn"),
    clearBtn: document.getElementById("clearBtn"),
    errors: document.getElementById("errors"),
    focusRange: document.getElementById("focusRange"),
    focus: {
      sleepNow: document.getElementById("sleepNow"),
      sleepMeta: document.getElementById("sleepMeta"),
      sleepDay: document.getElementById("sleepDay"),
      sleepRange: document.getElementById("sleepRange"),
      stressCircle: document.getElementById("stressCircle"),
      stressNow: document.getElementById("stressNow"),
      stressMeta: document.getElementById("stressMeta"),
      stressNote: document.getElementById("stressNote"),
      exerciseNow: document.getElementById("exerciseNow"),
      exerciseMeta: document.getElementById("exerciseMeta"),
      exerciseDay: document.getElementById("exerciseDay"),
      exerciseNote: document.getElementById("exerciseNote"),
      bpNow: document.getElementById("bpNow"),
      bpMeta: document.getElementById("bpMeta"),
      bpNote: document.getElementById("bpNote"),
      weightNow: document.getElementById("weightNow"),
      weightMeta: document.getElementById("weightMeta"),
      weightNote: document.getElementById("weightNote"),
      nutritionNow: document.getElementById("nutritionNow"),
      nutritionMeta: document.getElementById("nutritionMeta"),
      nutritionDay: document.getElementById("nutritionDay"),
      nutritionRange: document.getElementById("nutritionRange"),
      nutritionGrid: document.getElementById("nutritionGrid"),
      nutritionCalories: document.getElementById("nutritionCalories"),
      nutritionCarbs: document.getElementById("nutritionCarbs"),
      nutritionProtein: document.getElementById("nutritionProtein"),
      nutritionFat: document.getElementById("nutritionFat"),
      nutritionNote: document.getElementById("nutritionNote"),
    },
    focusCharts: {
      sleep: document.getElementById("focusSleepChart"),
      stress: document.getElementById("focusStressChart"),
      exercise: document.getElementById("focusExerciseChart"),
      nutritionCalories: document.getElementById("focusNutritionCaloriesChart"),
      bp: document.getElementById("focusBpChart"),
      weight: document.getElementById("focusWeightChart"),
    },
    insights: {
      overallTitle: document.getElementById("insightOverallTitle"),
      overallBody: document.getElementById("insightOverallBody"),
      sleepTitle: document.getElementById("insightSleepTitle"),
      sleepBody: document.getElementById("insightSleepBody"),
      stressTitle: document.getElementById("insightStressTitle"),
      stressBody: document.getElementById("insightStressBody"),
      exerciseTitle: document.getElementById("insightExerciseTitle"),
      exerciseBody: document.getElementById("insightExerciseBody"),
      nutritionTitle: document.getElementById("insightNutritionTitle"),
      nutritionBody: document.getElementById("insightNutritionBody"),
      bpTitle: document.getElementById("insightBpTitle"),
      bpBody: document.getElementById("insightBpBody"),
      weightTitle: document.getElementById("insightWeightTitle"),
      weightBody: document.getElementById("insightWeightBody"),
    },
    tooltip: document.getElementById("tooltip"),
    rangeButtons: [
      ...document.querySelectorAll("button[data-range-panel][data-range-days]"),
    ],
  };

  const APP_TZ = "America/Los_Angeles";
  const DEFAULT_TZ = APP_TZ;
  dom.helloPill.textContent = "Hello, there";

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

  const FOCUS_RANGE_DEFAULTS = Object.freeze({
    sleep: 7,
    exercise: 7,
    stress: 1,
    nutrition: 1,
    weight: 30,
    bp: 7,
  });

  const FOCUS_RANGE_OPTIONS = Object.freeze({
    sleep: [1, 7, 30],
    exercise: [1, 7, 30],
    stress: [1, 7, 30],
    nutrition: [1, 7, 30],
    weight: [7, 14, 30],
    bp: [7, 14, 30],
  });

  let focusRanges = { ...FOCUS_RANGE_DEFAULTS };
  let currentModel = null;

  function updateRangeToggleUI() {
    for (const btn of dom.rangeButtons) {
      const panel = btn.dataset.rangePanel;
      const days = Number(btn.dataset.rangeDays);
      if (!panel || !Number.isFinite(days)) continue;
      btn.setAttribute("aria-pressed", focusRanges[panel] === days ? "true" : "false");
    }
  }

  updateRangeToggleUI();

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

  function normalizeSleepStages(raw) {
    if (!isPlainObject(raw)) return null;
    const awake = toNumber(raw.awake ?? raw.wake);
    const rem = toNumber(raw.rem);
    const light = toNumber(raw.light ?? raw.core);
    const deep = toNumber(raw.deep);

    const hasAny = [awake, rem, light, deep].some(
      (v) => typeof v === "number" && Number.isFinite(v) && v > 0
    );
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

  const zonedWeekdayTimeFormatterCache = new Map();
  function formatZonedWeekdayTime(date, timeZone) {
    if (!(date instanceof Date) || !Number.isFinite(date.getTime())) return "—";
    const tz = validateTimeZone(timeZone) ? timeZone : DEFAULT_TZ;
    let fmt = zonedWeekdayTimeFormatterCache.get(tz);
    if (!fmt) {
      fmt = new Intl.DateTimeFormat("en-US", {
        timeZone: tz,
        weekday: "short",
        hour: "numeric",
        minute: "2-digit",
      });
      zonedWeekdayTimeFormatterCache.set(tz, fmt);
    }
    return fmt.format(date);
  }

  function formatZonedWeekdayTimeRange(start, end, timeZone) {
    const a = formatZonedWeekdayTime(start, timeZone);
    const b = formatZonedWeekdayTime(end, timeZone);
    if (a === "—" && b === "—") return "—";
    if (a === "—") return `→ ${b}`;
    if (b === "—") return `${a} →`;
    return `${a} → ${b}`;
  }

  function addDaysToKey(dayKey, days) {
    const dt = new Date(`${dayKey}T00:00:00Z`);
    dt.setUTCDate(dt.getUTCDate() + days);
    return dt.toISOString().slice(0, 10);
  }

  function formatRangeLabel(minDayKey, maxDayKey) {
    if (!minDayKey || !maxDayKey) return "—";
    const fmt = new Intl.DateTimeFormat("en-US", {
      timeZone: "UTC",
      month: "short",
      day: "2-digit",
    });
    const a = fmt.format(new Date(`${minDayKey}T00:00:00Z`));
    const b = fmt.format(new Date(`${maxDayKey}T00:00:00Z`));
    return `${a} → ${b}`;
  }

  const DAY_SHORT_FMT = new Intl.DateTimeFormat("en-US", {
    timeZone: "UTC",
    month: "short",
    day: "2-digit",
  });
  const DAY_LONG_FMT = new Intl.DateTimeFormat("en-US", {
    timeZone: "UTC",
    month: "short",
    day: "2-digit",
    year: "numeric",
  });
  const DAY_WEEKDAY_FMT = new Intl.DateTimeFormat("en-US", {
    timeZone: "UTC",
    weekday: "short",
    month: "short",
    day: "2-digit",
  });
  const DAY_WEEKDAY_LONG_FMT = new Intl.DateTimeFormat("en-US", {
    timeZone: "UTC",
    weekday: "short",
    month: "short",
    day: "2-digit",
    year: "numeric",
  });
  const DAY_TICK_WEEKDAY_FMT = new Intl.DateTimeFormat("en-US", {
    timeZone: "UTC",
    weekday: "short",
    day: "2-digit",
  });

  function formatDayShort(dayKey) {
    try {
      return DAY_SHORT_FMT.format(new Date(`${dayKey}T00:00:00Z`));
    } catch {
      return String(dayKey ?? "—");
    }
  }

  function formatDayLong(dayKey) {
    try {
      return DAY_LONG_FMT.format(new Date(`${dayKey}T00:00:00Z`));
    } catch {
      return String(dayKey ?? "—");
    }
  }

  function formatDayWeekdayShort(dayKey) {
    try {
      return DAY_WEEKDAY_FMT.format(new Date(`${dayKey}T00:00:00Z`));
    } catch {
      return String(dayKey ?? "—");
    }
  }

  function formatDayWeekdayLong(dayKey) {
    try {
      return DAY_WEEKDAY_LONG_FMT.format(new Date(`${dayKey}T00:00:00Z`));
    } catch {
      return String(dayKey ?? "—");
    }
  }

  function formatDayTickWeekday(dayKey) {
    try {
      return DAY_TICK_WEEKDAY_FMT.format(new Date(`${dayKey}T00:00:00Z`));
    } catch {
      return String(dayKey ?? "—").slice(5);
    }
  }

  function formatRangeWeekdayShort(startDayKey, endDayKey) {
    return `${formatDayWeekdayShort(startDayKey)} → ${formatDayWeekdayShort(endDayKey)}`;
  }

  function formatWindowRange(endDayKey, lengthDays) {
    const startKey = addDaysToKey(endDayKey, -(lengthDays - 1));
    if (lengthDays === 1) return formatDayWeekdayShort(endDayKey);
    if (lengthDays === 7) return formatRangeWeekdayShort(startKey, endDayKey);
    return formatRangeLabel(startKey, endDayKey);
  }

  function pluralize(count, singular, plural = `${singular}s`) {
    return count === 1 ? singular : plural;
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

  function pickUserDisplayName(user) {
    if (!isPlainObject(user)) return "there";
    const name = typeof user.name === "string" ? user.name.trim() : "";
    if (name) return name;
    const id = typeof user.id === "string" ? user.id.trim() : "";
    if (id) return id;
    return "there";
  }

  function setHelloName(name) {
    const cleaned = typeof name === "string" ? name.trim() : "";
    dom.helloPill.textContent = `Hello, ${cleaned || "there"}`;
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
        const dayKey = formatDayKey(rec.end, timeZone);
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
      const dayKey = formatDayKey(t, timeZone);
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
            typeof rec.data.activity === "string" && rec.data.activity.trim()
              ? rec.data.activity.trim()
              : "Workout";
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
      const sleep_quality =
        day.sleepQualities.length > 0 ? avg(day.sleepQualities) : null;
      const sleep_primary = pickPrimarySleepSession(day.sleepSessions);
      const rhr_bpm = day.rhrSamples.length > 0 ? avg(day.rhrSamples) : null;
      const weight_kg = latestSample(day.weightSamples)?.kg ?? null;
      const bp_systolic =
        day.bpSamples.length > 0
          ? avg(day.bpSamples.map((s) => s.systolic).filter(isFiniteNumber))
          : null;
      const bp_diastolic =
        day.bpSamples.length > 0
          ? avg(day.bpSamples.map((s) => s.diastolic).filter(isFiniteNumber))
          : null;
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

  function avg(nums) {
    if (nums.length === 0) return null;
    let sum = 0;
    for (const n of nums) sum += n;
    return sum / nums.length;
  }

  function isFiniteNumber(value) {
    return typeof value === "number" && Number.isFinite(value);
  }

  function sum(nums) {
    let total = 0;
    for (const n of nums) total += n;
    return total;
  }

  function clamp(value, min, max) {
    return Math.min(max, Math.max(min, value));
  }

  function clamp01(value) {
    return clamp(value, 0, 1);
  }

  const KG_PER_LB = 1 / 2.2046226218;
  function kgToLb(kg) {
    return kg / KG_PER_LB;
  }

  function lbToKg(lb) {
    return lb * KG_PER_LB;
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

  function buildInsights(days) {
    const insights = [];
    const story = [];
    const dayByKey = new Map(days.map((d) => [d.dayKey, d]));
    const maxDayKey = days.length > 0 ? days[days.length - 1].dayKey : null;

    const addInsight = (category, severity, title, body) => {
      insights.push({ category, severity, title, body });
    };

    if (!maxDayKey) {
      addInsight("Sleep", "info", "No sleep data yet", "Import data to see sleep patterns.");
      addInsight("Exercise", "info", "No exercise data yet", "Import data to see exercise patterns.");
      addInsight("Blood pressure", "info", "No blood pressure data yet", "Import data to see BP patterns.");
      addInsight(
        "Physiological stress",
        "info",
        "Stress score needs history",
        "Import more days to build a baseline for stress scoring."
      );
      addInsight("Nutrition", "info", "No nutrition data yet", "Import data to see nutrition patterns.");
      addInsight("Weight", "info", "No weight data yet", "Import data to see weight patterns.");
      return { insights, story };
    }

    // Sleep (7d)
    {
      const length = FOCUS_RANGE_DEFAULTS.sleep;
      const window = windowDays(dayByKey, maxDayKey, length);
      const rangeLabel = formatWindowRange(maxDayKey, length);
      const values = window.map((d) => d.sleep_hours).filter(isFiniteNumber);
      const avgSleep = values.length > 0 ? avg(values) : null;
      const shortFlags = window.map((d) =>
        isFiniteNumber(d.sleep_hours) ? d.sleep_hours < CONFIG.shortSleepHours : false
      );
      const shortCount = shortFlags.reduce((acc, v) => acc + (v ? 1 : 0), 0);
      const streak = findStreakIndices(shortFlags);

      if (values.length === 0) {
        addInsight(
          "Sleep",
          "info",
          "No sleep logged this week",
          `${rangeLabel}: no sleep sessions were found.`
        );
      } else if (shortCount === 0) {
        addInsight(
          "Sleep",
          "info",
          "Sleep looks consistent",
          `${rangeLabel}: average ${formatMinutesAsHM(avgSleep * 60)} with no short-sleep days (<${CONFIG.shortSleepHours}h).`
        );
      } else {
        const severity =
          shortCount >= 3 || (avgSleep !== null && avgSleep < CONFIG.shortSleepHours)
            ? "warn"
            : "info";
        const streakNote =
          streak.longest.len >= 2 ? ` Longest short-sleep streak: ${streak.longest.len} days.` : "";
        addInsight(
          "Sleep",
          severity,
          "Short sleep showed up",
          `${rangeLabel}: average ${formatMinutesAsHM(avgSleep * 60)}. Short sleep (<${CONFIG.shortSleepHours}h) on ${shortCount}/${length} days.${streakNote}`
        );

        if (severity !== "info") {
          const startKey =
            streak.longest.len >= 2 ? window[streak.longest.start].dayKey : window[0].dayKey;
          const endKey =
            streak.longest.len >= 2 ? window[streak.longest.end].dayKey : window[window.length - 1].dayKey;
          story.push({
            severity,
            startDayKey: startKey,
            endDayKey: endKey,
            when: formatWindowRange(endKey, streak.longest.len >= 2 ? streak.longest.len : length),
            what:
              `Short sleep (<${CONFIG.shortSleepHours}h) has been showing up recently. ` +
              `If you can, protect bedtime and consider reducing late caffeine/screens.`,
          });
        }
      }
    }

    // Exercise (7d)
    {
      const length = FOCUS_RANGE_DEFAULTS.exercise;
      const window = windowDays(dayByKey, maxDayKey, length);
      const rangeLabel = formatWindowRange(maxDayKey, length);
      const nums = window
        .map((d) => d.workout_minutes)
        .filter((v) => typeof v === "number" && Number.isFinite(v));
      const totalMinutes = sum(nums);
      const sessions = nums.filter((v) => v > 0).length;
      let peak = { value: 0, dayKey: null };
      for (const d of window) {
        const v = d.workout_minutes;
        if (isFiniteNumber(v) && v > peak.value) peak = { value: v, dayKey: d.dayKey };
      }

      if (sessions === 0) {
        addInsight(
          "Exercise",
          "warn",
          "No workouts logged",
          `${rangeLabel}: no workouts were recorded. Even one short session can restart momentum.`
        );
        story.push({
          severity: "warn",
          startDayKey: window[0].dayKey,
          endDayKey: window[window.length - 1].dayKey,
          when: rangeLabel,
          what:
            "No workouts were logged recently. If you’re aiming for consistency, plan a small, easy session today.",
        });
      } else {
        const peakLabel = peak.dayKey ? formatDayWeekdayShort(peak.dayKey) : "—";
        addInsight(
          "Exercise",
          "info",
          `${sessions} workout ${pluralize(sessions, "day")}`,
          `${rangeLabel}: ${formatMinutesAsHM(totalMinutes)} total across ${sessions}/${length} days. Peak day: ${peakLabel} (${formatMinutesAsHM(peak.value)}).`
        );
      }
    }

    // Blood pressure (7d)
    {
      const length = FOCUS_RANGE_DEFAULTS.bp;
      const window = windowDays(dayByKey, maxDayKey, length);
      const rangeLabel = formatWindowRange(maxDayKey, length);
      const readings = window.reduce((acc, d) => {
        const ok = isFiniteNumber(d.bp_systolic) && isFiniteNumber(d.bp_diastolic);
        return acc + (ok ? 1 : 0);
      }, 0);
      const latest = latestBpReading(days);
      const inWindow = latest ? window.some((d) => d.dayKey === latest.dayKey) : false;

      if (!latest) {
        addInsight(
          "Blood pressure",
          "info",
          "No readings yet",
          `${rangeLabel}: no blood pressure readings were found.`
        );
      } else if (!inWindow) {
        addInsight(
          "Blood pressure",
          "warn",
          "No recent reading",
          `${rangeLabel}: no readings logged. Latest was ${formatDayWeekdayLong(latest.dayKey)} (${latest.systolic}/${latest.diastolic} mmHg).`
        );
        story.push({
          severity: "warn",
          startDayKey: window[0].dayKey,
          endDayKey: window[window.length - 1].dayKey,
          when: rangeLabel,
          what:
            "No blood pressure reading was logged recently. If you track BP, try to measure at a consistent time/condition.",
        });
      } else {
        const high =
          latest.systolic >= 140 || latest.diastolic >= 90 ? "warn" : "info";
        addInsight(
          "Blood pressure",
          high,
          "Latest reading",
          `${rangeLabel}: ${readings}/${length} days logged. Latest ${latest.systolic}/${latest.diastolic} mmHg on ${formatDayWeekdayLong(latest.dayKey)}.`
        );
        if (high !== "info") {
          story.push({
            severity: high,
            startDayKey: latest.dayKey,
            endDayKey: latest.dayKey,
            when: formatDayWeekdayLong(latest.dayKey),
            what:
              "Your latest blood pressure reading was higher than typical targets. If this persists, consider discussing it with a clinician.",
          });
        }
      }
    }

    // Physiological stress (previous day)
    {
      const dayKey = addDaysToKey(maxDayKey, -1);
      const detail = computeStressForDay(dayByKey, dayKey);
      if (detail.score === null) {
        if (detail.rows.length === 0) {
          addInsight(
            "Physiological stress",
            "info",
            "Not enough data yet",
            "Stress scoring needs sleep, resting HR, and workout history (and enough prior days to build a baseline)."
          );
        } else {
          addInsight(
            "Physiological stress",
            "info",
            "Baseline building",
            `${formatDayWeekdayLong(dayKey)}: collecting enough history to score stress reliably.`
          );
        }
      } else {
        const severity = detail.label === "High" || detail.label === "Moderate" ? "warn" : "info";
        addInsight(
          "Physiological stress",
          severity,
          `${detail.label} yesterday`,
          `${formatDayWeekdayLong(dayKey)}: score ${detail.score}/100 based on sleep/resting HR/exercise vs your recent baseline.`
        );
        if (detail.label === "High") {
          story.push({
            severity: "warn",
            startDayKey: dayKey,
            endDayKey: dayKey,
            when: formatDayWeekdayLong(dayKey),
            what:
              "Yesterday’s stress signals were high. If you feel run down, prioritize sleep and keep today’s training easier.",
          });
        }
      }
    }

    // Nutrition (most recent day)
    {
      const end = latestNutritionDay(days);
      if (!end) {
        addInsight(
          "Nutrition",
          "info",
          "No logs yet",
          "No nutrition records were found. Logging even one meal a day improves insights quickly."
        );
      } else {
        const dayLabel = formatDayWeekdayLong(end.dayKey);
        const calories = isFiniteNumber(end.calories) ? end.calories : null;
        const protein = isFiniteNumber(end.protein_g) ? end.protein_g : null;
        const sugar = isFiniteNumber(end.sugar_g) ? end.sugar_g : null;

        const baseline = calories !== null
          ? computeBaselineStats(dayByKey, addDaysToKey(end.dayKey, -1), "calories")
          : null;
        const pct =
          baseline && baseline.mean > 0 ? (calories - baseline.mean) / baseline.mean : null;
        const severity = pct !== null && pct >= 0.2 ? "warn" : "info";

        const parts = [];
        if (calories !== null) parts.push(`${formatNumber(calories, 0)} Calories`);
        if (protein !== null) parts.push(`${formatNumber(protein, 0)}g protein`);
        if (sugar !== null) parts.push(`${formatNumber(sugar, 0)}g sugar`);
        const basePart =
          pct === null
            ? ""
            : ` (vs recent avg ${formatNumber(baseline.mean, 0)} Calories: ${formatSigned(pct * 100, 0)}%)`;

        addInsight(
          "Nutrition",
          severity,
          "Latest day totals",
          `${dayLabel}: ${parts.join(" • ") || "—"}${basePart}.`
        );

        if (severity !== "info") {
          story.push({
            severity,
            startDayKey: end.dayKey,
            endDayKey: end.dayKey,
            when: dayLabel,
            what:
              "Calories were notably higher than your recent average. If this wasn’t intentional, review snacks/drinks and meal timing.",
          });
        }
      }
    }

    // Weight (30d)
    {
      const length = FOCUS_RANGE_DEFAULTS.weight;
      const window = windowDays(dayByKey, maxDayKey, length);
      const rangeLabel = formatWindowRange(maxDayKey, length);
      const first = firstNumberInDays(window, "weight_kg");
      const latest = latestNumberInDays(window, "weight_kg");
      const present = window.reduce((acc, d) => acc + (isFiniteNumber(d.weight_kg) ? 1 : 0), 0);

      if (!first || !latest || latest.index <= first.index) {
        addInsight(
          "Weight",
          "info",
          "Not enough weigh-ins yet",
          `${rangeLabel}: ${present}/${length} days logged. Add more weigh-ins to estimate trends.`
        );
      } else {
        const firstLb = kgToLb(first.value);
        const latestLb = kgToLb(latest.value);
        const delta = latestLb - firstLb;
        const spanDays = latest.index - first.index;
        const perWeek = (delta / spanDays) * 7;
        const severity = Math.abs(delta) >= 2.0 ? "warn" : "info";

        addInsight(
          "Weight",
          severity,
          "Trend snapshot",
          `${rangeLabel}: ${formatNumber(firstLb, 1)} → ${formatNumber(latestLb, 1)} lb (Δ ${formatSigned(delta, 1)} lb, ~${formatSigned(perWeek, 1)} lb/week).`
        );

        if (severity !== "info") {
          story.push({
            severity,
            startDayKey: first.dayKey,
            endDayKey: latest.dayKey,
            when: rangeLabel,
            what:
              "Weight has been moving noticeably. For a clearer signal, compare weekly averages and consider hydration/sodium/training changes.",
          });
        }
      }
    }

    // Optional story: elevated RHR streaks (strong recovery signal)
    {
      const { qualifying } = detectRhrStreak(days);
      if (qualifying.length > 0) {
        const s = qualifying[qualifying.length - 1];
        const slice = days.slice(s.start, s.end + 1);
        const avgRhr = avg(slice.map((d) => d.rhr_bpm).filter((v) => typeof v === "number"));
        story.push({
          severity: "alert",
          startDayKey: slice[0].dayKey,
          endDayKey: slice[slice.length - 1].dayKey,
          when: `${formatDayShort(slice[0].dayKey)} → ${formatDayShort(slice[slice.length - 1].dayKey)}`,
          what:
            `Resting heart rate was elevated for ${s.len} consecutive days (avg ${formatNumber(avgRhr, 0)} bpm). ` +
            `This can coincide with stress, low recovery, or illness—consider easing training and prioritizing sleep.`,
        });
      }
    }

    return { insights, story };
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

  function formatMinutesAsHM(minutes) {
    if (minutes === null || minutes === undefined || !Number.isFinite(minutes)) return "—";
    const total = Math.max(0, Math.round(minutes));
    const h = Math.floor(total / 60);
    const m = total % 60;
    if (h === 0) return `${m}m`;
    if (m === 0) return `${h}h`;
    return `${h}h ${m}m`;
  }

  function buildSleepDetailsHtml(day, timeZone) {
    const primary = day?.sleep_primary ?? null;

    const totalMin = isFiniteNumber(day?.sleep_minutes)
      ? day.sleep_minutes
      : isFiniteNumber(day?.sleep_hours)
        ? day.sleep_hours * 60
        : null;
    const totalLabel = totalMin === null ? "—" : formatMinutesAsHM(totalMin);

    const rangeLabel = primary
      ? formatZonedWeekdayTimeRange(primary.start, primary.end, timeZone)
      : "—";

    const respirationLabel = isFiniteNumber(primary?.respiration_rpm)
      ? `${formatNumber(primary.respiration_rpm, 1)} breaths/min`
      : "—";

    return `<div class="sleep-details">
      <div class="sleep-row"><span class="sleep-label">Sleep</span><span class="sleep-value">${escapeHtml(
        rangeLabel
      )}</span></div>
      <div class="sleep-row"><span class="sleep-label">Total sleep</span><span class="sleep-value">${escapeHtml(
        totalLabel
      )}</span></div>
      <div class="sleep-row"><span class="sleep-label">Respiration</span><span class="sleep-value">${escapeHtml(
        respirationLabel
      )}</span></div>
    </div>`;
  }

  function buildSleepTooltipHtml({ day, dayKey, value, timeZone, title = "Sleep" }) {
    const primary = day?.sleep_primary ?? null;

    const totalMin = isFiniteNumber(day?.sleep_minutes)
      ? day.sleep_minutes
      : typeof value === "number" && Number.isFinite(value)
        ? value * 60
        : null;
    const totalLabel = totalMin === null ? "—" : formatMinutesAsHM(totalMin);

    const rangeLabel = primary
      ? formatZonedWeekdayTimeRange(primary.start, primary.end, timeZone)
      : "—";

    const respirationLabel = isFiniteNumber(primary?.respiration_rpm)
      ? `${formatNumber(primary.respiration_rpm, 1)} breaths/min`
      : "—";

    return `<div class="tip-title">${escapeHtml(title)}</div>
      <div class="mono">${escapeHtml(formatDayWeekdayLong(dayKey))}</div>
      <div class="tip-rows">
        <div class="tip-row"><span class="tip-label">Sleep</span><span class="tip-value">${escapeHtml(
          rangeLabel
        )}</span></div>
        <div class="tip-row"><span class="tip-label">Total</span><span class="tip-value">${escapeHtml(
          totalLabel
        )}</span></div>
        <div class="tip-row"><span class="tip-label">Respiration</span><span class="tip-value">${escapeHtml(
          respirationLabel
        )}</span></div>
      </div>`;
  }

  function formatWorkoutMinutes(minutes) {
    return formatMinutesAsHM(minutes);
  }

  function formatMacroShare(grams, totalCalories, caloriesPerGram) {
    if (!isFiniteNumber(grams) || grams < 0) return "—";
    const gramsLabel = `${formatNumber(grams, 0)}g`;
    if (!isFiniteNumber(totalCalories) || totalCalories <= 0) return `—% (${gramsLabel})`;
    const pct = Math.round(((grams * caloriesPerGram) / totalCalories) * 100);
    return `${pct}% (${gramsLabel})`;
  }

  function formatMacroTile(grams, totalCalories, caloriesPerGram) {
    if (!isFiniteNumber(grams)) return "No data";
    const gramsLabel = `${formatNumber(grams, 0)}g`;
    if (!isFiniteNumber(totalCalories) || totalCalories <= 0) return `${gramsLabel} (no total)`;
    const pct = Math.round(((grams * caloriesPerGram) / totalCalories) * 100);
    return `${pct}% (${gramsLabel})`;
  }

  function topExerciseActivities(day, topN = 3) {
    const activities = Array.isArray(day?.workout_by_activity) ? day.workout_by_activity : [];
    return activities
      .filter((a) => isFiniteNumber(a?.duration_min) && a.duration_min > 0)
      .slice()
      .sort((a, b) => b.duration_min - a.duration_min)
      .slice(0, topN);
  }

  function buildExerciseDetailsHtml(day) {
    const totalDuration = isFiniteNumber(day?.workout_minutes)
      ? formatWorkoutMinutes(day.workout_minutes)
      : "—";
    const totalCalories = isFiniteNumber(day?.workout_calories)
      ? `${formatNumber(day.workout_calories, 0)} Calories`
      : "—";

    const top = topExerciseActivities(day, 3);
    const activityRows =
      top.length > 0
        ? top
            .map((a) => {
              const activity =
                typeof a.activity === "string" && a.activity.trim() ? a.activity.trim() : "Workout";
              const duration = formatWorkoutMinutes(a.duration_min);
              const calories = isFiniteNumber(a.calories)
                ? `${formatNumber(a.calories, 0)} Cal`
                : "—";
              return `<div class="metric-row"><span class="metric-label">${escapeHtml(
                activity
              )}</span><span class="metric-value">${escapeHtml(
                `${duration} • ${calories}`
              )}</span></div>`;
            })
            .join("")
        : `<div class="metric-row"><span class="metric-label">Top activities</span><span class="metric-value">—</span></div>`;

    return `<div class="metric-list">
      <div class="metric-row"><span class="metric-label">Total duration</span><span class="metric-value">${escapeHtml(
        totalDuration
      )}</span></div>
      <div class="metric-row"><span class="metric-label">Calories</span><span class="metric-value">${escapeHtml(
        totalCalories
      )}</span></div>
      ${activityRows}
    </div>`;
  }

  function buildExerciseTooltipHtml({ day, dayKey, title = "Exercise" }) {
    const duration = isFiniteNumber(day?.workout_minutes)
      ? formatWorkoutMinutes(day.workout_minutes)
      : "—";
    const calories = isFiniteNumber(day?.workout_calories)
      ? `${formatNumber(day.workout_calories, 0)} Calories`
      : "—";

    const top = topExerciseActivities(day, 3);
    const breakdown =
      top.length > 0
        ? top
            .map((a) => {
              const activity =
                typeof a.activity === "string" && a.activity.trim() ? a.activity.trim() : "Workout";
              const aDur = formatWorkoutMinutes(a.duration_min);
              const aCal = isFiniteNumber(a.calories) ? `${formatNumber(a.calories, 0)} Cal` : "—";
              return `<div class="tip-row"><span class="tip-label">${escapeHtml(
                activity
              )}</span><span class="tip-value">${escapeHtml(`${aDur} • ${aCal}`)}</span></div>`;
            })
            .join("")
        : `<div class="tip-row"><span class="tip-label">Exercise</span><span class="tip-value">—</span></div>`;

    return `<div class="tip-title">${escapeHtml(title)}</div>
      <div class="mono">${escapeHtml(formatDayWeekdayLong(dayKey))}</div>
      <div class="tip-rows">
        <div class="tip-row"><span class="tip-label">Total</span><span class="tip-value">${escapeHtml(
          `${duration} • ${calories}`
        )}</span></div>
        ${breakdown}
      </div>`;
  }

  function windowDays(dayByKey, endDayKey, length) {
    const out = [];
    for (let offset = length - 1; offset >= 0; offset -= 1) {
      const dayKey = addDaysToKey(endDayKey, -offset);
      out.push(dayByKey.get(dayKey) ?? { dayKey });
    }
    return out;
  }

  function latestNumberInDays(days, key) {
    for (let i = days.length - 1; i >= 0; i -= 1) {
      const v = days[i]?.[key];
      if (isFiniteNumber(v)) return { value: v, dayKey: days[i].dayKey, index: i };
    }
    return null;
  }

  function firstNumberInDays(days, key) {
    for (let i = 0; i < days.length; i += 1) {
      const v = days[i]?.[key];
      if (isFiniteNumber(v)) return { value: v, dayKey: days[i].dayKey, index: i };
    }
    return null;
  }

  function latestBpReading(days) {
    for (let i = days.length - 1; i >= 0; i -= 1) {
      const systolic = days[i]?.bp_systolic;
      const diastolic = days[i]?.bp_diastolic;
      if (isFiniteNumber(systolic) && isFiniteNumber(diastolic)) {
        return { systolic, diastolic, dayKey: days[i].dayKey, index: i };
      }
    }
    return null;
  }

  function latestNutritionDay(days) {
    for (let i = days.length - 1; i >= 0; i -= 1) {
      const d = days[i];
      if (
        isFiniteNumber(d?.calories) ||
        isFiniteNumber(d?.carbs_g) ||
        isFiniteNumber(d?.protein_g) ||
        isFiniteNumber(d?.fat_g) ||
        isFiniteNumber(d?.sugar_g)
      ) {
        return d;
      }
    }
    return null;
  }

  function computeBaselineStats(dayByKey, endDayKey, metricKey) {
    const window = windowDays(dayByKey, endDayKey, CONFIG.baselineLookbackDays);
    const values = window.map((d) => d?.[metricKey]).filter(isFiniteNumber);
    if (values.length < CONFIG.baselineMinPoints) return null;
    const mean = avg(values);
    const sd = stddev(values);
    return mean === null ? null : { mean, sd: isFiniteNumber(sd) ? sd : null, n: values.length };
  }

  function computeStressPenalty(value, baseline, direction) {
    if (!isFiniteNumber(value) || !baseline || !isFiniteNumber(baseline.mean)) return null;
    const diff = value - baseline.mean;

    if (isFiniteNumber(baseline.sd) && baseline.sd > 0) {
      const z = diff / baseline.sd;
      const signedZ = direction === "lower_worse" ? -z : z;
      const penalty = clamp01(signedZ / CONFIG.stressZToFull);
      return { penalty, diff, method: "z" };
    }

    if (baseline.mean > 0) {
      const pct = diff / baseline.mean;
      const signedPct = direction === "lower_worse" ? -pct : pct;
      const penalty = clamp01(signedPct / CONFIG.stressPctToFull);
      return { penalty, diff, method: "pct" };
    }

    return null;
  }

  function labelStressScore(score) {
    if (!isFiniteNumber(score)) return null;
    if (score <= CONFIG.stressLowMax) return "Low";
    if (score <= CONFIG.stressModerateMax) return "Moderate";
    return "High";
  }

  function stressHueForScore(score) {
    if (!isFiniteNumber(score)) return null;
    const clamped = clamp(score, 0, 100);
    return (clamped / 100) * 120;
  }

  function stressColorForScore(score) {
    const hue = stressHueForScore(score);
    if (hue === null) return "#FF3B30";
    return `hsl(${Math.round(hue)}, 78%, 45%)`;
  }

  const STRESS_INPUTS = Object.freeze([
    {
      key: "sleep_hours",
      label: "Sleep",
      unit: "h",
      digits: 1,
      direction: "lower_worse",
      weight: 0.4,
    },
    {
      key: "rhr_bpm",
      label: "Resting HR",
      unit: "bpm",
      digits: 0,
      direction: "higher_worse",
      weight: 0.4,
    },
    {
      key: "workout_load",
      label: "Exercise load",
      unit: "au",
      digits: 0,
      direction: "higher_worse",
      weight: 0.2,
    },
  ]);

  function computeStressForDay(dayByKey, dayKey) {
    const day = dayByKey.get(dayKey) ?? { dayKey };
    const baselineEndKey = addDaysToKey(dayKey, -1);

    let usedWeight = 0;
    let weightedPenalty = 0;
    const rows = [];
    const missingValues = [];
    const missingBaselines = [];

    for (const input of STRESS_INPUTS) {
      const value = day?.[input.key];
      if (!isFiniteNumber(value)) {
        missingValues.push(input.label);
        continue;
      }

      const baseline = computeBaselineStats(dayByKey, baselineEndKey, input.key);
      if (!baseline) {
        missingBaselines.push(input.label);
        rows.push({
          label: input.label,
          value: `${formatNumber(value, input.digits)} ${input.unit} (baseline building…)`,
        });
        continue;
      }

      const penalty = computeStressPenalty(value, baseline, input.direction);
      if (!penalty) {
        missingBaselines.push(input.label);
        rows.push({
          label: input.label,
          value: `${formatNumber(value, input.digits)} ${input.unit} (baseline: ${formatNumber(
            baseline.mean,
            input.digits
          )} ${input.unit})`,
        });
        continue;
      }

      usedWeight += input.weight;
      weightedPenalty += input.weight * penalty.penalty;

      const diffLabel = `${formatSigned(penalty.diff, input.digits)} ${input.unit}`;
      rows.push({
        label: input.label,
        value:
          `${formatNumber(value, input.digits)} ${input.unit}` +
          ` (Δ ${diffLabel})`,
      });
    }

    if (usedWeight <= 0) {
      return {
        dayKey,
        score: null,
        label: null,
        rows,
        missingValues,
        missingBaselines,
      };
    }

    const stress = Math.round((weightedPenalty / usedWeight) * 100);
    const score = clamp(100 - stress, 0, 100);
    const label = labelStressScore(score);
    return {
      dayKey,
      score,
      label,
      rows,
      missingValues,
      missingBaselines,
    };
  }

  function renderFocus(model) {
    const { days, maxDayKey, timeZone } = model;
    if (!Array.isArray(days) || days.length === 0 || !maxDayKey) {
      dom.focusRange.textContent = "—";
      dom.focus.sleepNow.textContent = "—";
      dom.focus.sleepMeta.textContent = "Last 7 days";
      dom.focusCharts.sleep.hidden = false;
      focusCharts.sleep.clear();
      dom.focus.sleepDay.hidden = true;
      dom.focus.sleepDay.textContent = "";
      dom.focus.sleepRange.hidden = false;
      dom.focus.sleepRange.style.display = "";
      dom.focus.stressNow.textContent = "—";
      dom.focus.stressMeta.textContent = "Previous day";
      dom.focus.stressNote.textContent = "";
      dom.focus.stressCircle.hidden = false;
      dom.focus.stressCircle.style.display = "";
      dom.focus.stressCircle.dataset.empty = "true";
      dom.focus.stressCircle.style.removeProperty("--stress-hue");
      dom.focus.stressCircle.style.removeProperty("--stress-pct");
      dom.focus.stressMeta.hidden = false;
      dom.focusCharts.stress.hidden = true;
      dom.focusCharts.stress.style.display = "none";
      focusCharts.stress.clear();
      dom.focus.exerciseNow.textContent = "—";
      dom.focus.exerciseMeta.textContent = "Last 7 days";
      dom.focusCharts.exercise.hidden = false;
      dom.focusCharts.exercise.style.display = "";
      focusCharts.exercise.clear();
      dom.focus.exerciseDay.hidden = true;
      dom.focus.exerciseDay.style.display = "none";
      dom.focus.exerciseDay.textContent = "";
      dom.focus.exerciseNote.textContent = "";
      dom.focus.bpNow.textContent = "—";
      dom.focus.bpMeta.textContent = "Last 7 days";
      dom.focus.bpNote.textContent = "";
      focusCharts.bp.clear();
      dom.focus.weightNow.textContent = "—";
      dom.focus.weightMeta.textContent = "Last 30 days";
      dom.focus.weightNote.textContent = "";
      dom.focus.nutritionNow.textContent = "—";
      dom.focus.nutritionMeta.textContent = "One-day totals";
      dom.focus.nutritionCalories.textContent = "—";
      dom.focus.nutritionCarbs.textContent = "—";
      dom.focus.nutritionProtein.textContent = "—";
      dom.focus.nutritionFat.textContent = "—";
      dom.focus.nutritionDay.hidden = false;
      dom.focus.nutritionDay.style.display = "";
      dom.focus.nutritionRange.hidden = true;
      dom.focus.nutritionRange.style.display = "none";
      dom.focus.nutritionGrid.hidden = false;
      dom.focusCharts.nutritionCalories.hidden = true;
      focusCharts.nutritionCalories.clear();
      dom.focus.nutritionNote.textContent = "";
      return;
    }

    dom.focusRange.textContent = `As of ${formatDayLong(maxDayKey)}`;
    const dayByKey = new Map(days.map((d) => [d.dayKey, d]));

    const sleepDays = focusRanges.sleep;
    const exerciseDays = focusRanges.exercise;
    const stressDays = focusRanges.stress;
    const nutritionDays = focusRanges.nutrition;
    const weightDays = focusRanges.weight;
    const bpDays = focusRanges.bp;

    // Sleep (1/7/30)
    {
      const length = sleepDays;
      const window = windowDays(dayByKey, maxDayKey, length);
      const latestDay = window.length > 0 ? window[window.length - 1] : { dayKey: maxDayKey };
      const values = window.map((d) => (isFiniteNumber(d.sleep_hours) ? d.sleep_hours : null));
      const nums = values.filter(isFiniteNumber);
      const avgSleep = nums.length > 0 ? avg(nums) : null;
      const shortCount = window.reduce((acc, d) => {
        const v = d.sleep_hours;
        return acc + (isFiniteNumber(v) && v < CONFIG.shortSleepHours ? 1 : 0);
      }, 0);
      const latest = latestNumberInDays(window, "sleep_hours");
      const windowLabel = formatWindowRange(maxDayKey, length);

      if (length === 1) {
        dom.focus.sleepDay.hidden = false;
        dom.focus.sleepDay.style.display = "";
        dom.focus.sleepRange.hidden = true;
        dom.focus.sleepRange.style.display = "none";
        dom.focusCharts.sleep.hidden = true;
        focusCharts.sleep.clear();
        dom.focus.sleepMeta.textContent = windowLabel;
        dom.focus.sleepNow.textContent = isFiniteNumber(latestDay.sleep_minutes)
          ? formatMinutesAsHM(latestDay.sleep_minutes)
          : latest
            ? formatMinutesAsHM(latest.value * 60)
            : "—";
        dom.focus.sleepDay.innerHTML = buildSleepDetailsHtml(latestDay, timeZone);
      } else {
        dom.focus.sleepDay.hidden = true;
        dom.focus.sleepDay.textContent = "";
        dom.focus.sleepRange.hidden = false;
        dom.focus.sleepRange.style.display = "";
        dom.focusCharts.sleep.hidden = false;
        dom.focus.sleepNow.textContent = latest ? formatMinutesAsHM(latest.value * 60) : "—";
        const prefix = length === 7 ? `${windowLabel} • ` : "";
        dom.focus.sleepMeta.textContent =
          `${prefix}${length}-day avg: ${avgSleep === null ? "—" : formatMinutesAsHM(avgSleep * 60)}` +
          ` • Short sleep: ${shortCount}/${window.length}`;
        const maxDefined = nums.length > 0 ? Math.max(...nums) : null;
        const yMaxBase = maxDefined === null ? 10 : Math.ceil(maxDefined + 0.5);
        const yMax = yMaxBase % 2 === 0 ? yMaxBase : yMaxBase + 1;

        focusCharts.sleep.setSeries({
          dates: window.map((d) => d.dayKey),
          values,
          label: METRICS.sleep_hours.label,
          unit: METRICS.sleep_hours.unit,
          kind: METRICS.sleep_hours.kind,
          color: METRICS.sleep_hours.color,
          anomalies: new Set(),
          yMin: 0,
          yMax,
          yLabelDigits: 0,
          tooltipHtml: ({ dayKey, value }) =>
            buildSleepTooltipHtml({
              day: dayByKey.get(dayKey) ?? { dayKey },
              dayKey,
              value,
              timeZone,
              title: METRICS.sleep_hours.label,
            }),
        });
      }
    }

    // Physiological stress (1/7/30, ending previous day)
    {
      const length = stressDays;
      const endDayKey = addDaysToKey(maxDayKey, -1);
      const isSingle = length === 1;

      dom.focus.stressCircle.hidden = !isSingle;
      dom.focus.stressCircle.style.display = isSingle ? "" : "none";
      dom.focusCharts.stress.hidden = isSingle;
      dom.focusCharts.stress.style.display = isSingle ? "none" : "";

      if (isSingle) {
        focusCharts.stress.clear();
        const detail = computeStressForDay(dayByKey, endDayKey);
        dom.focus.stressMeta.hidden = false;

        const dayLabel = formatDayWeekdayShort(endDayKey);
        dom.focus.stressMeta.textContent = dayLabel;

        if (detail.score !== null) {
          const score = clamp(detail.score, 0, 100);
          dom.focus.stressNow.textContent = String(score);
          dom.focus.stressCircle.dataset.empty = "false";
          dom.focus.stressCircle.style.setProperty("--stress-pct", String(score));
          const hue = stressHueForScore(score);
          if (hue !== null) dom.focus.stressCircle.style.setProperty("--stress-hue", String(hue));
        } else {
          dom.focus.stressNow.textContent = "—";
          dom.focus.stressCircle.dataset.empty = "true";
          dom.focus.stressCircle.style.removeProperty("--stress-hue");
          dom.focus.stressCircle.style.removeProperty("--stress-pct");
        }

        dom.focus.stressNote.textContent = "This is a heuristic score based on the previous day.";
      } else {
        dom.focus.stressMeta.hidden = false;

        const window = windowDays(dayByKey, endDayKey, length);
        dom.focus.stressMeta.textContent = formatWindowRange(endDayKey, length);
        const summaries = window.map((d) => computeStressForDay(dayByKey, d.dayKey));
        const values = summaries.map((s) => (isFiniteNumber(s.score) ? s.score : null));

        focusCharts.stress.setSeries({
          dates: window.map((d) => d.dayKey),
          values,
          label: "Stress score",
          unit: "/100",
          kind: "bar",
          color: "#FF3B30",
          anomalies: new Set(),
          yMin: 0,
          yMax: 100,
          yLabelDigits: 0,
          barColors: values.map((v) => (isFiniteNumber(v) ? stressColorForScore(v) : "")),
          tooltipHtml: ({ dayKey, value }) => {
            const scoreLabel =
              typeof value === "number" && Number.isFinite(value)
                ? `${Math.round(value)}/100`
                : "—";
            return `<div class="tip-title">Physiological stress</div>
              <div class="mono">${escapeHtml(formatDayWeekdayLong(dayKey))}</div>
              <div class="tip-rows">
                <div class="tip-row"><span class="tip-label">Score</span><span class="tip-value">${escapeHtml(
                  scoreLabel
                )}</span></div>
              </div>`;
          },
        });

        dom.focus.stressNote.textContent =
          length === 7
            ? "These are heuristic scores for the past 7 days."
            : length === 30
              ? "These are heuristic scores for the past 30 days."
              : `These are heuristic scores for the past ${length} days.`;
      }
    }

    // Exercise (1/7/30)
    {
      const length = exerciseDays;
      const window = windowDays(dayByKey, maxDayKey, length);
      const values = window.map((d) =>
        isFiniteNumber(d.workout_minutes) ? d.workout_minutes : null
      );
      const nums = values.filter(isFiniteNumber);
      const totalMinutes = sum(nums);
      const sessions = nums.filter((v) => v > 0).length;
      let peak = { value: 0, dayKey: null };
      for (const d of window) {
        const v = d.workout_minutes;
        if (isFiniteNumber(v) && v > peak.value) peak = { value: v, dayKey: d.dayKey };
      }
      const windowLabel = formatWindowRange(maxDayKey, length);

      if (length === 1) {
        dom.focusCharts.exercise.hidden = true;
        dom.focusCharts.exercise.style.display = "none";
        focusCharts.exercise.clear();
        dom.focus.exerciseDay.hidden = false;
        dom.focus.exerciseDay.style.display = "";

        const day = window.length > 0 ? window[window.length - 1] : { dayKey: maxDayKey };
        const caloriesLabel = isFiniteNumber(day.workout_calories)
          ? ` • ${formatNumber(day.workout_calories, 0)} Calories`
          : "";
        dom.focus.exerciseNow.textContent = isFiniteNumber(day.workout_minutes)
          ? formatWorkoutMinutes(day.workout_minutes)
          : "—";
        dom.focus.exerciseMeta.textContent = `${windowLabel}${caloriesLabel}`;
        dom.focus.exerciseDay.innerHTML = buildExerciseDetailsHtml(day);
        dom.focus.exerciseNote.textContent = "";
      } else {
        dom.focusCharts.exercise.hidden = false;
        dom.focusCharts.exercise.style.display = "";
        dom.focus.exerciseDay.hidden = true;
        dom.focus.exerciseDay.style.display = "none";
        dom.focus.exerciseDay.textContent = "";

        dom.focus.exerciseNow.textContent =
          totalMinutes > 0 ? formatMinutesAsHM(totalMinutes) : "—";
        const prefix = length === 7 ? `${windowLabel} • ` : "";
        dom.focus.exerciseMeta.textContent =
          `${prefix}Sessions: ${sessions}/${window.length}` +
          (totalMinutes > 0
            ? ` • Avg/day: ${formatMinutesAsHM(totalMinutes / window.length)}`
            : "");

        const peakLabel =
          length === 7 ? formatDayWeekdayShort(peak.dayKey) : formatDayShort(peak.dayKey);
        dom.focus.exerciseNote.textContent =
          sessions === 0
            ? `No workouts logged in the last ${window.length} days.`
            : `Most active day: ${peakLabel} (${formatMinutesAsHM(peak.value)}).`;

        focusCharts.exercise.setSeries({
          dates: window.map((d) => d.dayKey),
          values,
          label: METRICS.workout_minutes.label,
          unit: METRICS.workout_minutes.unit,
          kind: METRICS.workout_minutes.kind,
          color: METRICS.workout_minutes.color,
          anomalies: new Set(),
          yMin: 0,
          tooltipHtml: ({ dayKey }) =>
            buildExerciseTooltipHtml({
              day: dayByKey.get(dayKey) ?? { dayKey },
              dayKey,
              title: METRICS.workout_minutes.label,
            }),
        });
      }
    }

    // Nutrition (1/7/30, ending most recent nutrition day)
    {
      const length = nutritionDays;
      const lastNutrition = latestNutritionDay(days);
      const endDayKey = maxDayKey;
      const endDay = dayByKey.get(endDayKey) ?? { dayKey: endDayKey };
      const window = windowDays(dayByKey, endDayKey, length);
      const windowLabel = formatWindowRange(endDayKey, length);
      const isSingle = length === 1;

      dom.focus.nutritionDay.hidden = !isSingle;
      dom.focus.nutritionDay.style.display = isSingle ? "" : "none";
      dom.focus.nutritionRange.hidden = isSingle;
      dom.focus.nutritionRange.style.display = isSingle ? "none" : "";
      dom.focus.nutritionGrid.hidden = !isSingle;
      dom.focusCharts.nutritionCalories.hidden = isSingle;

      if (isSingle) {
        const calories = isFiniteNumber(endDay.calories) ? endDay.calories : null;
        dom.focus.nutritionNow.textContent =
          calories === null ? "No data" : formatNumber(calories, 0);
        dom.focus.nutritionMeta.textContent = `${formatDayWeekdayShort(endDayKey)} • One-day totals`;
        focusCharts.nutritionCalories.clear();

        dom.focus.nutritionCalories.textContent =
          calories === null ? "No data" : formatNumber(calories, 0);
        dom.focus.nutritionCarbs.textContent = formatMacroTile(endDay.carbs_g, endDay.calories, 4);
        dom.focus.nutritionProtein.textContent = formatMacroTile(
          endDay.protein_g,
          endDay.calories,
          4
        );
        dom.focus.nutritionFat.textContent = formatMacroTile(endDay.fat_g, endDay.calories, 9);
        dom.focus.nutritionNote.textContent = lastNutrition
          ? "Macros show % of total Calories (4/4/9 Cal/g)."
          : "No nutrition records found.";
      } else {
        const calValues = window.map((d) => (isFiniteNumber(d.calories) ? d.calories : null));
        const calNums = calValues.filter(isFiniteNumber);
        const logged = calNums.length;
        const avgCal = logged > 0 ? sum(calNums) / logged : null;

        dom.focus.nutritionNow.textContent = avgCal === null ? "No data" : formatNumber(avgCal, 0);
        dom.focus.nutritionMeta.textContent = `${windowLabel} • Avg Calories/day`;

        focusCharts.nutritionCalories.setSeries({
          dates: window.map((d) => d.dayKey),
          values: calValues,
          label: "Calories",
          unit: "Cal",
          kind: "bar",
          color: METRICS.calories.color,
          anomalies: new Set(),
          yMin: 0,
          yLabelDigits: 0,
        });
        dom.focus.nutritionNote.textContent =
          logged === 0 ? "No nutrition records found." : "";
      }
    }

    // Blood pressure (7/14/30)
    {
      const length = bpDays;
      const window = windowDays(dayByKey, maxDayKey, length);
      const latest = latestBpReading(days);
      const includeWeekday = length === 7;

      dom.focus.bpNow.textContent = latest ? `${latest.systolic}/${latest.diastolic}` : "—";
      dom.focus.bpMeta.textContent = latest
        ? `Latest: ${includeWeekday ? formatDayWeekdayShort(latest.dayKey) : formatDayShort(latest.dayKey)} • Last ${length} days`
        : `Last ${length} days`;

      const windowKeys = new Set(window.map((d) => d.dayKey));
      const inWindow = latest && windowKeys.has(latest.dayKey);

      focusCharts.bp.setSeries({
        dates: window.map((d) => d.dayKey),
        systolic: window.map((d) => (isFiniteNumber(d.bp_systolic) ? d.bp_systolic : null)),
        diastolic: window.map((d) => (isFiniteNumber(d.bp_diastolic) ? d.bp_diastolic : null)),
        label: "Blood pressure",
        unit: "mmHg",
        systolicColor: "rgba(0, 122, 255, 0.9)",
        diastolicColor: "rgba(0, 122, 255, 0.55)",
        tooltipHtml: ({ dayKey, systolic, diastolic }) => {
          const sysLabel =
            typeof systolic === "number" && Number.isFinite(systolic)
              ? `${formatNumber(systolic, 0)} mmHg`
              : "—";
          const diaLabel =
            typeof diastolic === "number" && Number.isFinite(diastolic)
              ? `${formatNumber(diastolic, 0)} mmHg`
              : "—";
          return `<div class="tip-title">Blood pressure</div>
            <div class="mono">${escapeHtml(
              includeWeekday ? formatDayWeekdayLong(dayKey) : formatDayLong(dayKey)
            )}</div>
            <div class="tip-rows">
              <div class="tip-row"><span class="tip-label">Systolic</span><span class="tip-value">${escapeHtml(
                sysLabel
              )}</span></div>
              <div class="tip-row"><span class="tip-label">Diastolic</span><span class="tip-value">${escapeHtml(
                diaLabel
              )}</span></div>
            </div>`;
        },
      });

      if (!latest) {
        dom.focus.bpNote.textContent =
          "No blood pressure readings found. Add occasional at-home checks to spot trends.";
      } else if (!inWindow) {
        dom.focus.bpNote.textContent = `No BP reading in the last ${length} days. Latest was ${formatDayLong(
          latest.dayKey
        )}.`;
      } else {
        dom.focus.bpNote.textContent =
          "Blood pressure varies with timing and conditions. Measure consistently for clearer trends.";
      }
    }

    // Weight (7/14/30)
    {
      const length = weightDays;
      const window = windowDays(dayByKey, maxDayKey, length);
      const values = window.map((d) =>
        isFiniteNumber(d.weight_kg) ? kgToLb(d.weight_kg) : null
      );
      const present = values.filter(isFiniteNumber).length;
      const first = firstNumberInDays(window, "weight_kg");
      const latest = latestNumberInDays(window, "weight_kg");
      const prefix = length === 7 ? `${formatWindowRange(maxDayKey, 7)} • ` : "";

      dom.focus.weightNow.textContent = latest
        ? `${formatNumber(kgToLb(latest.value), 1)} lb`
        : "—";

      if (first && latest && latest.index > first.index) {
        const firstLb = kgToLb(first.value);
        const latestLb = kgToLb(latest.value);
        const delta = latestLb - firstLb;
        const spanDays = latest.index - first.index;
        const perWeek = (delta / spanDays) * 7;
        dom.focus.weightMeta.textContent =
          `${prefix}${present}/${window.length} ${pluralize(present, "day")} logged` +
          ` • Δ ${formatSigned(delta, 1)} lb` +
          ` (~${formatSigned(perWeek, 1)} lb/week)`;
        dom.focus.weightNote.textContent =
          "For a clearer signal, compare weekly averages rather than day-to-day changes.";
      } else {
        dom.focus.weightMeta.textContent =
          `${prefix}${present}/${window.length} ${pluralize(present, "day")} logged`;
        dom.focus.weightNote.textContent =
          present === 0 ? "No weight readings found." : "Add more days to estimate trends.";
      }

      focusCharts.weight.setSeries({
        dates: window.map((d) => d.dayKey),
        values,
        label: METRICS.weight_kg.label,
        unit: METRICS.weight_kg.unit,
        kind: METRICS.weight_kg.kind,
        color: METRICS.weight_kg.color,
        anomalies: new Set(),
        ySnapStep: 1,
        yLabelDigits: 0,
      });
    }
  }

  function setInsightText(titleEl, bodyEl, title, body) {
    if (titleEl) titleEl.textContent = title;
    if (bodyEl) bodyEl.textContent = body;
  }

  function normalizeInsightBlock(value) {
    if (!isPlainObject(value)) return null;
    const title = typeof value.title === "string" ? value.title.trim() : "";
    const body = typeof value.body === "string" ? value.body.trim() : "";
    if (!title || !body) return null;
    return { title, body };
  }

  function renderAiInsights(insights) {
    if (!isPlainObject(insights)) return false;

    const overall = normalizeInsightBlock(insights.overall);
    const sleep = normalizeInsightBlock(insights.sleep);
    const stress = normalizeInsightBlock(insights.stress);
    const exercise = normalizeInsightBlock(insights.exercise);
    const nutrition = normalizeInsightBlock(insights.nutrition);
    const bp = normalizeInsightBlock(insights.bp);
    const weight = normalizeInsightBlock(insights.weight);

    if (overall) setInsightText(dom.insights.overallTitle, dom.insights.overallBody, overall.title, overall.body);
    if (sleep) setInsightText(dom.insights.sleepTitle, dom.insights.sleepBody, sleep.title, sleep.body);
    if (stress) setInsightText(dom.insights.stressTitle, dom.insights.stressBody, stress.title, stress.body);
    if (exercise) setInsightText(dom.insights.exerciseTitle, dom.insights.exerciseBody, exercise.title, exercise.body);
    if (nutrition) setInsightText(dom.insights.nutritionTitle, dom.insights.nutritionBody, nutrition.title, nutrition.body);
    if (bp) setInsightText(dom.insights.bpTitle, dom.insights.bpBody, bp.title, bp.body);
    if (weight) setInsightText(dom.insights.weightTitle, dom.insights.weightBody, weight.title, weight.body);

    return Boolean(overall && sleep && stress && exercise && nutrition && bp && weight);
  }

  async function ensureAiInsights(profileId, dayKey, model) {
    const requestKey = `${profileId}:${dayKey}`;
    const existing = insightRequestInFlight.get(requestKey);
    if (existing) return existing;

    const promise = (async () => {
      const cached = getCachedInsights(profileId, dayKey);
      if (cached && renderAiInsights(cached.insights)) return;

      const profile = SAMPLE_PROFILES[profileId] ?? null;
      const profileName = profile?.name ?? (typeof model?.userName === "string" ? model.userName : profileId);
      const days = Array.isArray(model?.days) ? model.days.slice(-60) : [];

      const res = await fetch("/insights", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          profileId,
          profileName,
          dayKey,
          timeZone: APP_TZ,
          days,
        }),
      });

      const data = await res.json().catch(() => null);
      if (!res.ok) {
        const message = isPlainObject(data) && typeof data.error === "string" ? data.error : `Request failed (${res.status})`;
        throw new Error(message);
      }
      if (!isPlainObject(data) || data.ok !== true) {
        const message = isPlainObject(data) && typeof data.error === "string" ? data.error : "Unexpected backend response";
        throw new Error(message);
      }
      if (!isPlainObject(data.insights)) throw new Error("Backend returned invalid insights");

      putCachedInsights(profileId, dayKey, { model: data.model, insights: data.insights });
      renderAiInsights(data.insights);
    })().finally(() => {
      insightRequestInFlight.delete(requestKey);
    });

    insightRequestInFlight.set(requestKey, promise);
    return promise;
  }

  function renderInsights(model) {
    const hasData = isPlainObject(model) && Array.isArray(model.days) && model.days.length > 0;
    const maxDayKey = hasData && typeof model.maxDayKey === "string" ? model.maxDayKey : null;
    const asOf = maxDayKey ? formatDayLong(maxDayKey) : null;

    if (!hasData) {
      setInsightText(dom.insights.overallTitle, dom.insights.overallBody, "—", "—");
      setInsightText(dom.insights.sleepTitle, dom.insights.sleepBody, "—", "—");
      setInsightText(dom.insights.stressTitle, dom.insights.stressBody, "—", "—");
      setInsightText(dom.insights.exerciseTitle, dom.insights.exerciseBody, "—", "—");
      setInsightText(dom.insights.nutritionTitle, dom.insights.nutritionBody, "—", "—");
      setInsightText(dom.insights.bpTitle, dom.insights.bpBody, "—", "—");
      setInsightText(dom.insights.weightTitle, dom.insights.weightBody, "—", "—");
      return;
    }

    const todayKey = getTodayKey();
    const profileId = typeof model.userId === "string" && model.userId ? model.userId : null;
    const isSample = Boolean(profileId && profileId in SAMPLE_PROFILES);

    if (isSample) {
      const cached = getCachedInsights(profileId, todayKey);
      if (cached && renderAiInsights(cached.insights)) return;
    }

    const placeholderTitle = isSample ? "Generating…" : "Not generated yet";
    const placeholderBody = isSample
      ? `Generating AI insights for ${todayKey}…`
      : "Start the backend to generate AI insights.";

    setInsightText(
      dom.insights.overallTitle,
      dom.insights.overallBody,
      placeholderTitle,
      asOf ? `As of ${asOf}, ${placeholderBody}` : placeholderBody
    );
    setInsightText(dom.insights.sleepTitle, dom.insights.sleepBody, placeholderTitle, placeholderBody);
    setInsightText(dom.insights.stressTitle, dom.insights.stressBody, placeholderTitle, placeholderBody);
    setInsightText(dom.insights.exerciseTitle, dom.insights.exerciseBody, placeholderTitle, placeholderBody);
    setInsightText(dom.insights.nutritionTitle, dom.insights.nutritionBody, placeholderTitle, placeholderBody);
    setInsightText(dom.insights.bpTitle, dom.insights.bpBody, placeholderTitle, placeholderBody);
    setInsightText(dom.insights.weightTitle, dom.insights.weightBody, placeholderTitle, placeholderBody);

    if (!isSample) return;
    if (window.location.protocol === "file:") return;

    if (maxDayKey && maxDayKey < todayKey) {
      setInsightText(
        dom.insights.overallTitle,
        dom.insights.overallBody,
        "Not ready yet",
        `Today's data (${todayKey}) hasn't been generated yet.`
      );
      return;
    }

    void ensureAiInsights(profileId, todayKey, model).catch((err) => {
      const message = String(err?.message || err || "Could not generate AI insights.");
      setInsightText(dom.insights.overallTitle, dom.insights.overallBody, "AI insights unavailable", message);
      setInsightText(dom.insights.sleepTitle, dom.insights.sleepBody, "AI insights unavailable", "—");
      setInsightText(dom.insights.stressTitle, dom.insights.stressBody, "AI insights unavailable", "—");
      setInsightText(dom.insights.exerciseTitle, dom.insights.exerciseBody, "AI insights unavailable", "—");
      setInsightText(dom.insights.nutritionTitle, dom.insights.nutritionBody, "AI insights unavailable", "—");
      setInsightText(dom.insights.bpTitle, dom.insights.bpBody, "AI insights unavailable", "—");
      setInsightText(dom.insights.weightTitle, dom.insights.weightBody, "AI insights unavailable", "—");
    });
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

    clear() {
      this.series = null;
      this.hoverIndex = null;
      this.tooltipDiv.hidden = true;
      const ctx = this.canvas.getContext("2d");
      if (!ctx) return;
      ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
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

      let html = null;
      if (typeof this.series.tooltipHtml === "function") {
        try {
          html = this.series.tooltipHtml({ dayKey, value, index: this.hoverIndex });
        } catch {
          html = null;
        }
      }
      if (typeof html !== "string" || !html) {
        const digits = unit === "lb" || unit === "kg" || unit === "h" ? 1 : 0;
        const valueLabel =
          typeof value === "number" ? `${formatNumber(value, digits)} ${unit}` : "—";
        html = `<div class="tip-title">${escapeHtml(label)}</div>
          <div class="mono">${escapeHtml(formatDayWeekdayLong(dayKey))}</div>
          <div>${escapeHtml(valueLabel)}</div>`;
      }

      this.tooltipDiv.innerHTML = html;

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

      const overrideMin =
        typeof series.yMin === "number" && Number.isFinite(series.yMin) ? series.yMin : null;
      const overrideMax =
        typeof series.yMax === "number" && Number.isFinite(series.yMax) ? series.yMax : null;
      const snapStep =
        typeof series.ySnapStep === "number" && Number.isFinite(series.ySnapStep) && series.ySnapStep > 0
          ? series.ySnapStep
          : null;

      const barFloorAtZero =
        kind === "bar" &&
        (overrideMin === null || overrideMin === 0) &&
        (defined.length === 0 || min >= 0);
      if (barFloorAtZero) min = 0;
      if (overrideMin !== null) min = overrideMin;
      if (overrideMax !== null) max = overrideMax;
      if (max === min) {
        if (barFloorAtZero) {
          max += 1;
        } else {
          max += 1;
          min -= 1;
        }
      }

      if (
        overrideMin === null &&
        overrideMax === null &&
        snapStep !== null &&
        defined.length > 0
      ) {
        min = Math.floor(min / snapStep) * snapStep;
        max = Math.ceil(max / snapStep) * snapStep;
        if (max === min) {
          max += snapStep;
          min -= snapStep;
        }
        min -= snapStep;
        max += snapStep;
      } else if (overrideMin === null && overrideMax === null) {
        const pad = (max - min) * 0.08;
        max += pad;
        if (!barFloorAtZero) min -= pad;
      }

      if (barFloorAtZero) min = Math.max(0, min);

      const yFor = (v) => padT + ((max - v) / (max - min)) * plotH;

      // y labels
      const digits =
        typeof series.yLabelDigits === "number" && Number.isFinite(series.yLabelDigits)
          ? series.yLabelDigits
          : unit === "lb" || unit === "kg" || unit === "h"
            ? 1
            : 0;
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

      const barColorList = Array.isArray(series.barColors) ? series.barColors : null;
      const barColorFn = typeof series.barColor === "function" ? series.barColor : null;
      const barFillFor = (idx, v) => {
        const candidate = barColorList?.[idx];
        if (typeof candidate === "string" && candidate) return candidate;
        if (barColorFn) {
          try {
            const fnColor = barColorFn({ index: idx, dayKey: dates[idx], value: v });
            if (typeof fnColor === "string" && fnColor) return fnColor;
          } catch {
            // ignore
          }
        }
        return color;
      };

      if (n === 1) {
        const v = values[0];
        if (typeof v === "number") {
          if (kind === "bar") {
            const barW = 18;
            const x = padL;
            const y = yFor(v);
            ctx.globalAlpha = 0.85;
            ctx.fillStyle = barFillFor(0, v);
            ctx.fillRect(x - barW / 2, y, barW, padT + plotH - y);
            ctx.globalAlpha = 1;
          } else {
            ctx.beginPath();
            ctx.arc(padL, yFor(v), 3, 0, Math.PI * 2);
            ctx.fill();
          }
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
          ctx.fillStyle = barFillFor(i, v);
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
      const labelFor = (idx) =>
        n === 1 || n === 7 ? formatDayTickWeekday(dates[idx]) : dates[idx].slice(5);

      if (n === 1) {
        ctx.fillText(labelFor(0), padL, cssHeight - 6);
      } else {
        const labels = [0, Math.floor((n - 1) / 2), n - 1].filter(
          (v, idx, arr) => arr.indexOf(v) === idx
        );
        for (const idx of labels) {
          const x = padL + (plotW * idx) / (n - 1);
          ctx.textAlign = idx === 0 ? "left" : idx === n - 1 ? "right" : "center";
          ctx.fillText(labelFor(idx), x, cssHeight - 6);
        }
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

  class PairedLineChart {
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

    clear() {
      this.series = null;
      this.hoverIndex = null;
      this.tooltipDiv.hidden = true;
      const ctx = this.canvas.getContext("2d");
      if (!ctx) return;
      ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
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
      const { dates, systolic, diastolic, label, unit } = this.series;
      const dayKey = dates[this.hoverIndex];
      const sys = systolic[this.hoverIndex];
      const dia = diastolic[this.hoverIndex];

      let html = null;
      if (typeof this.series.tooltipHtml === "function") {
        try {
          html = this.series.tooltipHtml({
            dayKey,
            systolic: sys,
            diastolic: dia,
            index: this.hoverIndex,
          });
        } catch {
          html = null;
        }
      }

      if (typeof html !== "string" || !html) {
        const sysLabel = isFiniteNumber(sys) ? `${formatNumber(sys, 0)} ${unit}` : "—";
        const diaLabel = isFiniteNumber(dia) ? `${formatNumber(dia, 0)} ${unit}` : "—";
        html = `<div class="tip-title">${escapeHtml(label)}</div>
          <div class="mono">${escapeHtml(formatDayWeekdayLong(dayKey))}</div>
          <div class="tip-rows">
            <div class="tip-row"><span class="tip-label">Systolic</span><span class="tip-value">${escapeHtml(
              sysLabel
            )}</span></div>
            <div class="tip-row"><span class="tip-label">Diastolic</span><span class="tip-value">${escapeHtml(
              diaLabel
            )}</span></div>
          </div>`;
      }

      this.tooltipDiv.innerHTML = html;
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

      const { dates, systolic, diastolic } = series;
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
      const defined = []
        .concat(systolic ?? [], diastolic ?? [])
        .filter((v) => typeof v === "number" && Number.isFinite(v));
      let min = defined.length > 0 ? Math.min(...defined) : 0;
      let max = defined.length > 0 ? Math.max(...defined) : 1;
      if (max === min) {
        max += 1;
        min -= 1;
      }
      const pad = (max - min) * 0.08;
      max += pad;
      min -= pad;

      const yFor = (v) => padT + ((max - v) / (max - min)) * plotH;

      // y labels
      ctx.fillStyle = colors.chartLabel;
      ctx.font = "11px ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, 'Liberation Mono', 'Courier New', monospace";
      ctx.textAlign = "left";
      ctx.textBaseline = "middle";
      ctx.fillText(formatNumber(max, 0), 6, padT);
      ctx.fillText(formatNumber((min + max) / 2, 0), 6, padT + plotH / 2);
      ctx.fillText(formatNumber(min, 0), 6, padT + plotH);

      const step = n > 1 ? plotW / (n - 1) : 0;

      const drawLine = (values, strokeStyle) => {
        ctx.strokeStyle = strokeStyle;
        ctx.lineWidth = 2;
        ctx.beginPath();
        let started = false;
        for (let i = 0; i < n; i += 1) {
          const v = values?.[i];
          if (typeof v !== "number" || !Number.isFinite(v)) continue;
          const x = n === 1 ? padL : padL + i * step;
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
        ctx.fillStyle = strokeStyle;
        for (let i = 0; i < n; i += 1) {
          const v = values?.[i];
          if (typeof v !== "number" || !Number.isFinite(v)) continue;
          const x = n === 1 ? padL : padL + i * step;
          const y = yFor(v);
          ctx.globalAlpha = 0.9;
          ctx.beginPath();
          ctx.arc(x, y, 2.2, 0, Math.PI * 2);
          ctx.fill();
          ctx.globalAlpha = 1;
        }
      };

      const systolicColor =
        typeof series.systolicColor === "string" && series.systolicColor
          ? series.systolicColor
          : "#007AFF";
      const diastolicColor =
        typeof series.diastolicColor === "string" && series.diastolicColor
          ? series.diastolicColor
          : "rgba(0, 122, 255, 0.55)";

      drawLine(diastolic, diastolicColor);
      drawLine(systolic, systolicColor);

      // x labels (first/middle/last)
      ctx.fillStyle = colors.chartLabel;
      ctx.font = "11px ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, 'Liberation Mono', 'Courier New', monospace";
      ctx.textBaseline = "alphabetic";
      ctx.textAlign = "center";
      const labelFor = (idx) =>
        n === 1 || n === 7 ? formatDayTickWeekday(dates[idx]) : dates[idx].slice(5);

      if (n === 1) {
        ctx.fillText(labelFor(0), padL, cssHeight - 6);
      } else {
        const labels = [0, Math.floor((n - 1) / 2), n - 1].filter(
          (v, idx, arr) => arr.indexOf(v) === idx
        );
        for (const idx of labels) {
          const x = padL + (plotW * idx) / (n - 1);
          ctx.textAlign = idx === 0 ? "left" : idx === n - 1 ? "right" : "center";
          ctx.fillText(labelFor(idx), x, cssHeight - 6);
        }
      }

      // hover marker
      if (this.hoverIndex !== null && n > 1) {
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

	  const focusCharts = {
	    sleep: new MiniChart(dom.focusCharts.sleep, dom.tooltip, { heightPx: 120 }),
	    stress: new MiniChart(dom.focusCharts.stress, dom.tooltip, { heightPx: 120 }),
	    exercise: new MiniChart(dom.focusCharts.exercise, dom.tooltip, { heightPx: 120 }),
	    nutritionCalories: new MiniChart(dom.focusCharts.nutritionCalories, dom.tooltip, {
	      heightPx: 110,
	    }),
	    bp: new PairedLineChart(dom.focusCharts.bp, dom.tooltip, { heightPx: 120 }),
	    weight: new MiniChart(dom.focusCharts.weight, dom.tooltip, { heightPx: 120 }),
	  };

  const colorSchemeMedia = window.matchMedia?.("(prefers-color-scheme: dark)") ?? null;
  const onThemeChange = () => {
    updateThemeColors();
    for (const chart of Object.values(focusCharts)) chart.render();
  };
  if (colorSchemeMedia) {
    if (typeof colorSchemeMedia.addEventListener === "function") {
      colorSchemeMedia.addEventListener("change", onThemeChange);
    } else if (typeof colorSchemeMedia.addListener === "function") {
      colorSchemeMedia.addListener(onThemeChange);
    }
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

    const userId =
      typeof payload.user?.id === "string" && payload.user.id.trim()
        ? payload.user.id.trim()
        : null;
    const userName =
      typeof payload.user?.name === "string" && payload.user.name.trim()
        ? payload.user.name.trim()
        : null;

    setHelloName(pickUserDisplayName(payload.user));

    const timeZone =
      typeof payload.user.tz === "string" && validateTimeZone(payload.user.tz)
        ? payload.user.tz
        : DEFAULT_TZ;

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

    const model = {
      days,
      minDayKey,
      maxDayKey,
      recordCount: normalized.length,
      sources,
      timeZone,
      userId,
      userName,
    };

    currentModel = model;
    renderFocus(model);
    renderInsights(model);
    setStatus("Done", "success");
  }

  const SAMPLE_PROFILE_DEFAULT = "baseline-barry";
  let activeSampleProfile = SAMPLE_PROFILE_DEFAULT;

  const SAMPLE_PROFILES = Object.freeze({
    "baseline-barry": {
      name: "Barry",
      sources: {
        sleep: "Wearable",
        workout: "Training App",
        nutrition: "Food Log",
        bp: "BP Cuff",
        weight: "Smart Scale",
      },
      sleep: {
        meanStart: 7.6,
        meanEnd: 7.6,
        sdHours: 0.35,
        weekendDelta: 0.45,
        minHours: 5.5,
        maxHours: 9.2,
        wakeWeekday: { hour: 6, minute: 45 },
        wakeWeekend: { hour: 7, minute: 35 },
        wakeJitterMin: 14,
        respirationBase: 15.2,
      },
      rhr: {
        baseStart: 56,
        baseEnd: 56,
        sd: 1.2,
        poorSleepBpmDelta: 2.0,
        prevLoadBpmPerHour: 0.8,
        time: { hour: 7, minute: 45 },
      },
      nutrition: {
        caloriesStart: 2400,
        caloriesEnd: 2400,
        sdCalories: 150,
        weekendDelta: 160,
        minCalories: 1700,
        maxCalories: 3200,
        proteinStart: 140,
        proteinEnd: 140,
        sdProtein: 10,
        minProtein: 70,
        maxProtein: 220,
        fatStart: 85,
        fatEnd: 85,
        sdFat: 8,
        minFat: 40,
        maxFat: 140,
        minCarbs: 80,
        maxCarbs: 520,
        sugarBase: 35,
        sugarSd: 10,
        poorSleepSugarDelta: 14,
        time: { hour: 19, minute: 0 },
      },
      bp: {
        sysStart: 118,
        sysEnd: 118,
        diaStart: 76,
        diaEnd: 76,
        sdSys: 4,
        sdDia: 3,
        poorSleepSysDelta: 2,
        poorSleepDiaDelta: 1,
        time: { hour: 8, minute: 25 },
      },
      weight: {
        lbStart: 182,
        lbEnd: 182,
        follow: 0.25,
        sd: 0.25,
        workoutFactor: 0.25,
        time: { hour: 7, minute: 10 },
      },
      steps: {
        baseStart: 8200,
        baseEnd: 8600,
        sd: 1400,
        workoutBonus: 1200,
        time: { hour: 21, minute: 30 },
      },
      exercise: {
        weekdays: [1, 3, 6], // Mon/Wed/Sat
        activities: ["Strength", "Run", "Cycling"],
        durationStart: 45,
        durationEnd: 55,
        sdMinutes: 10,
        caloriesPerMin: 8.2,
        easyPct: 0.1,
        hardPct: 0.2,
        maxWorkoutsPerDay: 1,
        startHour: 17,
        startMinute: 45,
      },
    },

    "weightloss-wally": {
      name: "Wally",
      sources: {
        sleep: "Wearable",
        workout: "Training App",
        nutrition: "Food Log",
        bp: "BP Cuff",
        weight: "Smart Scale",
      },
      sleep: {
        meanStart: 7.0,
        meanEnd: 7.2,
        sdHours: 0.45,
        weekendDelta: 0.5,
        minHours: 5.2,
        maxHours: 9.0,
        wakeWeekday: { hour: 6, minute: 30 },
        wakeWeekend: { hour: 7, minute: 40 },
        wakeJitterMin: 16,
        respirationBase: 15.6,
      },
      rhr: {
        baseStart: 61,
        baseEnd: 58,
        sd: 1.6,
        poorSleepBpmDelta: 2.3,
        prevLoadBpmPerHour: 1.0,
        time: { hour: 7, minute: 40 },
      },
      nutrition: {
        caloriesStart: 2250,
        caloriesEnd: 2125,
        sdCalories: 140,
        weekendDelta: 220,
        minCalories: 1600,
        maxCalories: 3200,
        proteinStart: 160,
        proteinEnd: 155,
        sdProtein: 12,
        minProtein: 90,
        maxProtein: 230,
        fatStart: 75,
        fatEnd: 70,
        sdFat: 10,
        minFat: 40,
        maxFat: 130,
        minCarbs: 90,
        maxCarbs: 450,
        sugarBase: 38,
        sugarSd: 12,
        poorSleepSugarDelta: 16,
        time: { hour: 19, minute: 10 },
      },
      bp: {
        sysStart: 126,
        sysEnd: 121,
        diaStart: 82,
        diaEnd: 79,
        sdSys: 5,
        sdDia: 3,
        poorSleepSysDelta: 2,
        poorSleepDiaDelta: 1,
        time: { hour: 8, minute: 20 },
      },
      weight: {
        lbStart: 210,
        lbEnd: 204,
        follow: 0.24,
        sd: 0.28,
        workoutFactor: 0.35,
        time: { hour: 7, minute: 15 },
      },
      steps: {
        baseStart: 8600,
        baseEnd: 9800,
        sd: 1500,
        workoutBonus: 1700,
        time: { hour: 21, minute: 35 },
      },
      exercise: {
        weekdays: [1, 3, 5], // Mon/Wed/Fri
        activities: ["Strength", "Incline walk", "Run"],
        durationStart: 42,
        durationEnd: 55,
        sdMinutes: 10,
        caloriesPerMin: 7.8,
        easyPct: 0.2,
        hardPct: 0.2,
        maxWorkoutsPerDay: 1,
        startHour: 17,
        startMinute: 30,
      },
    },

    "athlete-anna": {
      name: "Anna",
      sources: {
        sleep: "Wearable",
        workout: "Training App",
        nutrition: "Food Log",
        bp: "BP Cuff",
        weight: "Smart Scale",
      },
      sleep: {
        meanStart: 7.9,
        meanEnd: 8.1,
        sdHours: 0.3,
        weekendDelta: 0.35,
        minHours: 6.4,
        maxHours: 9.4,
        wakeWeekday: { hour: 6, minute: 15 },
        wakeWeekend: { hour: 7, minute: 20 },
        wakeJitterMin: 12,
        respirationBase: 14.6,
      },
      rhr: {
        baseStart: 54,
        baseEnd: 53,
        sd: 1.0,
        poorSleepBpmDelta: 1.8,
        prevLoadBpmPerHour: 1.2,
        time: { hour: 7, minute: 20 },
      },
      nutrition: {
        caloriesStart: 2600,
        caloriesEnd: 2850,
        sdCalories: 180,
        weekendDelta: 160,
        minCalories: 1900,
        maxCalories: 3600,
        proteinStart: 120,
        proteinEnd: 180,
        sdProtein: 10,
        minProtein: 90,
        maxProtein: 240,
        fatStart: 78,
        fatEnd: 85,
        sdFat: 9,
        minFat: 45,
        maxFat: 150,
        minCarbs: 130,
        maxCarbs: 600,
        sugarBase: 30,
        sugarSd: 10,
        poorSleepSugarDelta: 12,
        time: { hour: 18, minute: 40 },
      },
      bp: {
        sysStart: 116,
        sysEnd: 115,
        diaStart: 74,
        diaEnd: 73,
        sdSys: 4,
        sdDia: 3,
        poorSleepSysDelta: 1,
        poorSleepDiaDelta: 1,
        time: { hour: 8, minute: 10 },
      },
      weight: {
        lbStart: 145,
        lbEnd: 145,
        follow: 0.3,
        sd: 0.22,
        workoutFactor: 0.25,
        time: { hour: 7, minute: 5 },
      },
      steps: {
        baseStart: 9500,
        baseEnd: 11200,
        sd: 1700,
        workoutBonus: 1800,
        time: { hour: 21, minute: 25 },
      },
      exercise: {
        weekdays: [1, 2, 4, 5, 6], // Mon/Tue/Thu/Fri/Sat
        activities: ["Run", "Strength", "Cycling", "Intervals", "Mobility"],
        durationStart: 55,
        durationEnd: 75,
        sdMinutes: 12,
        caloriesPerMin: 9.2,
        easyPct: 0.15,
        hardPct: 0.35,
        maxWorkoutsPerDay: 2,
        startHour: 17,
        startMinute: 35,
      },
    },

    "protein-paul": {
      name: "Paul",
      sources: {
        sleep: "Wearable",
        workout: "Training App",
        nutrition: "Food Log",
        bp: "BP Cuff",
        weight: "Smart Scale",
      },
      sleep: {
        meanStart: 7.3,
        meanEnd: 7.4,
        sdHours: 0.45,
        weekendDelta: 0.55,
        minHours: 5.6,
        maxHours: 9.3,
        wakeWeekday: { hour: 7, minute: 0 },
        wakeWeekend: { hour: 8, minute: 10 },
        wakeJitterMin: 18,
        respirationBase: 15.0,
      },
      rhr: {
        baseStart: 59,
        baseEnd: 59,
        sd: 1.4,
        poorSleepBpmDelta: 2.0,
        prevLoadBpmPerHour: 0.9,
        time: { hour: 8, minute: 5 },
      },
      nutrition: {
        caloriesStart: 2150,
        caloriesEnd: 2150,
        sdCalories: 160,
        weekendDelta: 150,
        minCalories: 1600,
        maxCalories: 3100,
        proteinStart: 55,
        proteinEnd: 65,
        sdProtein: 8,
        minProtein: 30,
        maxProtein: 140,
        fatStart: 82,
        fatEnd: 80,
        sdFat: 10,
        minFat: 45,
        maxFat: 140,
        minCarbs: 120,
        maxCarbs: 500,
        sugarBase: 28,
        sugarSd: 10,
        poorSleepSugarDelta: 10,
        time: { hour: 19, minute: 20 },
      },
      bp: {
        sysStart: 121,
        sysEnd: 120,
        diaStart: 78,
        diaEnd: 77,
        sdSys: 5,
        sdDia: 3,
        poorSleepSysDelta: 2,
        poorSleepDiaDelta: 1,
        time: { hour: 8, minute: 35 },
      },
      weight: {
        lbStart: 175,
        lbEnd: 175,
        follow: 0.25,
        sd: 0.25,
        workoutFactor: 0.25,
        time: { hour: 7, minute: 55 },
      },
      steps: {
        baseStart: 7200,
        baseEnd: 7800,
        sd: 1400,
        workoutBonus: 1000,
        time: { hour: 21, minute: 40 },
      },
      exercise: {
        weekdays: [2, 4], // Tue/Thu
        activities: ["Yoga", "Walk", "Bike"],
        durationStart: 30,
        durationEnd: 40,
        sdMinutes: 8,
        caloriesPerMin: 5.8,
        easyPct: 0.5,
        hardPct: 0.05,
        maxWorkoutsPerDay: 1,
        startHour: 17,
        startMinute: 50,
      },
    },

    "hypertension-holly": {
      name: "Holly",
      sources: {
        sleep: "Wearable",
        workout: "Training App",
        nutrition: "Food Log",
        bp: "BP Cuff",
        weight: "Smart Scale",
      },
      sleep: {
        meanStart: 6.6,
        meanEnd: 7.2,
        sdHours: 0.55,
        weekendDelta: 0.6,
        minHours: 5.1,
        maxHours: 9.2,
        wakeWeekday: { hour: 6, minute: 25 },
        wakeWeekend: { hour: 7, minute: 45 },
        wakeJitterMin: 18,
        respirationBase: 16.0,
      },
      rhr: {
        baseStart: 62,
        baseEnd: 58,
        sd: 1.7,
        poorSleepBpmDelta: 2.8,
        prevLoadBpmPerHour: 1.0,
        time: { hour: 7, minute: 35 },
      },
      nutrition: {
        caloriesStart: 2250,
        caloriesEnd: 2050,
        sdCalories: 170,
        weekendDelta: 180,
        minCalories: 1600,
        maxCalories: 3300,
        proteinStart: 110,
        proteinEnd: 125,
        sdProtein: 10,
        minProtein: 70,
        maxProtein: 200,
        fatStart: 75,
        fatEnd: 70,
        sdFat: 10,
        minFat: 40,
        maxFat: 140,
        minCarbs: 120,
        maxCarbs: 520,
        sugarBase: 34,
        sugarSd: 12,
        poorSleepSugarDelta: 14,
        time: { hour: 18, minute: 55 },
      },
      bp: {
        sysStart: 145,
        sysEnd: 128,
        diaStart: 92,
        diaEnd: 82,
        sdSys: 6,
        sdDia: 4,
        poorSleepSysDelta: 3,
        poorSleepDiaDelta: 2,
        time: { hour: 8, minute: 15 },
      },
      weight: {
        lbStart: 168,
        lbEnd: 165,
        follow: 0.22,
        sd: 0.3,
        workoutFactor: 0.28,
        time: { hour: 7, minute: 20 },
      },
      steps: {
        baseStart: 7600,
        baseEnd: 9000,
        sd: 1700,
        workoutBonus: 1600,
        time: { hour: 21, minute: 30 },
      },
      exercise: {
        weekdays: [0, 2, 4, 6], // Sun/Tue/Thu/Sat
        activities: ["Walk", "Cycling", "Strength"],
        durationStart: 30,
        durationEnd: 48,
        sdMinutes: 10,
        caloriesPerMin: 6.8,
        easyPct: 0.35,
        hardPct: 0.15,
        maxWorkoutsPerDay: 1,
        startHour: 17,
        startMinute: 15,
      },
    },

    "chronic-chloe": {
      name: "Chloe",
      sources: {
        sleep: "Wearable",
        workout: "Training App",
        nutrition: "Food Log",
        bp: "BP Cuff",
        weight: "Smart Scale",
      },
      sleep: {
        meanStart: 5.7,
        meanEnd: 5.8,
        sdHours: 0.75,
        weekendDelta: 1.2,
        minHours: 3.8,
        maxHours: 8.8,
        wakeWeekday: { hour: 6, minute: 10 },
        wakeWeekend: { hour: 9, minute: 5 },
        wakeJitterMin: 22,
        respirationBase: 17.8,
      },
      rhr: {
        baseStart: 69,
        baseEnd: 71,
        sd: 2.2,
        poorSleepBpmDelta: 4.2,
        prevLoadBpmPerHour: 1.4,
        time: { hour: 7, minute: 55 },
      },
      nutrition: {
        caloriesStart: 2550,
        caloriesEnd: 2650,
        sdCalories: 260,
        weekendDelta: 300,
        minCalories: 1500,
        maxCalories: 3800,
        proteinStart: 80,
        proteinEnd: 90,
        sdProtein: 14,
        minProtein: 45,
        maxProtein: 200,
        fatStart: 95,
        fatEnd: 100,
        sdFat: 16,
        minFat: 45,
        maxFat: 180,
        minCarbs: 140,
        maxCarbs: 650,
        sugarBase: 62,
        sugarSd: 20,
        poorSleepSugarDelta: 22,
        time: { hour: 20, minute: 5 },
      },
      bp: {
        sysStart: 132,
        sysEnd: 134,
        diaStart: 86,
        diaEnd: 88,
        sdSys: 7,
        sdDia: 5,
        poorSleepSysDelta: 4,
        poorSleepDiaDelta: 3,
        time: { hour: 9, minute: 10 },
      },
      weight: {
        lbStart: 155,
        lbEnd: 160,
        follow: 0.22,
        sd: 0.35,
        workoutFactor: 0.15,
        time: { hour: 8, minute: 50 },
      },
      steps: {
        baseStart: 5200,
        baseEnd: 5200,
        sd: 1200,
        workoutBonus: 900,
        time: { hour: 21, minute: 45 },
      },
      exercise: {
        weekdays: [6], // Saturday only
        activities: ["Walk", "Mobility"],
        durationStart: 22,
        durationEnd: 32,
        sdMinutes: 7,
        caloriesPerMin: 5.3,
        easyPct: 0.7,
        hardPct: 0.0,
        maxWorkoutsPerDay: 1,
        startHour: 16,
        startMinute: 30,
      },
    },
  });

  function updateProfileButtonsUI() {
    for (const btn of document.querySelectorAll("button[data-profile]")) {
      const profileId = btn.dataset.profile || "";
      btn.setAttribute("aria-pressed", profileId === activeSampleProfile ? "true" : "false");
    }
  }

  const STORAGE_VERSION = 1;
  const STORAGE_KEYS = Object.freeze({
    samplePrefix: `mhp.sample.v${STORAGE_VERSION}:`,
    insightsPrefix: `mhp.insights.v${STORAGE_VERSION}:`,
  });

  function safeStorageGet(key) {
    try {
      return window.localStorage.getItem(key);
    } catch {
      return null;
    }
  }

  function safeStorageSet(key, value) {
    try {
      window.localStorage.setItem(key, value);
      return true;
    } catch {
      return false;
    }
  }

  function readStoredJson(key) {
    const raw = safeStorageGet(key);
    if (typeof raw !== "string" || !raw) return null;
    try {
      return JSON.parse(raw);
    } catch {
      return null;
    }
  }

  function writeStoredJson(key, value) {
    try {
      return safeStorageSet(key, JSON.stringify(value));
    } catch {
      return false;
    }
  }

  function isDayKey(value) {
    return typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value);
  }

  function getTodayKey() {
    return formatDayKey(new Date(), APP_TZ);
  }

  const SAMPLE_VISIBLE_DAYS = 35;
  const SAMPLE_TOTAL_DAYS = SAMPLE_VISIBLE_DAYS + CONFIG.baselineLookbackDays;

  function sampleStateKey(profileId) {
    return `${STORAGE_KEYS.samplePrefix}${profileId}`;
  }

  function getSampleState(profileId) {
    const stored = readStoredJson(sampleStateKey(profileId));
    if (!isPlainObject(stored)) return null;
    if (stored.v !== STORAGE_VERSION) return null;
    if (stored.profileId !== profileId) return null;
    if (!isDayKey(stored.startDayKey)) return null;
    if (!isDayKey(stored.lastDayKey)) return null;
    if (!isPlainObject(stored.payload)) return null;
    if (!Array.isArray(stored.payload.records)) return null;
    return stored;
  }

  function putSampleState(profileId, state) {
    if (!isPlainObject(state)) return false;
    return writeStoredJson(sampleStateKey(profileId), state);
  }

  function getOrCreateSamplePayload(profileId) {
    const todayKey = getTodayKey();
    const tz = APP_TZ;
    const existing = getSampleState(profileId);

    if (!existing) {
      const startDayKey = addDaysToKey(todayKey, -(SAMPLE_TOTAL_DAYS - 1));
      const payload = buildSampleProfilePayload(profileId, tz, { startDayKey, endDayKey: todayKey });
      putSampleState(profileId, {
        v: STORAGE_VERSION,
        profileId,
        tz,
        startDayKey,
        lastDayKey: todayKey,
        payload,
      });
      return payload;
    }

    const storedTz = typeof existing.tz === "string" ? existing.tz.trim() : "";
    const storedUserTz =
      isPlainObject(existing.payload.user) && typeof existing.payload.user.tz === "string"
        ? existing.payload.user.tz.trim()
        : "";
    const needsTzRefresh = storedTz !== tz || storedUserTz !== tz;
    if (existing.lastDayKey >= todayKey && !needsTzRefresh) return existing.payload;

    try {
      const payload = buildSampleProfilePayload(profileId, tz, {
        startDayKey: existing.startDayKey,
        endDayKey: todayKey,
      });
      putSampleState(profileId, {
        ...existing,
        tz,
        lastDayKey: todayKey,
        payload,
      });
      return payload;
    } catch {
      return existing.payload;
    }
  }

  function insightsCacheKey(profileId, dayKey) {
    return `${STORAGE_KEYS.insightsPrefix}${profileId}:${dayKey}`;
  }

  function getCachedInsights(profileId, dayKey) {
    const stored = readStoredJson(insightsCacheKey(profileId, dayKey));
    if (!isPlainObject(stored)) return null;
    if (stored.v !== STORAGE_VERSION) return null;
    if (stored.profileId !== profileId) return null;
    if (stored.dayKey !== dayKey) return null;
    if (!isPlainObject(stored.insights)) return null;
    return stored;
  }

  function putCachedInsights(profileId, dayKey, entry) {
    const payload = isPlainObject(entry) ? entry : {};
    return writeStoredJson(insightsCacheKey(profileId, dayKey), {
      ...payload,
      v: STORAGE_VERSION,
      profileId,
      dayKey,
      generatedAt: new Date().toISOString(),
    });
  }

  const insightRequestInFlight = new Map();

  function hashSeed(str) {
    let h = 2166136261;
    const s = String(str ?? "");
    for (let i = 0; i < s.length; i += 1) {
      h ^= s.charCodeAt(i);
      h = Math.imul(h, 16777619);
    }
    return h >>> 0;
  }

  function makeRng(seedString) {
    let state = hashSeed(seedString) >>> 0;
    return () => {
      state = (1664525 * state + 1013904223) >>> 0;
      return state / 2 ** 32;
    };
  }

  function lerp(a, b, t) {
    return a + (b - a) * t;
  }

  function randNormal(rng) {
    let u = 0;
    let v = 0;
    while (u === 0) u = rng();
    while (v === 0) v = rng();
    return Math.sqrt(-2.0 * Math.log(u)) * Math.cos(2.0 * Math.PI * v);
  }

  function dayOfWeekFromDayKey(dayKey) {
    return new Date(`${dayKey}T00:00:00Z`).getUTCDay();
  }

  function parseDayKeyParts(dayKey) {
    const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(dayKey ?? ""));
    if (!m) return null;
    const year = Number(m[1]);
    const month = Number(m[2]);
    const day = Number(m[3]);
    if (!Number.isFinite(year) || !Number.isFinite(month) || !Number.isFinite(day)) return null;
    return { year, month, day };
  }

  const zonedPartsFormatterCache = new Map();
  function getZonedParts(date, timeZone) {
    const tz = validateTimeZone(timeZone) ? timeZone : DEFAULT_TZ;
    let fmt = zonedPartsFormatterCache.get(tz);
    if (!fmt) {
      fmt = new Intl.DateTimeFormat("en-US", {
        timeZone: tz,
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
        hour: "2-digit",
        minute: "2-digit",
        hour12: false,
      });
      zonedPartsFormatterCache.set(tz, fmt);
    }
    const parts = fmt.formatToParts(date);
    const out = {};
    for (const p of parts) {
      if (p.type === "year") out.year = Number(p.value);
      if (p.type === "month") out.month = Number(p.value);
      if (p.type === "day") out.day = Number(p.value);
      if (p.type === "hour") out.hour = Number(p.value);
      if (p.type === "minute") out.minute = Number(p.value);
    }
    return {
      year: out.year,
      month: out.month,
      day: out.day,
      hour: out.hour,
      minute: out.minute,
    };
  }

  function zonedDateTimeToUtc(dayKey, hour, minute, timeZone) {
    const tz = validateTimeZone(timeZone) ? timeZone : DEFAULT_TZ;
    const parts = parseDayKeyParts(dayKey);
    if (!parts) return new Date(`${dayKey}T00:00:00Z`);
    const desiredUtc = Date.UTC(parts.year, parts.month - 1, parts.day, hour, minute, 0, 0);
    let guess = new Date(desiredUtc);

    for (let i = 0; i < 3; i += 1) {
      const actual = getZonedParts(guess, tz);
      const actualAsUtc = Date.UTC(
        actual.year,
        actual.month - 1,
        actual.day,
        actual.hour,
        actual.minute,
        0,
        0
      );
      const diff = desiredUtc - actualAsUtc;
      if (Math.abs(diff) < 1000) break;
      guess = new Date(guess.getTime() + diff);
    }

    return guess;
  }

  function pickIntensity(exerciseCfg, rng) {
    const easyPct = isFiniteNumber(exerciseCfg?.easyPct) ? exerciseCfg.easyPct : 0;
    const hardPct = isFiniteNumber(exerciseCfg?.hardPct) ? exerciseCfg.hardPct : 0;
    const r = rng();
    if (r < easyPct) return "easy";
    if (r < easyPct + hardPct) return "hard";
    return "moderate";
  }

  function buildWorkoutsForDay(profile, { dayKey, dow, storyT, rng }) {
    const exerciseCfg = profile.exercise;
    if (!exerciseCfg || !Array.isArray(exerciseCfg.weekdays) || !exerciseCfg.weekdays.includes(dow)) {
      return [];
    }

    const maxPerDay = Math.max(
      1,
      Math.min(2, Number.isFinite(exerciseCfg.maxWorkoutsPerDay) ? exerciseCfg.maxWorkoutsPerDay : 1)
    );
    const workoutCount = maxPerDay === 2 && rng() < 0.2 ? 2 : 1;

    const activities = Array.isArray(exerciseCfg.activities) && exerciseCfg.activities.length > 0
      ? exerciseCfg.activities
      : ["Workout"];

    const baseDuration = lerp(exerciseCfg.durationStart, exerciseCfg.durationEnd, storyT);
    const sd = isFiniteNumber(exerciseCfg.sdMinutes) ? exerciseCfg.sdMinutes : 10;
    const out = [];

    for (let i = 0; i < workoutCount; i += 1) {
      const activity = activities[(hashSeed(`${dayKey}:${i}:${profile.name}`) + dow) % activities.length];
      const durationMin = clamp(
        Math.round((baseDuration * (i === 0 ? 1 : 0.55)) + randNormal(rng) * sd),
        12,
        160
      );
      out.push({
        activity,
        durationMin,
        intensity: pickIntensity(exerciseCfg, rng),
        startHour: Number.isFinite(exerciseCfg.startHour) ? exerciseCfg.startHour : 17,
        startMinute: Number.isFinite(exerciseCfg.startMinute) ? exerciseCfg.startMinute : 45,
        caloriesPerMin: isFiniteNumber(exerciseCfg.caloriesPerMin) ? exerciseCfg.caloriesPerMin : 7.5,
      });
    }

    return out;
  }

  function buildSampleProfilePayload(profileId, timeZone, opts = {}) {
    const tz = validateTimeZone(timeZone) ? timeZone : DEFAULT_TZ;
    const profile = SAMPLE_PROFILES[profileId] ?? SAMPLE_PROFILES[SAMPLE_PROFILE_DEFAULT];

    const endDayKey =
      isDayKey(opts.endDayKey) ? opts.endDayKey : formatDayKey(new Date(), tz);
    const warmupDays = CONFIG.baselineLookbackDays;
    const storyDays = SAMPLE_VISIBLE_DAYS;
    const startDayKey = isDayKey(opts.startDayKey)
      ? opts.startDayKey
      : addDaysToKey(endDayKey, -(SAMPLE_TOTAL_DAYS - 1));

    const startUtc = new Date(`${startDayKey}T00:00:00Z`);
    const endUtc = new Date(`${endDayKey}T00:00:00Z`);
    const totalDays =
      Number.isFinite(startUtc.getTime()) && Number.isFinite(endUtc.getTime())
        ? Math.max(
            1,
            Math.round((endUtc.getTime() - startUtc.getTime()) / 86400000) + 1
          )
        : SAMPLE_TOTAL_DAYS;

    const rng = makeRng(`${profileId}:${startDayKey}`);
    const records = [];

    let weightLb = profile.weight.lbStart + randNormal(rng) * 0.4;
    let prevWorkoutLoad = 0;

    for (let i = 0; i < totalDays; i += 1) {
      const dayKey = addDaysToKey(startDayKey, i);
      const dow = dayOfWeekFromDayKey(dayKey);
      const isWeekend = dow === 0 || dow === 6;
      const storyT =
        i < warmupDays
          ? 0
          : clamp01((i - warmupDays) / Math.max(1, storyDays - 1));

      // Sleep session (ends on dayKey morning)
      const wakeCfg = isWeekend ? profile.sleep.wakeWeekend : profile.sleep.wakeWeekday;
      const wakeBase = zonedDateTimeToUtc(dayKey, wakeCfg.hour, wakeCfg.minute, tz);
      const wakeJitterMs =
        randNormal(rng) * (isFiniteNumber(profile.sleep.wakeJitterMin) ? profile.sleep.wakeJitterMin : 15) * 60000;
      const wake = new Date(wakeBase.getTime() + wakeJitterMs);

      const sleepMean =
        lerp(profile.sleep.meanStart, profile.sleep.meanEnd, storyT) +
        (isWeekend ? profile.sleep.weekendDelta : 0);
      const sleepHours = clamp(
        sleepMean + randNormal(rng) * profile.sleep.sdHours,
        profile.sleep.minHours,
        profile.sleep.maxHours
      );

      const sleepStart = new Date(wake.getTime() - sleepHours * 60 * 60 * 1000);
      const respiration = clamp(
        (profile.sleep.respirationBase ?? 15.4) + randNormal(rng) * 0.9 + (sleepHours < 6 ? 1.2 : 0),
        10,
        22
      );
      const quality = clamp01(0.62 + (sleepHours - 7) * 0.08 + randNormal(rng) * 0.06);

      records.push({
        type: "sleep_session",
        start: sleepStart.toISOString(),
        end: wake.toISOString(),
        data: {
          quality: Number(quality.toFixed(2)),
          respiration_rpm: Number(respiration.toFixed(1)),
        },
        source: profile.sources.sleep,
      });

      // Exercise (not every day)
      const workouts = buildWorkoutsForDay(profile, { dayKey, dow, storyT, rng });
      let dayWorkoutLoad = 0;
      let dayWorkoutCalories = 0;
      for (let w = 0; w < workouts.length; w += 1) {
        const item = workouts[w];
        const start = zonedDateTimeToUtc(dayKey, item.startHour, item.startMinute, tz);
        const end = new Date(start.getTime() + item.durationMin * 60000);
        const intensityFactor =
          item.intensity === "hard" ? 1.35 : item.intensity === "easy" ? 0.8 : 1.0;
        const calories = Math.round(item.durationMin * item.caloriesPerMin * intensityFactor);
        dayWorkoutLoad += item.durationMin * intensityFactor;
        dayWorkoutCalories += calories;

        records.push({
          type: "workout",
          start: start.toISOString(),
          end: end.toISOString(),
          data: {
            activity: item.activity,
            duration_min: item.durationMin,
            calories,
            intensity: item.intensity,
          },
          source: profile.sources.workout,
        });
      }

      // Resting HR (morning)
      const rhrBase = lerp(profile.rhr.baseStart, profile.rhr.baseEnd, storyT);
      const rhr = clamp(
        rhrBase +
          randNormal(rng) * profile.rhr.sd +
          (sleepHours < 6 ? profile.rhr.poorSleepBpmDelta : 0) +
          (prevWorkoutLoad > 0 ? (prevWorkoutLoad / 60) * profile.rhr.prevLoadBpmPerHour : 0),
        42,
        120
      );
      const rhrTs = zonedDateTimeToUtc(dayKey, profile.rhr.time.hour, profile.rhr.time.minute, tz);
      records.push({
        type: "resting_heart_rate",
        timestamp: rhrTs.toISOString(),
        data: { bpm: Math.round(rhr) },
        source: profile.sources.sleep,
      });

      // Nutrition (daily)
      const calMean =
        lerp(profile.nutrition.caloriesStart, profile.nutrition.caloriesEnd, storyT) +
        (isWeekend ? profile.nutrition.weekendDelta : 0);
      let calories = Math.round(calMean + randNormal(rng) * profile.nutrition.sdCalories);
      calories = clamp(calories, profile.nutrition.minCalories, profile.nutrition.maxCalories);

      let protein_g = Math.round(
        lerp(profile.nutrition.proteinStart, profile.nutrition.proteinEnd, storyT) +
          randNormal(rng) * profile.nutrition.sdProtein
      );
      protein_g = clamp(protein_g, profile.nutrition.minProtein, profile.nutrition.maxProtein);

      let fat_g = Math.round(
        lerp(profile.nutrition.fatStart, profile.nutrition.fatEnd, storyT) +
          randNormal(rng) * profile.nutrition.sdFat
      );
      fat_g = clamp(fat_g, profile.nutrition.minFat, profile.nutrition.maxFat);

      let sugar_g = Math.round(
        (profile.nutrition.sugarBase ?? 32) +
          randNormal(rng) * (profile.nutrition.sugarSd ?? 12) +
          (sleepHours < 6 ? profile.nutrition.poorSleepSugarDelta : 0)
      );
      sugar_g = clamp(sugar_g, 5, 200);

      const remaining = Math.max(0, calories - protein_g * 4 - fat_g * 9);
      let carbs_g = Math.round(remaining / 4);
      carbs_g = clamp(carbs_g, profile.nutrition.minCarbs, profile.nutrition.maxCarbs);

      const nutritionTs = zonedDateTimeToUtc(
        dayKey,
        profile.nutrition.time.hour,
        profile.nutrition.time.minute,
        tz
      );
      records.push({
        type: "nutrition",
        timestamp: nutritionTs.toISOString(),
        data: { calories, carbs_g, protein_g, fat_g, sugar_g },
        source: profile.sources.nutrition,
      });

      // Blood pressure (daily)
      const sys =
        lerp(profile.bp.sysStart, profile.bp.sysEnd, storyT) +
        randNormal(rng) * profile.bp.sdSys +
        (sleepHours < 6 ? profile.bp.poorSleepSysDelta : 0);
      const dia =
        lerp(profile.bp.diaStart, profile.bp.diaEnd, storyT) +
        randNormal(rng) * profile.bp.sdDia +
        (sleepHours < 6 ? profile.bp.poorSleepDiaDelta : 0);
      const bpTs = zonedDateTimeToUtc(dayKey, profile.bp.time.hour, profile.bp.time.minute, tz);
      records.push({
        type: "blood_pressure",
        timestamp: bpTs.toISOString(),
        data: {
          systolic: clamp(Math.round(sys), 90, 200),
          diastolic: clamp(Math.round(dia), 55, 130),
          unit: "mmHg",
        },
        source: profile.sources.bp,
      });

      // Weight (daily)
      const targetWeight = lerp(profile.weight.lbStart, profile.weight.lbEnd, storyT);
      const pull = (targetWeight - weightLb) * profile.weight.follow;
      const noise = randNormal(rng) * profile.weight.sd;
      const workoutEffect =
        dayWorkoutCalories > 0 ? -(dayWorkoutCalories / 3500) * profile.weight.workoutFactor : 0;
      weightLb += pull + noise + workoutEffect;

      const weightTs = zonedDateTimeToUtc(
        dayKey,
        profile.weight.time.hour,
        profile.weight.time.minute,
        tz
      );
      records.push({
        type: "weight",
        timestamp: weightTs.toISOString(),
        data: { lb: Number(weightLb.toFixed(1)) },
        source: profile.sources.weight,
      });

      // Steps (daily)
      const stepsBase = lerp(profile.steps.baseStart, profile.steps.baseEnd, storyT);
      let steps = Math.round(stepsBase + randNormal(rng) * profile.steps.sd);
      if (workouts.length > 0) steps += profile.steps.workoutBonus;
      steps = clamp(steps, 1800, 26000);
      const stepsTs = zonedDateTimeToUtc(dayKey, profile.steps.time.hour, profile.steps.time.minute, tz);
      records.push({
        type: "steps",
        timestamp: stepsTs.toISOString(),
        data: { count: steps },
        source: profile.sources.sleep,
      });

      prevWorkoutLoad = dayWorkoutLoad;
    }

    return {
      schemaVersion: 1,
      user: { id: profileId, name: profile.name, tz },
      records,
    };
  }

  async function loadSample(profileId = SAMPLE_PROFILE_DEFAULT) {
    clearErrors();
    setStatus("Loading sample…");
    activeSampleProfile =
      typeof profileId === "string" && profileId in SAMPLE_PROFILES ? profileId : SAMPLE_PROFILE_DEFAULT;
    updateProfileButtonsUI();
    const payload = getOrCreateSamplePayload(activeSampleProfile);
    const text = JSON.stringify(payload, null, 2);
    dom.jsonInput.value = text;
    analyzeFromText(text);
  }

  function clearAll() {
    currentModel = null;
    focusRanges = { ...FOCUS_RANGE_DEFAULTS };
    updateRangeToggleUI();
    setHelloName("there");
    dom.jsonInput.value = "";
    dom.fileInput.value = "";
    dom.errors.innerHTML = "";
    dom.focusRange.textContent = "—";
    dom.focus.sleepNow.textContent = "—";
    dom.focus.sleepMeta.textContent = "Last 7 days";
    dom.focusCharts.sleep.hidden = false;
    dom.focus.sleepDay.hidden = true;
    dom.focus.sleepDay.textContent = "";
    dom.focus.sleepRange.hidden = false;
    dom.focus.sleepRange.style.display = "";
    dom.focus.stressNow.textContent = "—";
    dom.focus.stressMeta.textContent = "Previous day";
    dom.focus.stressNote.textContent = "";
    dom.focus.stressCircle.hidden = false;
    dom.focus.stressCircle.style.display = "";
    dom.focus.stressCircle.dataset.empty = "true";
    dom.focus.stressCircle.style.removeProperty("--stress-hue");
    dom.focus.stressCircle.style.removeProperty("--stress-pct");
    dom.focus.stressMeta.hidden = false;
    dom.focusCharts.stress.hidden = true;
    dom.focusCharts.stress.style.display = "none";
    dom.focus.exerciseNow.textContent = "—";
    dom.focus.exerciseMeta.textContent = "Last 7 days";
    dom.focusCharts.exercise.hidden = false;
    dom.focusCharts.exercise.style.display = "";
    dom.focus.exerciseDay.hidden = true;
    dom.focus.exerciseDay.style.display = "none";
    dom.focus.exerciseDay.textContent = "";
    dom.focus.exerciseNote.textContent = "";
    dom.focus.bpNow.textContent = "—";
    dom.focus.bpMeta.textContent = "Last 7 days";
    dom.focus.bpNote.textContent = "";
    dom.focus.weightNow.textContent = "—";
    dom.focus.weightMeta.textContent = "Last 30 days";
    dom.focus.weightNote.textContent = "";
    dom.focus.nutritionNow.textContent = "—";
    dom.focus.nutritionMeta.textContent = "One-day totals";
    dom.focus.nutritionCalories.textContent = "—";
    dom.focus.nutritionCarbs.textContent = "—";
    dom.focus.nutritionProtein.textContent = "—";
    dom.focus.nutritionFat.textContent = "—";
		    dom.focus.nutritionDay.hidden = false;
		    dom.focus.nutritionDay.style.display = "";
		    dom.focus.nutritionRange.hidden = true;
		    dom.focus.nutritionRange.style.display = "none";
		    dom.focus.nutritionGrid.hidden = false;
		    dom.focusCharts.nutritionCalories.hidden = true;
		    dom.focus.nutritionNote.textContent = "";
	    renderInsights(null);
	    for (const chart of Object.values(focusCharts)) chart.clear();
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

  dom.loadSampleBtn.addEventListener("click", () => void loadSample(activeSampleProfile));
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

  document.addEventListener("click", (ev) => {
    const btn = ev.target?.closest?.("button[data-range-panel][data-range-days]");
    if (!btn) return;
    const panel = btn.dataset.rangePanel;
    const days = Number(btn.dataset.rangeDays);
    if (!panel || !Number.isFinite(days)) return;
    const allowed = FOCUS_RANGE_OPTIONS[panel];
    if (!Array.isArray(allowed) || !allowed.includes(days)) return;
    if (focusRanges[panel] === days) return;
    focusRanges = { ...focusRanges, [panel]: days };
    updateRangeToggleUI();
    if (currentModel) renderFocus(currentModel);
  });

  document.addEventListener("click", (ev) => {
    const btn = ev.target?.closest?.("button[data-profile]");
    if (!btn) return;
    const profileId = btn.dataset.profile;
    if (!profileId) return;
    void loadSample(profileId);
  });

  if (dom.jsonInput.value.trim() === "") {
    void loadSample(activeSampleProfile);
  }
})();
