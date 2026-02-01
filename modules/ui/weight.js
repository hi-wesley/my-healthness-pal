export function createWeightHelpers({ isFiniteNumber } = {}) {
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

  return { latestNumberInDays, firstNumberInDays };
}
