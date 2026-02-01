export function normalizeInsightsDays({
  model,
  dayKey,
  defaultTimeZone,
  addDaysToKey,
  computeStressForDay,
  isFiniteNumber,
  config,
} = {}) {
  const daysRaw = Array.isArray(model?.days) ? model.days.slice(-14) : [];
  const dayByKey = new Map(daysRaw.map((d) => [d.dayKey, d]));
  const days = daysRaw.map((d) => {
    const prevDayKey = addDaysToKey(d.dayKey, -1);
    const detail = computeStressForDay(dayByKey, prevDayKey, config);
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
    typeof model?.timeZone === "string" && model.timeZone.trim() ? model.timeZone.trim() : defaultTimeZone;

  return { dayKey, timeZone, days };
}

export function validateInsightsResponse(data) {
  if (!data || typeof data !== "object") {
    return { ok: false, error: "Unexpected backend response" };
  }
  if (data.ok !== true) {
    return {
      ok: false,
      error: typeof data.error === "string" ? data.error : "Unexpected backend response",
    };
  }
  if (!data.insights || typeof data.insights !== "object") {
    return { ok: false, error: "Backend returned invalid insights" };
  }
  return { ok: true, insights: data.insights, model: data.model ?? null };
}
