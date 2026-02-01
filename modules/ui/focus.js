export function createFocusRenderer(ctx) {
  const {
    dom,
    focusCharts,
    focusRanges,
    CONFIG,
    METRICS,
    clamp,
    addDaysToKey,
    windowDays,
    formatDayLong,
    formatDayShort,
    formatDayWeekdayShort,
    formatDayWeekdayLong,
    formatRangeWeekdayShort,
    formatWindowRange,
    formatMinutesAsHM,
    formatNumber,
    formatSigned,
    escapeHtml,
    sleepEnoughnessMessage,
    buildSleepDetailsHtml,
    buildSleepTooltipHtml,
    buildExerciseTooltipHtml,
    formatMacroTile,
    formatWorkoutMinutes,
    topExerciseActivities,
    exerciseEnoughnessMessage,
    computeStressForDay,
    stressHueForScore,
    stressColorForScore,
    isFiniteNumber,
    avg,
    sum,
    kgToLb,
    latestBpReading,
    latestNutritionDay,
    latestNumberInDays,
    firstNumberInDays,
  } = ctx;

  return function renderFocus(model) {
    
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
    
  };
}
