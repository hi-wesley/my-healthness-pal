import { fetchInsightsJob } from "./insights.js";
import { MiniChart, getThemeColors, updateThemeColors } from "./charting.js";
import { aggregateDaily, normalizeAndValidateRecords, normalizePayload } from "./data.js";
import { computeStressForDay, stressColorForScore, stressHueForScore } from "./stress.js";
import { CONFIG, FOCUS_RANGE_DEFAULTS, METRICS } from "./ui/state.js";
import {
  SAMPLE_PROFILE_DEFAULT,
  SAMPLE_PROFILE_VERSION,
  SAMPLE_PROFILES,
  isSampleProfileId,
} from "./ui/samples.js";
import { createDom } from "./ui/dom.js";
import { createFormat } from "./ui/format.js";
import {
  avg,
  clamp,
  clamp01,
  formatMinutesAsHM,
  formatNumber,
  formatSigned,
  isFiniteNumber,
  isPlainObject,
  kgToLb,
  lbToKg,
  median,
  stddev,
  sum,
  toNumber,
} from "./ui/helpers.js";
import {
  computeRollingStats,
  detectZScoreAnomalies,
  detectRhrStreak,
} from "./ui/anomalyDetector.js";
import {
  findStreakIndices,
  windowDays,
  computeBaselineStats,
  createInsightsBuilder,
} from "./ui/insightsBuilder.js";
import {
  computeLocalToneScores,
  applyLocalToneScores,
} from "./ui/toneScorer.js";
import { createSleepHelpers } from "./ui/sleep.js";
import { createExerciseHelpers } from "./ui/exercise.js";
import { createNutritionHelpers } from "./ui/nutrition.js";
import { createBpHelpers } from "./ui/bp.js";
import { createWeightHelpers } from "./ui/weight.js";
import { normalizeInsightsDays, validateInsightsResponse } from "./ui/insightsSchema.js";
import { wireEvents } from "./ui/events.js";
import { createFocusRenderer } from "./ui/focus.js";
import { createInsightsView } from "./ui/insightsView.js";
import { createSampleGenerator } from "./ui/sampleGenerator.js";
import {
  clearCachedInsights,
  getCachedInsights,
  getSampleState,
  getStoredActiveProfile,
  putCachedInsights,
  putSampleState,
  setStoredActiveProfile,
  STORAGE_VERSION,
} from "./ui/storage.js";

