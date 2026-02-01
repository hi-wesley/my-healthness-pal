export function createSleepHelpers({
  validateTimeZone,
  defaultTimeZone,
  escapeHtml,
  formatNumber,
  formatMinutesAsHM,
  formatDayWeekdayLong,
  isFiniteNumber,
  config,
} = {}) {
  const zonedWeekdayTimeFormatterCache = new Map();
  function formatZonedWeekdayTime(date, timeZone) {
    if (!(date instanceof Date) || !Number.isFinite(date.getTime())) return "—";
    const tz = validateTimeZone(timeZone) ? timeZone : defaultTimeZone;
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

  function sleepEnoughnessMessage(hours) {
    if (!isFiniteNumber(hours) || hours <= 0) return "No sleep data";

    const bucket = Math.max(0, Math.min(12, Math.floor(hours)));
    switch (bucket) {
      case 0:
      case 1:
      case 2:
      case 3:
        return "Barely slept";
      case 4:
        return "Very short sleep";
      case 5:
        return "Too little sleep";
      case 6:
        return "A bit short on sleep";
      case config.enoughSleepMinHours:
        return "Enough sleep";
      case 8:
        return "Great sleep";
      case config.enoughSleepMaxHours:
        return "Plenty of sleep";
      case 10:
        return "A lot of sleep";
      default:
        return "Very long sleep";
    }
  }

  function buildSleepDetailsHtml(day, timeZone) {
    const primary = day?.sleep_primary ?? null;

    const totalMin = isFiniteNumber(day?.sleep_minutes)
      ? day.sleep_minutes
      : isFiniteNumber(day?.sleep_hours)
        ? day.sleep_hours * 60
        : null;
    const totalLabel = totalMin === null ? "—" : formatMinutesAsHM(totalMin);

    const rangeLabel = primary ? formatZonedWeekdayTimeRange(primary.start, primary.end, timeZone) : "—";

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

    const rangeLabel = primary ? formatZonedWeekdayTimeRange(primary.start, primary.end, timeZone) : "—";

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

  return {
    formatZonedWeekdayTimeRange,
    sleepEnoughnessMessage,
    buildSleepDetailsHtml,
    buildSleepTooltipHtml,
  };
}
