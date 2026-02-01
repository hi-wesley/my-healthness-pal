export function createExerciseHelpers({
  escapeHtml,
  formatNumber,
  formatMinutesAsHM,
  formatDayWeekdayLong,
  isFiniteNumber,
  config,
} = {}) {
  function exerciseEnoughnessMessage(avgMinutesPerDay) {
    if (!isFiniteNumber(avgMinutesPerDay) || avgMinutesPerDay < 0) return "No exercise data";
    return avgMinutesPerDay >= config.enoughExerciseAvgMinutes
      ? "Enough exercise"
      : "Not enough exercise";
  }

  function formatWorkoutMinutes(minutes) {
    return formatMinutesAsHM(minutes);
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
    const activityHtml =
      top.length > 0
        ? top
          .map((a) => {
            const activity =
              typeof a.activity === "string" && a.activity.trim() ? a.activity.trim() : "Workout";
            const duration = formatWorkoutMinutes(a.duration_min);
            const calories = isFiniteNumber(a.calories) ? `${formatNumber(a.calories, 0)} Cal` : "—";
            return escapeHtml(`${activity}: ${duration} • ${calories}`);
          })
          .join("<br />")
        : escapeHtml("—");

    return `<div class="sleep-details">
      <div class="sleep-row"><span class="sleep-label">Total duration</span><span class="sleep-value">${escapeHtml(
      totalDuration
    )}</span></div>
      <div class="sleep-row"><span class="sleep-label">Calories</span><span class="sleep-value">${escapeHtml(
      totalCalories
    )}</span></div>
      <div class="sleep-row"><span class="sleep-label">Top activities</span><span class="sleep-value">${activityHtml}</span></div>
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

  return {
    exerciseEnoughnessMessage,
    formatWorkoutMinutes,
    topExerciseActivities,
    buildExerciseDetailsHtml,
    buildExerciseTooltipHtml,
  };
}
