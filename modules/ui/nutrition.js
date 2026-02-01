export function createNutritionHelpers({ formatNumber, isFiniteNumber } = {}) {
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

  return {
    formatMacroShare,
    formatMacroTile,
    latestNutritionDay,
  };
}
