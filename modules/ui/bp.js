export function createBpHelpers({ isFiniteNumber } = {}) {
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

  return { latestBpReading };
}
