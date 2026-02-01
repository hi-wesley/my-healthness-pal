import {
  avg,
  sum,
  stddev,
  isFiniteNumber,
  formatNumber,
  formatSigned,
  formatMinutesAsHM,
  kgToLb,
  addDaysToKey,
} from "../utils.js";
import { detectRhrStreak } from "./anomalyDetector.js";

export function findStreakIndices(bools) {
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

export function windowDays(dayByKey, endDayKey, length, addDaysToKeyFn = addDaysToKey) {
  const out = [];
  for (let offset = length - 1; offset >= 0; offset -= 1) {
    const dayKey = addDaysToKeyFn(endDayKey, -offset);
    out.push(dayByKey.get(dayKey) ?? { dayKey });
  }
  return out;
}

export function computeBaselineStats(dayByKey, endDayKey, metricKey, config, addDaysToKeyFn = addDaysToKey) {
  const window = windowDays(dayByKey, endDayKey, config.baselineLookbackDays, addDaysToKeyFn);
  const values = window.map((d) => d?.[metricKey]).filter(isFiniteNumber);
  if (values.length < config.baselineMinPoints) return null;
  const mean = avg(values);
  const sd = stddev(values);
  return mean === null ? null : { mean, sd: isFiniteNumber(sd) ? sd : null, n: values.length };
}

export function createInsightsBuilder(deps) {
  const {
    CONFIG,
    FOCUS_RANGE_DEFAULTS,
    formatDayShort,
    formatDayWeekdayShort,
    formatDayWeekdayLong,
    formatWindowRange,
    latestBpReading,
    latestNutritionDay,
    firstNumberInDays,
    latestNumberInDays,
    computeStressForDay,
  } = deps;

  function pluralize(count, singular, plural = `${singular}s`) {
    return count === 1 ? singular : plural;
  }

  return function buildInsights(days) {
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
            "No workouts were logged recently. If you're aiming for consistency, plan a small, easy session today.",
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
          latest.systolic >= CONFIG.highBpSystolic || latest.diastolic >= CONFIG.highBpDiastolic ? "warn" : "info";
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
      const detail = computeStressForDay(dayByKey, dayKey, CONFIG);
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
              "Yesterday's stress signals were high. If you feel run down, prioritize sleep and keep today's training easier.",
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
          ? computeBaselineStats(dayByKey, addDaysToKey(end.dayKey, -1), "calories", CONFIG)
          : null;
        const pct =
          baseline && baseline.mean > 0 ? (calories - baseline.mean) / baseline.mean : null;
        const severity = pct !== null && pct >= CONFIG.stressPctToFull ? "warn" : "info";

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
              "Calories were notably higher than your recent average. If this wasn't intentional, review snacks/drinks and meal timing.",
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
      const { qualifying } = detectRhrStreak(days, CONFIG);
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
  };
}