(() => {
  "use strict";

  // Global error handling
  function showFatalError(error) {
    console.error("[ui.js] Fatal error:", error);
    const message = error?.message || String(error) || "An unexpected error occurred.";
    const container = document.getElementById("app") || document.body;
    const errorHtml = `
      <div style="padding: 2rem; max-width: 600px; margin: 2rem auto; font-family: system-ui, sans-serif;">
        <h1 style="color: #DC2626; margin-bottom: 1rem;">Something went wrong</h1>
        <p style="color: #374151; margin-bottom: 1rem;">The fitness tracker encountered an error and couldn't load properly.</p>
        <details style="background: #F3F4F6; padding: 1rem; border-radius: 0.5rem;">
          <summary style="cursor: pointer; font-weight: 500;">Technical details</summary>
          <pre style="margin-top: 0.5rem; white-space: pre-wrap; word-break: break-word; font-size: 0.875rem;">${String(message).replace(/</g, "&lt;").replace(/>/g, "&gt;")}</pre>
        </details>
        <p style="color: #6B7280; margin-top: 1rem; font-size: 0.875rem;">Try refreshing the page. If the problem persists, check the browser console for more details.</p>
      </div>
    `;
    container.innerHTML = errorHtml;
  }

  // Set up global error handlers
  window.addEventListener("error", (event) => {
    console.error("[ui.js] Uncaught error:", event.error);
  });

  window.addEventListener("unhandledrejection", (event) => {
    console.error("[ui.js] Unhandled promise rejection:", event.reason);
  });

  try {

  const dom = createDom();

  const FALLBACK_TZ = "America/Los_Angeles";
  const baseFormat = createFormat({ fallbackTimeZone: FALLBACK_TZ });

  function detectBrowserTimeZone() {
    try {
      const tz = Intl.DateTimeFormat().resolvedOptions().timeZone;
      if (typeof tz !== "string") return null;
      const trimmed = tz.trim();
      if (!trimmed) return null;
      return baseFormat.validateTimeZone(trimmed) ? trimmed : null;
    } catch {
      return null;
    }
  }

  const DEFAULT_TZ = detectBrowserTimeZone() ?? FALLBACK_TZ;
  const INSIGHTS_ANALYSIS_VERSION = 3;
  const format = createFormat({ fallbackTimeZone: DEFAULT_TZ });
  const {
    escapeHtml,
    safeJsonParse,
    validateTimeZone,
    formatDayKey,
    addDaysToKey,
    dayPartGreeting,
    formatDayShort,
    formatDayLong,
    formatDayWeekdayShort,
    formatDayWeekdayLong,
    formatDayTickWeekday,
    formatRangeWeekdayShort,
    formatWindowRange,
  } = format;

  updateThemeColors();

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
    if (!dom.statusPill) return;
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

  function pluralize(count, singular, plural = `${singular}s`) {
    return count === 1 ? singular : plural;
  }

  function pickUserDisplayName(user) {
    if (!isPlainObject(user)) return "there";
    const name = typeof user.name === "string" ? user.name.trim() : "";
    if (name) return name;
    const id = typeof user.id === "string" ? user.id.trim() : "";
    if (id) return id;
    return "there";
  }

  function setDashGreeting(name, { timeZone = DEFAULT_TZ } = {}) {
    const cleaned = typeof name === "string" ? name.trim() : "";
    const greeting = dayPartGreeting(timeZone);
    if (dom.focusTitle) dom.focusTitle.textContent = `${greeting} ${cleaned || "there"}`;
  }

  setDashGreeting("there");

  const sleepHelpers = createSleepHelpers({
    validateTimeZone,
    defaultTimeZone: DEFAULT_TZ,
    escapeHtml,
    formatNumber,
    formatMinutesAsHM,
    formatDayWeekdayLong,
    isFiniteNumber,
    config: CONFIG,
  });
  const exerciseHelpers = createExerciseHelpers({
    escapeHtml,
    formatNumber,
    formatMinutesAsHM,
    formatDayWeekdayLong,
    isFiniteNumber,
    config: CONFIG,
  });
  const nutritionHelpers = createNutritionHelpers({ formatNumber, isFiniteNumber });
  const bpHelpers = createBpHelpers({ isFiniteNumber });
  const weightHelpers = createWeightHelpers({ isFiniteNumber });

  const {
    formatZonedWeekdayTimeRange,
    sleepEnoughnessMessage,
    buildSleepDetailsHtml,
    buildSleepTooltipHtml,
  } = sleepHelpers;
  const {
    exerciseEnoughnessMessage,
    formatWorkoutMinutes,
    topExerciseActivities,
    buildExerciseDetailsHtml,
    buildExerciseTooltipHtml,
  } = exerciseHelpers;
  const { formatMacroShare, formatMacroTile, latestNutritionDay } = nutritionHelpers;
  const { latestBpReading } = bpHelpers;
  const { latestNumberInDays, firstNumberInDays } = weightHelpers;

  function latestSample(samples) {
    if (!samples || samples.length === 0) return null;
    let latest = samples[0];
    for (let i = 1; i < samples.length; i += 1) {
      if (samples[i].t > latest.t) latest = samples[i];
    }
    return latest;
  }

  // buildInsights is now created via createInsightsBuilder
  const buildInsights = createInsightsBuilder({
    CONFIG,
    FOCUS_RANGE_DEFAULTS,
    formatDayShort: format.formatDayShort,
    formatDayWeekdayShort: format.formatDayWeekdayShort,
    formatDayWeekdayLong: format.formatDayWeekdayLong,
    formatWindowRange: format.formatWindowRange,
    latestBpReading,
    latestNutritionDay,
    firstNumberInDays,
    latestNumberInDays,
    computeStressForDay,
  });

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
      dom.focus.nutritionCarbs.textContent = "—";
      dom.focus.nutritionProtein.textContent = "—";
      dom.focus.nutritionFat.textContent = "—";
      dom.focus.nutritionDay.hidden = false;
      dom.focus.nutritionDay.style.display = "";
      dom.focus.nutritionRange.hidden = true;
      dom.focus.nutritionRange.style.display = "none";
      dom.focus.nutritionMacros.hidden = false;
      dom.focusCharts.nutritionCalories.hidden = true;
      focusCharts.nutritionCalories.clear();
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
      const windowLabel = formatWindowRange(maxDayKey, length);

      if (length === 1) {
        dom.focus.sleepDay.hidden = false;
        dom.focus.sleepDay.style.display = "";
        dom.focus.sleepRange.hidden = true;
        dom.focus.sleepRange.style.display = "none";
        dom.focusCharts.sleep.hidden = true;
        focusCharts.sleep.clear();
        dom.focus.sleepMeta.textContent = windowLabel;
        dom.focus.sleepNow.textContent = sleepEnoughnessMessage(avgSleep);
        dom.focus.sleepDay.innerHTML = buildSleepDetailsHtml(latestDay, timeZone);
      } else {
        dom.focus.sleepDay.hidden = true;
        dom.focus.sleepDay.textContent = "";
        dom.focus.sleepRange.hidden = false;
        dom.focus.sleepRange.style.display = "";
        dom.focusCharts.sleep.hidden = false;
        dom.focus.sleepNow.textContent = sleepEnoughnessMessage(avgSleep);
        dom.focus.sleepMeta.textContent =
          `${length}-day avg: ${avgSleep === null ? "—" : formatMinutesAsHM(avgSleep * 60)}` +
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
        const detail = computeStressForDay(dayByKey, endDayKey, CONFIG);
        dom.focus.stressMeta.hidden = false;

        const dayLabel = formatDayWeekdayShort(endDayKey);
        dom.focus.stressMeta.textContent = `From ${dayLabel}`;

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
        dom.focus.stressMeta.textContent = `From ${formatWindowRange(endDayKey, length)}`;
        const summaries = window.map((d) => computeStressForDay(dayByKey, d.dayKey, CONFIG));
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
        dom.focus.exerciseNote.hidden = true;
        dom.focus.exerciseNote.style.display = "none";
        const exerciseBody = dom.focus.exerciseDay.parentElement;
        if (exerciseBody) exerciseBody.style.minHeight = "162px";

        const day = window.length > 0 ? window[window.length - 1] : { dayKey: maxDayKey };
        const caloriesLabel = isFiniteNumber(day.workout_calories)
          ? ` • ${formatNumber(day.workout_calories, 0)} Calories`
          : "";
        dom.focus.exerciseNow.textContent =
          isFiniteNumber(day.workout_minutes) && day.workout_minutes > 0
            ? formatWorkoutMinutes(day.workout_minutes)
            : "Haven't recorded today";
        dom.focus.exerciseMeta.textContent = `${windowLabel}${caloriesLabel}`;
        dom.focus.exerciseDay.innerHTML = buildExerciseDetailsHtml(day);
        dom.focus.exerciseNote.textContent = "";
      } else {
        dom.focusCharts.exercise.hidden = false;
        dom.focusCharts.exercise.style.display = "";
        dom.focus.exerciseDay.hidden = true;
        dom.focus.exerciseDay.style.display = "none";
        dom.focus.exerciseDay.textContent = "";
        dom.focus.exerciseNote.hidden = false;
        dom.focus.exerciseNote.style.display = "";
        const exerciseBody = dom.focusCharts.exercise.parentElement;
        if (exerciseBody) exerciseBody.style.removeProperty("min-height");

        const avgMinutesPerDay = window.length > 0 ? totalMinutes / window.length : null;
        dom.focus.exerciseNow.textContent = exerciseEnoughnessMessage(avgMinutesPerDay);
        dom.focus.exerciseMeta.textContent =
          `Sessions: ${sessions}/${window.length}` +
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
      dom.focus.nutritionMacros.hidden = !isSingle;
      dom.focusCharts.nutritionCalories.hidden = isSingle;

      if (isSingle) {
        const calories = isFiniteNumber(endDay.calories) ? endDay.calories : null;
        dom.focus.nutritionNow.textContent =
          calories === null ? "No data" : formatNumber(calories, 0);
        dom.focus.nutritionMeta.textContent = `${formatDayWeekdayShort(endDayKey)} • One-day totals`;
        focusCharts.nutritionCalories.clear();

        dom.focus.nutritionCarbs.textContent = formatMacroTile(endDay.carbs_g, endDay.calories, 4);
        dom.focus.nutritionProtein.textContent = formatMacroTile(
          endDay.protein_g,
          endDay.calories,
          4
        );
        dom.focus.nutritionFat.textContent = formatMacroTile(endDay.fat_g, endDay.calories, 9);
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
      }
    }

    // Blood pressure (7/14/30)
    {
      const length = bpDays;
      const window = windowDays(dayByKey, maxDayKey, length);
      const latest = latestBpReading(days);
      const includeWeekday = true;

      const readings = window.filter(
        (d) => isFiniteNumber(d.bp_systolic) && isFiniteNumber(d.bp_diastolic)
      );
      const avgSys =
        readings.length > 0 ? sum(readings.map((d) => d.bp_systolic)) / readings.length : null;
      const avgDia =
        readings.length > 0 ? sum(readings.map((d) => d.bp_diastolic)) / readings.length : null;

      dom.focus.bpNow.textContent =
        avgSys === null || avgDia === null
          ? "—"
          : `${formatNumber(avgSys, 0)}/${formatNumber(avgDia, 0)}`;
      dom.focus.bpMeta.textContent = latest
        ? `${length}D avg • Latest: ${includeWeekday ? formatDayWeekdayShort(latest.dayKey) : formatDayShort(latest.dayKey)
        }`
        : `${length}D avg`;

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
      const startKey = addDaysToKey(maxDayKey, -(length - 1));
      const windowLabel = formatRangeWeekdayShort(startKey, maxDayKey);

      if (!latest) {
        dom.focus.weightNow.textContent = "—";
      } else {
        const latestLb = kgToLb(latest.value);
        let label = `${formatNumber(latestLb, 1)} lb`;
        if (first && latest.index > first.index) {
          const firstLb = kgToLb(first.value);
          const delta = latestLb - firstLb;
          label += `, Δ ${formatSigned(delta, 1)} lb`;
        }
        dom.focus.weightNow.textContent = label;
      }

      if (first && latest && latest.index > first.index) {
        dom.focus.weightMeta.textContent =
          `${windowLabel} • ${present}/${window.length} days logged`;
        dom.focus.weightNote.textContent =
          "For a clearer signal, compare weekly averages rather than day-to-day changes.";
      } else {
        dom.focus.weightMeta.textContent =
          `${windowLabel} • ${present}/${window.length} days logged`;
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

  function toToneScore(value) {
    const num = toNumber(value);
    if (num === null) return null;
    return clamp(Math.round(num), 0, 100);
  }

  function normalizeInsightBlock(value) {
    if (!isPlainObject(value)) return null;
    const title = typeof value.title === "string" ? value.title.trim() : "";
    const body = typeof value.body === "string" ? value.body.trim() : "";
    if (!title || !body) return null;
    const toneScore = toToneScore(value.toneScore ?? value.score);
    const toneDayKey = typeof value.toneDayKey === "string" ? value.toneDayKey.trim() : "";
    return { title, body, toneScore, toneDayKey: toneDayKey || null };
  }

  function setInsightTone(cardEl, toneScore) {
    if (!cardEl) return;
    if (!isFiniteNumber(toneScore)) {
      cardEl.removeAttribute("data-tone");
      cardEl.style.removeProperty("--tone-hue");
      return;
    }
    const score = clamp(toneScore, 0, 100);
    const hue = (score / 100) * 120;
    cardEl.setAttribute("data-tone", "1");
    cardEl.style.setProperty("--tone-hue", String(Math.round(hue)));
  }

  function showInsightsGenerating(dayKey) {
    const placeholderTitle = "Generating…";
    const placeholderBody = `Generating AI insights for ${dayKey}…`;
    setInsightText(dom.insights.overallTitle, dom.insights.overallBody, placeholderTitle, placeholderBody);
    setInsightText(dom.insights.sleepTitle, dom.insights.sleepBody, placeholderTitle, placeholderBody);
    setInsightText(dom.insights.stressTitle, dom.insights.stressBody, placeholderTitle, placeholderBody);
    setInsightText(dom.insights.exerciseTitle, dom.insights.exerciseBody, placeholderTitle, placeholderBody);
    setInsightText(dom.insights.nutritionTitle, dom.insights.nutritionBody, placeholderTitle, placeholderBody);
    setInsightText(dom.insights.bpTitle, dom.insights.bpBody, placeholderTitle, placeholderBody);
    setInsightText(dom.insights.weightTitle, dom.insights.weightBody, placeholderTitle, placeholderBody);
    setInsightTone(dom.insights.overallTitle?.closest?.(".insight"), null);
    setInsightTone(dom.insights.sleepTitle?.closest?.(".insight"), null);
    setInsightTone(dom.insights.stressTitle?.closest?.(".insight"), null);
    setInsightTone(dom.insights.exerciseTitle?.closest?.(".insight"), null);
    setInsightTone(dom.insights.nutritionTitle?.closest?.(".insight"), null);
    setInsightTone(dom.insights.bpTitle?.closest?.(".insight"), null);
    setInsightTone(dom.insights.weightTitle?.closest?.(".insight"), null);
  }

  function renderAiInsights(insights, { expectedDayKey = null, analysisOk = true } = {}) {
    if (!isPlainObject(insights)) return { ok: false, hasTone: false };

    const overall = normalizeInsightBlock(insights.overall);
    const sleep = normalizeInsightBlock(insights.sleep);
    const stress = normalizeInsightBlock(insights.stress);
    const exercise = normalizeInsightBlock(insights.exercise);
    const nutrition = normalizeInsightBlock(insights.nutrition);
    const bp = normalizeInsightBlock(insights.bp);
    const weight = normalizeInsightBlock(insights.weight);

    const ok = Boolean(overall && sleep && stress && exercise && nutrition && bp && weight);
    const expected =
      typeof expectedDayKey === "string" && expectedDayKey.trim() ? expectedDayKey.trim() : null;
    const canUseTone = ok && analysisOk === true && Boolean(expected);
    const blockHasTone = (block) =>
      Boolean(
        canUseTone &&
        block &&
        isFiniteNumber(block.toneScore) &&
        typeof block.toneDayKey === "string" &&
        block.toneDayKey === expected
      );
    const hasTone =
      ok &&
      [overall, sleep, stress, exercise, nutrition, bp, weight].every((block) =>
        blockHasTone(block)
      );

    if (overall) {
      setInsightText(dom.insights.overallTitle, dom.insights.overallBody, overall.title, overall.body);
      setInsightTone(
        dom.insights.overallTitle?.closest?.(".insight"),
        blockHasTone(overall) ? overall.toneScore : null
      );
    }
    if (sleep) {
      setInsightText(dom.insights.sleepTitle, dom.insights.sleepBody, sleep.title, sleep.body);
      setInsightTone(dom.insights.sleepTitle?.closest?.(".insight"), blockHasTone(sleep) ? sleep.toneScore : null);
    }
    if (stress) {
      setInsightText(dom.insights.stressTitle, dom.insights.stressBody, stress.title, stress.body);
      setInsightTone(dom.insights.stressTitle?.closest?.(".insight"), blockHasTone(stress) ? stress.toneScore : null);
    }
    if (exercise) {
      setInsightText(dom.insights.exerciseTitle, dom.insights.exerciseBody, exercise.title, exercise.body);
      setInsightTone(
        dom.insights.exerciseTitle?.closest?.(".insight"),
        blockHasTone(exercise) ? exercise.toneScore : null
      );
    }
    if (nutrition) {
      setInsightText(dom.insights.nutritionTitle, dom.insights.nutritionBody, nutrition.title, nutrition.body);
      setInsightTone(
        dom.insights.nutritionTitle?.closest?.(".insight"),
        blockHasTone(nutrition) ? nutrition.toneScore : null
      );
    }
    if (bp) {
      setInsightText(dom.insights.bpTitle, dom.insights.bpBody, bp.title, bp.body);
      setInsightTone(dom.insights.bpTitle?.closest?.(".insight"), blockHasTone(bp) ? bp.toneScore : null);
    }
    if (weight) {
      setInsightText(dom.insights.weightTitle, dom.insights.weightBody, weight.title, weight.body);
      setInsightTone(dom.insights.weightTitle?.closest?.(".insight"), blockHasTone(weight) ? weight.toneScore : null);
    }

    return { ok, hasTone };
  }

  // Tone scoring options for applyLocalToneScores
  const toneScoreOptions = {
    CONFIG,
    computeStressForDay,
    latestBpReading,
    weightHelpers,
    isPlainObject,
  };

  function isCurrentInsightsAnalysisVersion(value) {
    const num = toNumber(value);
    return Number.isFinite(num) && num === INSIGHTS_ANALYSIS_VERSION;
  }

  async function ensureAiInsights(profileId, dayKey, model, options = {}) {
    const force = isPlainObject(options) && options.force === true;
    const requestKey = `${profileId}:${dayKey}`;
    if (!force) {
      const existing = insightRequestInFlight.get(requestKey);
      if (existing) return existing;
    } else {
      const controller = insightRequestControllers.get(requestKey);
      if (controller) controller.abort();
      insightRequestInFlight.delete(requestKey);
    }

    const seq = (insightRequestSeq.get(requestKey) ?? 0) + 1;
    insightRequestSeq.set(requestKey, seq);
    const controller = new AbortController();
    insightRequestControllers.set(requestKey, controller);

    const promise = (async () => {
      if (!force) {
        const cached = getCachedInsights(profileId, dayKey);
        if (cached) {
          const rendered = renderAiInsights(cached.insights, {
            expectedDayKey: dayKey,
            analysisOk: isCurrentInsightsAnalysisVersion(cached.analysisVersion),
          });
          if (rendered.ok && rendered.hasTone) return;
        }
      }

      const profile = SAMPLE_PROFILES[profileId] ?? null;
      const profileName = profile?.name ?? (typeof model?.userName === "string" ? model.userName : profileId);
      const daysRaw = Array.isArray(model?.days) ? model.days.slice(-14) : [];
      const dayByKey = new Map(daysRaw.map((d) => [d.dayKey, d]));
      const days = daysRaw.map((d) => {
        const prevDayKey = addDaysToKey(d.dayKey, -1);
        const detail = computeStressForDay(dayByKey, prevDayKey, CONFIG);
        const stress_score = isFiniteNumber(detail?.score) ? detail.score : null;
        const stress_label = typeof detail?.label === "string" ? detail.label : null;

        return {
          dayKey: d.dayKey,
          sleep_hours: isFiniteNumber(d.sleep_hours) ? d.sleep_hours : null,
          sleep_quality: isFiniteNumber(d.sleep_quality) ? d.sleep_quality : null,
          sleep_minutes: isFiniteNumber(d.sleep_minutes) ? d.sleep_minutes : null,
          sleep_respiration_rpm: isFiniteNumber(d?.sleep_primary?.respiration_rpm)
            ? d.sleep_primary.respiration_rpm
            : null,
          workout_minutes: isFiniteNumber(d.workout_minutes) ? d.workout_minutes : null,
          workout_load: isFiniteNumber(d.workout_load) ? d.workout_load : null,
          workout_calories: isFiniteNumber(d.workout_calories) ? d.workout_calories : null,
          steps: isFiniteNumber(d.steps) ? d.steps : null,
          calories: isFiniteNumber(d.calories) ? d.calories : null,
          carbs_g: isFiniteNumber(d.carbs_g) ? d.carbs_g : null,
          protein_g: isFiniteNumber(d.protein_g) ? d.protein_g : null,
          fat_g: isFiniteNumber(d.fat_g) ? d.fat_g : null,
          sugar_g: isFiniteNumber(d.sugar_g) ? d.sugar_g : null,
          rhr_bpm: isFiniteNumber(d.rhr_bpm) ? d.rhr_bpm : null,
          weight_kg: isFiniteNumber(d.weight_kg) ? d.weight_kg : null,
          bp_systolic: isFiniteNumber(d.bp_systolic) ? d.bp_systolic : null,
          bp_diastolic: isFiniteNumber(d.bp_diastolic) ? d.bp_diastolic : null,
          stress_score,
          stress_label,
        };
      });
      const timeZone =
        typeof model?.timeZone === "string" && model.timeZone.trim()
          ? model.timeZone.trim()
          : DEFAULT_TZ;

      const data = await fetchInsightsJob({
        payload: { profileId, profileName, dayKey, timeZone, days },
        signal: controller.signal,
        timeoutMs: 90_000,
      });

      if (!isPlainObject(data) || data.ok !== true) {
        const message =
          isPlainObject(data) && typeof data.error === "string"
            ? data.error
            : "Unexpected backend response";
        throw new Error(message);
      }
      if (!isPlainObject(data.insights)) throw new Error("Backend returned invalid insights");

      const latestSeq = insightRequestSeq.get(requestKey) ?? 0;
      if (seq !== latestSeq) return;
      if (insightRequestControllers.get(requestKey) !== controller) return;

      const scoredInsights = applyLocalToneScores(profileId, dayKey, model, data.insights, toneScoreOptions);

      putCachedInsights(profileId, dayKey, {
        model: data.model,
        analysisVersion: INSIGHTS_ANALYSIS_VERSION,
        insights: scoredInsights,
      });
      if (activeInsightsViewKey === requestKey) {
        renderAiInsights(scoredInsights, { expectedDayKey: dayKey, analysisOk: true });
      }
    })()
      .catch((err) => {
        if (err && typeof err === "object" && err.name === "AbortError") return;
        throw err;
      })
      .finally(() => {
        if (insightRequestInFlight.get(requestKey) === promise) {
          insightRequestInFlight.delete(requestKey);
        }
        if (insightRequestControllers.get(requestKey) === controller) {
          insightRequestControllers.delete(requestKey);
        }
      });

    insightRequestInFlight.set(requestKey, promise);
    return promise;
  }

  function renderInsights(model) {
    activeInsightsViewKey = null;
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
      setInsightTone(dom.insights.overallTitle?.closest?.(".insight"), null);
      setInsightTone(dom.insights.sleepTitle?.closest?.(".insight"), null);
      setInsightTone(dom.insights.stressTitle?.closest?.(".insight"), null);
      setInsightTone(dom.insights.exerciseTitle?.closest?.(".insight"), null);
      setInsightTone(dom.insights.nutritionTitle?.closest?.(".insight"), null);
      setInsightTone(dom.insights.bpTitle?.closest?.(".insight"), null);
      setInsightTone(dom.insights.weightTitle?.closest?.(".insight"), null);
      return;
    }

    const todayKey = getTodayKey(model.timeZone);
    const profileId = typeof model.userId === "string" && model.userId ? model.userId : null;
    const isSample = Boolean(profileId && profileId in SAMPLE_PROFILES);
    if (isSample && profileId) activeInsightsViewKey = `${profileId}:${todayKey}`;

    let hasUsableCached = false;
    let cachedHasTone = false;
    if (isSample) {
      const cached = getCachedInsights(profileId, todayKey);
      if (cached) {
        const rendered = renderAiInsights(cached.insights, {
          expectedDayKey: todayKey,
          analysisOk: isCurrentInsightsAnalysisVersion(cached.analysisVersion),
        });
        hasUsableCached = rendered.ok;
        cachedHasTone = rendered.ok && rendered.hasTone;
        if (cachedHasTone) return;
      }
    }

    if (!hasUsableCached) {
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
      setInsightTone(dom.insights.overallTitle?.closest?.(".insight"), null);
      setInsightTone(dom.insights.sleepTitle?.closest?.(".insight"), null);
      setInsightTone(dom.insights.stressTitle?.closest?.(".insight"), null);
      setInsightTone(dom.insights.exerciseTitle?.closest?.(".insight"), null);
      setInsightTone(dom.insights.nutritionTitle?.closest?.(".insight"), null);
      setInsightTone(dom.insights.bpTitle?.closest?.(".insight"), null);
      setInsightTone(dom.insights.weightTitle?.closest?.(".insight"), null);
    }

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
      if (hasUsableCached) return;
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

  async function regenerateAiInsightsForCurrentDay() {
    if (!currentModel) return;
    const profileId =
      typeof currentModel.userId === "string" && currentModel.userId.trim()
        ? currentModel.userId.trim()
        : null;
    if (!profileId) return;

    const todayKey = getTodayKey(currentModel.timeZone);
    activeInsightsViewKey = `${profileId}:${todayKey}`;
    clearCachedInsights(profileId, todayKey);
    showInsightsGenerating(todayKey);

    if (window.location.protocol === "file:") return;
    try {
      await ensureAiInsights(profileId, todayKey, currentModel, { force: true });
    } catch (err) {
      const message = String(err?.message || err || "Could not regenerate AI insights.");
      setInsightText(dom.insights.overallTitle, dom.insights.overallBody, "AI insights unavailable", message);
      setInsightText(dom.insights.sleepTitle, dom.insights.sleepBody, "AI insights unavailable", "—");
      setInsightText(dom.insights.stressTitle, dom.insights.stressBody, "AI insights unavailable", "—");
      setInsightText(dom.insights.exerciseTitle, dom.insights.exerciseBody, "AI insights unavailable", "—");
      setInsightText(dom.insights.nutritionTitle, dom.insights.nutritionBody, "AI insights unavailable", "—");
      setInsightText(dom.insights.bpTitle, dom.insights.bpBody, "AI insights unavailable", "—");
      setInsightText(dom.insights.weightTitle, dom.insights.weightBody, "AI insights unavailable", "—");
    }
  }

  class LegacyMiniChart {
    constructor(canvas, tooltipDiv, { heightPx = 140 } = {}) {
      this.canvas = canvas;
      this.tooltipDiv = tooltipDiv;
      this.heightPx = heightPx;
      this.series = null;
      this.hoverIndex = null;
      this.renderScheduled = false;
      this.canvas.style.height = `${this.heightPx}px`;
      this.resizeObserver = new ResizeObserver(() => this.requestRender());
      this.resizeObserver.observe(this.canvas);

      this.canvas.addEventListener("mousemove", (ev) => this.onMove(ev));
      this.canvas.addEventListener("mouseleave", () => this.onLeave());
    }

    setSeries(series) {
      this.series = series;
      this.requestRender();
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
      this.requestRender();
    }

    onMove(ev) {
      if (!this.series) return;
      const rect = this.canvas.getBoundingClientRect();
      const x = ev.clientX - rect.left;
      const idx = this.pickIndex(x, rect.width);
      if (idx === null) return;
      this.hoverIndex = idx;
      this.showTooltip(ev.clientX, ev.clientY);
      this.requestRender();
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

    requestRender() {
      if (this.renderScheduled) return;
      this.renderScheduled = true;
      requestAnimationFrame(() => {
        this.renderScheduled = false;
        this.render();
      });
    }

    render() {
      const series = this.series;
      if (!series) return;

      const cssWidth = this.canvas.clientWidth;
      if (!Number.isFinite(cssWidth) || cssWidth <= 0) return;
      const cssHeight = this.heightPx;
      const dpr = window.devicePixelRatio || 1;
      const nextWidth = Math.max(1, Math.round(cssWidth * dpr));
      const nextHeight = Math.max(1, Math.round(cssHeight * dpr));
      if (this.canvas.width !== nextWidth) this.canvas.width = nextWidth;
      if (this.canvas.height !== nextHeight) this.canvas.height = nextHeight;
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
      const colors = getThemeColors();
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
      this.renderScheduled = false;
      this.canvas.style.height = `${this.heightPx}px`;
      this.resizeObserver = new ResizeObserver(() => this.requestRender());
      this.resizeObserver.observe(this.canvas);

      this.canvas.addEventListener("mousemove", (ev) => this.onMove(ev));
      this.canvas.addEventListener("mouseleave", () => this.onLeave());
    }

    setSeries(series) {
      this.series = series;
      this.requestRender();
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
      this.requestRender();
    }

    onMove(ev) {
      if (!this.series) return;
      const rect = this.canvas.getBoundingClientRect();
      const x = ev.clientX - rect.left;
      const idx = this.pickIndex(x, rect.width);
      if (idx === null) return;
      this.hoverIndex = idx;
      this.showTooltip(ev.clientX, ev.clientY);
      this.requestRender();
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

    requestRender() {
      if (this.renderScheduled) return;
      this.renderScheduled = true;
      requestAnimationFrame(() => {
        this.renderScheduled = false;
        this.render();
      });
    }

    render() {
      const series = this.series;
      if (!series) return;

      const cssWidth = this.canvas.clientWidth;
      if (!Number.isFinite(cssWidth) || cssWidth <= 0) return;
      const cssHeight = this.heightPx;
      const dpr = window.devicePixelRatio || 1;
      const nextWidth = Math.max(1, Math.round(cssWidth * dpr));
      const nextHeight = Math.max(1, Math.round(cssHeight * dpr));
      if (this.canvas.width !== nextWidth) this.canvas.width = nextWidth;
      if (this.canvas.height !== nextHeight) this.canvas.height = nextHeight;
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
      const colors = getThemeColors();
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

  const sampleGenerator = createSampleGenerator({
    SAMPLE_PROFILES,
    SAMPLE_PROFILE_DEFAULT,
    isSampleProfileId,
    CONFIG,
    DEFAULT_TZ,
    isPlainObject,
    isFiniteNumber,
    toNumber,
    clamp,
    clamp01,
    avg,
    sum,
    lbToKg,
    kgToLb,
    validateTimeZone,
    formatDayKey,
    addDaysToKey,
  });

  const focusRenderer = createFocusRenderer({
    ui: { dom, focusCharts, focusRanges },
    config: { CONFIG, METRICS },
    utils: { clamp, isFiniteNumber, avg, sum, kgToLb },
    formatters: {
      date: { addDaysToKey, formatDayLong, formatDayShort, formatDayWeekdayShort, formatDayWeekdayLong, formatRangeWeekdayShort, formatWindowRange },
      display: { formatMinutesAsHM, formatNumber, formatSigned, escapeHtml },
    },
    modules: {
      sleep: { sleepEnoughnessMessage, buildSleepDetailsHtml, buildSleepTooltipHtml },
      exercise: { buildExerciseDetailsHtml, buildExerciseTooltipHtml, formatWorkoutMinutes, topExerciseActivities, exerciseEnoughnessMessage },
      nutrition: { formatMacroTile, latestNutritionDay },
      bp: { latestBpReading },
      weight: { latestNumberInDays, firstNumberInDays },
      stress: { computeStressForDay, stressHueForScore, stressColorForScore },
    },
    helpers: { windowDays },
  });

  const insightsView = createInsightsView({
    dom,
    DEFAULT_TZ,
    INSIGHTS_ANALYSIS_VERSION,
    fetchInsightsJob,
    SAMPLE_PROFILES,
    CONFIG,
    addDaysToKey,
    computeStressForDay,
    isPlainObject,
    isFiniteNumber,
    toNumber,
    clamp,
    avg,
    sum,
    kgToLb,
    formatNumber,
    formatSigned,
    formatDayLong,
    getTodayKey,
    getCachedInsights,
    putCachedInsights,
    clearCachedInsights,
    normalizeInsightsDays,
    validateInsightsResponse,
  });
  const renderInsightsView = (model) => insightsView.renderInsights(model);

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

    const timeZone =
      typeof payload.user.tz === "string" && validateTimeZone(payload.user.tz)
        ? payload.user.tz
        : DEFAULT_TZ;

    setDashGreeting(pickUserDisplayName(payload.user), { timeZone });

    const { normalized, errors, sources } = normalizeAndValidateRecords(payload.records);
    if (errors.length > 0) {
      showErrors(errors);
      setStatus("Validation errors", "error");
      return;
    }

    const { days, minDayKey, maxDayKey } = aggregateDaily(normalized, timeZone, {
      fallbackTimeZone: DEFAULT_TZ,
    });
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
    focusRenderer(model);
    renderInsightsView(model);
    setStatus("Done", "success");
  }

  let activeSampleProfile = SAMPLE_PROFILE_DEFAULT;

  const LEGACY_SAMPLE_PROFILES = Object.freeze({
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
        caloriesStart: 2750,
        caloriesEnd: 2550,
        sdCalories: 200,
        weekendDelta: 450,
        minCalories: 1800,
        maxCalories: 4200,
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
        proteinStart: 180,
        proteinEnd: 210,
        sdProtein: 12,
        minProtein: 120,
        maxProtein: 300,
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
        meanStart: 6.4,
        meanEnd: 6.7,
        sdHours: 0.6,
        weekendDelta: 0.65,
        minHours: 4.6,
        maxHours: 8.6,
        wakeWeekday: { hour: 7, minute: 0 },
        wakeWeekend: { hour: 8, minute: 10 },
        wakeJitterMin: 18,
        respirationBase: 15.0,
      },
      rhr: {
        baseStart: 64,
        baseEnd: 63,
        sd: 1.2,
        poorSleepBpmDelta: 3.4,
        prevLoadBpmPerHour: 1.3,
        time: { hour: 8, minute: 5 },
      },
      nutrition: {
        caloriesStart: 2150,
        caloriesEnd: 2150,
        sdCalories: 160,
        weekendDelta: 150,
        minCalories: 1600,
        maxCalories: 3100,
        proteinStart: 45,
        proteinEnd: 55,
        sdProtein: 10,
        minProtein: 25,
        maxProtein: 120,
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
        durationStart: 40,
        durationEnd: 55,
        sdMinutes: 8,
        caloriesPerMin: 6.6,
        easyPct: 0.35,
        hardPct: 0.18,
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
        meanStart: 6.2,
        meanEnd: 6.6,
        sdHours: 0.65,
        weekendDelta: 0.75,
        minHours: 4.5,
        maxHours: 8.8,
        wakeWeekday: { hour: 6, minute: 25 },
        wakeWeekend: { hour: 7, minute: 45 },
        wakeJitterMin: 18,
        respirationBase: 16.0,
      },
      rhr: {
        baseStart: 66,
        baseEnd: 64,
        sd: 1.4,
        poorSleepBpmDelta: 3.8,
        prevLoadBpmPerHour: 1.3,
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
        sysStart: 152,
        sysEnd: 146,
        diaStart: 96,
        diaEnd: 92,
        sdSys: 7,
        sdDia: 5,
        poorSleepSysDelta: 3,
        poorSleepDiaDelta: 2,
        time: { hour: 8, minute: 15 },
      },
      weight: {
        lbStart: 155,
        lbEnd: 153,
        follow: 0.22,
        sd: 0.28,
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
        meanStart: 5.4,
        meanEnd: 5.6,
        sdHours: 0.7,
        weekendDelta: 1.0,
        minHours: 3.4,
        maxHours: 8.4,
        wakeWeekday: { hour: 6, minute: 10 },
        wakeWeekend: { hour: 9, minute: 5 },
        wakeJitterMin: 22,
        respirationBase: 17.8,
      },
      rhr: {
        baseStart: 74,
        baseEnd: 76,
        sd: 1.7,
        poorSleepBpmDelta: 5.2,
        prevLoadBpmPerHour: 1.6,
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
        sysStart: 140,
        sysEnd: 144,
        diaStart: 90,
        diaEnd: 92,
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

  function isDayKey(value) {
    return typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value);
  }

  function getTodayKey(timeZone = DEFAULT_TZ) {
    return formatDayKey(new Date(), timeZone);
  }

  const SAMPLE_VISIBLE_DAYS = 35;
  const SAMPLE_TOTAL_DAYS = SAMPLE_VISIBLE_DAYS + CONFIG.baselineLookbackDays;

  function getOrCreateSamplePayload(profileId) {
    if (!isSampleProfileId(profileId)) {
      throw new Error(`Unknown sample profile: ${profileId}`);
    }
    const tz = DEFAULT_TZ;
    const todayKey = getTodayKey(tz);
    const existing = getSampleState(profileId, { expectedSampleVersion: SAMPLE_PROFILE_VERSION });

    if (!existing) {
      const startDayKey = addDaysToKey(todayKey, -(SAMPLE_TOTAL_DAYS - 1));
      const payload = sampleGenerator.buildSampleProfilePayload(profileId, tz, {
        startDayKey,
        endDayKey: todayKey,
      });
      putSampleState(profileId, {
        v: STORAGE_VERSION,
        sampleVersion: SAMPLE_PROFILE_VERSION,
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
      const payload = sampleGenerator.buildSampleProfilePayload(profileId, tz, {
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

  let activeInsightsViewKey = null;
  const insightRequestInFlight = new Map();
  const insightRequestSeq = new Map();
  const insightRequestControllers = new Map();

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
    const stressSpikeDayKey = addDaysToKey(endDayKey, -1);
    const wantsStressSpike =
      profileId === "protein-paul" || profileId === "hypertension-holly" || profileId === "chronic-chloe";
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
      let sleepHours = clamp(
        sleepMean + randNormal(rng) * profile.sleep.sdHours,
        profile.sleep.minHours,
        profile.sleep.maxHours
      );
      if (wantsStressSpike && dayKey === stressSpikeDayKey) {
        sleepHours = clamp(Math.min(sleepHours - 1.4, 5.6), profile.sleep.minHours, profile.sleep.maxHours);
      }

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
    const candidate = typeof profileId === "string" ? profileId : "";
    if (!isSampleProfileId(candidate)) {
      showErrors([`Unknown sample profile: ${candidate || "—"}`]);
      setStatus("Unknown sample", "error");
      return;
    }
    activeSampleProfile = candidate;
    setStoredActiveProfile(activeSampleProfile);
    updateProfileButtonsUI();
    try {
      const payload = getOrCreateSamplePayload(activeSampleProfile);
      analyzeFromText(JSON.stringify(payload, null, 2));
    } catch (err) {
      const message = String(err?.message || err || "Could not load sample.");
      showErrors([message]);
      setStatus("Sample error", "error");
    }
  }

  function clearAll() {
    currentModel = null;
    Object.assign(focusRanges, FOCUS_RANGE_DEFAULTS);
    updateRangeToggleUI();
    setDashGreeting("there");
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
    dom.focus.exerciseNote.hidden = false;
    dom.focus.exerciseNote.style.display = "";
    const exerciseBody = dom.focusCharts.exercise.parentElement;
    if (exerciseBody) exerciseBody.style.removeProperty("min-height");
    dom.focus.exerciseNote.textContent = "";
    dom.focus.bpNow.textContent = "—";
    dom.focus.bpMeta.textContent = "Last 7 days";
    dom.focus.bpNote.textContent = "";
    dom.focus.weightNow.textContent = "—";
    dom.focus.weightMeta.textContent = "Last 30 days";
    dom.focus.weightNote.textContent = "";
    dom.focus.nutritionNow.textContent = "—";
    dom.focus.nutritionMeta.textContent = "One-day totals";
    dom.focus.nutritionCarbs.textContent = "—";
    dom.focus.nutritionProtein.textContent = "—";
    dom.focus.nutritionFat.textContent = "—";
    dom.focus.nutritionDay.hidden = false;
    dom.focus.nutritionDay.style.display = "";
    dom.focus.nutritionRange.hidden = true;
    dom.focus.nutritionRange.style.display = "none";
    dom.focus.nutritionMacros.hidden = false;
    dom.focusCharts.nutritionCalories.hidden = true;
    renderInsightsView(null);
    for (const chart of Object.values(focusCharts)) chart.clear();
    setStatus("Ready");
  }

  wireEvents({
    onRangeChange: ({ panel, days }) => {
      if (!panel) return;
      if (focusRanges[panel] === days) return;
      focusRanges[panel] = days;
      updateRangeToggleUI();
      if (currentModel) focusRenderer(currentModel);
    },
    onProfileSelect: ({ profileId }) => {
      if (!profileId) return;
      void loadSample(profileId);
    },
  });

  const storedActiveProfile = getStoredActiveProfile();
  if (isSampleProfileId(storedActiveProfile)) {
    activeSampleProfile = storedActiveProfile;
  }
  updateProfileButtonsUI();

  void loadSample(activeSampleProfile);

  } catch (error) {
    showFatalError(error);
  }
})();
