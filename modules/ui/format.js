export function createFormat({ fallbackTimeZone = "UTC" } = {}) {
  function escapeHtml(s) {
    return String(s).replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;");
  }

  function validateTimeZone(timeZone) {
    try {
      new Intl.DateTimeFormat("en-US", { timeZone }).format(new Date());
      return true;
    } catch (err) {
      console.warn("[format.js] validateTimeZone failed:", err);
      return false;
    }
  }

  const dayKeyFormatterCache = new Map();
  function formatDayKey(date, timeZone) {
    const tz = validateTimeZone(timeZone) ? timeZone : fallbackTimeZone;
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

  const zonedHourFormatterCache = new Map();
  function getZonedHour(date, timeZone) {
    if (!(date instanceof Date) || !Number.isFinite(date.getTime())) return null;
    const tz = validateTimeZone(timeZone) ? timeZone : fallbackTimeZone;
    let fmt = zonedHourFormatterCache.get(tz);
    if (!fmt) {
      fmt = new Intl.DateTimeFormat("en-US", { timeZone: tz, hour: "2-digit", hour12: false });
      zonedHourFormatterCache.set(tz, fmt);
    }
    const hourPart = fmt.formatToParts(date).find((p) => p.type === "hour")?.value ?? "";
    const hour = Number(hourPart);
    return Number.isFinite(hour) ? hour : null;
  }

  function dayPartGreeting(timeZone, now = new Date()) {
    const hour = getZonedHour(now, timeZone);
    if (typeof hour !== "number" || !Number.isFinite(hour)) return "Hello,";
    if (hour >= 5 && hour < 12) return "Good morning,";
    if (hour >= 12 && hour < 17) return "Good afternoon,";
    if (hour >= 17 && hour < 21) return "Good evening,";
    return "Good night,";
  }

  function addDaysToKey(dayKey, days) {
    const dt = new Date(`${dayKey}T00:00:00Z`);
    dt.setUTCDate(dt.getUTCDate() + days);
    return dt.toISOString().slice(0, 10);
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
    } catch (err) {
      console.warn("[format.js] formatDayShort failed:", err);
      return String(dayKey ?? "—");
    }
  }

  function formatDayLong(dayKey) {
    try {
      return DAY_LONG_FMT.format(new Date(`${dayKey}T00:00:00Z`));
    } catch (err) {
      console.warn("[format.js] formatDayLong failed:", err);
      return String(dayKey ?? "—");
    }
  }

  function formatDayWeekdayShort(dayKey) {
    try {
      return DAY_WEEKDAY_FMT.format(new Date(`${dayKey}T00:00:00Z`));
    } catch (err) {
      console.warn("[format.js] formatDayWeekdayShort failed:", err);
      return String(dayKey ?? "—");
    }
  }

  function formatDayWeekdayLong(dayKey) {
    try {
      return DAY_WEEKDAY_LONG_FMT.format(new Date(`${dayKey}T00:00:00Z`));
    } catch (err) {
      console.warn("[format.js] formatDayWeekdayLong failed:", err);
      return String(dayKey ?? "—");
    }
  }

  function formatDayTickWeekday(dayKey) {
    try {
      return DAY_TICK_WEEKDAY_FMT.format(new Date(`${dayKey}T00:00:00Z`));
    } catch (err) {
      console.warn("[format.js] formatDayTickWeekday failed:", err);
      return String(dayKey ?? "—").slice(5);
    }
  }

  function formatRangeLabel(minDayKey, maxDayKey) {
    if (minDayKey === maxDayKey) return formatDayLong(maxDayKey);
    const sameYear = String(minDayKey).slice(0, 4) === String(maxDayKey).slice(0, 4);
    if (sameYear) return `${formatDayShort(minDayKey)} → ${formatDayLong(maxDayKey)}`;
    return `${formatDayLong(minDayKey)} → ${formatDayLong(maxDayKey)}`;
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

  function safeJsonParse(text) {
    try {
      return { ok: true, value: JSON.parse(text) };
    } catch (err) {
      return { ok: false, error: err };
    }
  }

  return {
    escapeHtml,
    safeJsonParse,
    validateTimeZone,
    formatDayKey,
    getZonedHour,
    dayPartGreeting,
    addDaysToKey,
    formatDayShort,
    formatDayLong,
    formatDayWeekdayShort,
    formatDayWeekdayLong,
    formatDayTickWeekday,
    formatRangeLabel,
    formatRangeWeekdayShort,
    formatWindowRange,
  };
}

