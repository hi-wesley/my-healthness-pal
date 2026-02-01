// Re-export layer for backward compatibility
// All utilities are canonically defined in ../utils.js

export {
  isPlainObject,
  toNumber,
  isFiniteNumber,
  avg,
  sum,
  median,
  clamp,
  clamp01,
  kgToLb,
  lbToKg,
  stddev,
  formatNumber,
  formatSigned,
  formatMinutesAsHM,
  escapeHtml,
  validateTimeZone,
  addDaysToKey,
} from "../utils.js";
