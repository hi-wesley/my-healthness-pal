export function isPlainObject(value) {
  return (
    value !== null &&
    typeof value === "object" &&
    Object.prototype.toString.call(value) === "[object Object]"
  );
}

export function isFiniteNumber(value) {
  return typeof value === "number" && Number.isFinite(value);
}

export function toNumber(value) {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim() !== "") {
    const num = Number(value);
    return Number.isFinite(num) ? num : null;
  }
  return null;
}

export function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

export function clamp01(value) {
  return clamp(value, 0, 1);
}

export function avg(nums) {
  if (nums.length === 0) return null;
  let sum = 0;
  for (const n of nums) sum += n;
  return sum / nums.length;
}

export function stddev(nums) {
  if (nums.length === 0) return null;
  const mean = avg(nums);
  if (mean === null) return null;
  let variance = 0;
  for (const v of nums) variance += (v - mean) ** 2;
  variance /= nums.length;
  return Math.sqrt(variance);
}

export function formatNumber(value, digits) {
  if (!isFiniteNumber(value)) return "—";
  return value.toFixed(digits);
}

export function formatSigned(value, digits) {
  if (!isFiniteNumber(value)) return "—";
  const sign = value > 0 ? "+" : "";
  return `${sign}${value.toFixed(digits)}`;
}

export function addDaysToKey(dayKey, days) {
  const dt = new Date(`${dayKey}T00:00:00Z`);
  dt.setUTCDate(dt.getUTCDate() + days);
  return dt.toISOString().slice(0, 10);
}

export function sum(nums) {
  let total = 0;
  for (const n of nums) total += n;
  return total;
}

export function median(nums) {
  if (nums.length === 0) return null;
  const sorted = [...nums].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  if (sorted.length % 2 === 1) return sorted[mid];
  return (sorted[mid - 1] + sorted[mid]) / 2;
}

export function escapeHtml(s) {
  return String(s).replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;");
}

export function validateTimeZone(timeZone) {
  try {
    new Intl.DateTimeFormat("en-US", { timeZone }).format(new Date());
    return true;
  } catch (err) {
    console.warn("[utils.js] validateTimeZone failed:", err);
    return false;
  }
}

const dayKeyFormatterCache = new Map();
export function formatDayKey(date, timeZone, fallbackTimeZone = "UTC") {
  const tz = validateTimeZone(timeZone)
    ? timeZone
    : validateTimeZone(fallbackTimeZone)
      ? fallbackTimeZone
      : "UTC";
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

const KG_PER_LB = 1 / 2.2046226218;

export function kgToLb(kg) {
  return kg / KG_PER_LB;
}

export function lbToKg(lb) {
  return lb * KG_PER_LB;
}

export function formatMinutesAsHM(minutes) {
  if (minutes === null || minutes === undefined || !Number.isFinite(minutes)) return "—";
  const total = Math.max(0, Math.round(minutes));
  const h = Math.floor(total / 60);
  const m = total % 60;
  if (h === 0) return `${m}m`;
  if (m === 0) return `${h}h`;
  return `${h}h ${m}m`;
}
