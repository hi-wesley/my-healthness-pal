import { escapeHtml, formatNumber, isFiniteNumber } from "./utils.js";

let themeColors = null;

export function readThemeColors() {
  const styles = getComputedStyle(document.documentElement);
  const get = (name, fallback) => {
    const value = styles.getPropertyValue(name).trim();
    return value || fallback;
  };
  return {
    chartGrid: get("--chart-grid", "rgba(60, 60, 67, 0.12)"),
    chartLabel: get("--chart-label", "rgba(60, 60, 67, 0.75)"),
    chartHover: get("--chart-hover", "rgba(60, 60, 67, 0.25)"),
    chartAnomaly: get("--chart-anomaly", "rgba(255, 59, 48, 0.10)"),
  };
}

export function updateThemeColors() {
  themeColors = readThemeColors();
  return themeColors;
}

export function getThemeColors() {
  return themeColors ?? readThemeColors();
}

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

function formatDayWeekdayLong(dayKey) {
  try {
    return DAY_WEEKDAY_LONG_FMT.format(new Date(`${dayKey}T00:00:00Z`));
  } catch {
    return String(dayKey ?? "—");
  }
}

function formatDayTickWeekday(dayKey) {
  try {
    return DAY_TICK_WEEKDAY_FMT.format(new Date(`${dayKey}T00:00:00Z`));
  } catch (err) {
    console.warn("[charting.js] formatDayTickWeekday failed:", err);
    return String(dayKey ?? "—").slice(5);
  }
}

export class MiniChart {
  constructor(canvas, tooltipDiv, { heightPx = 140 } = {}) {
    this.canvas = canvas;
    this.tooltipDiv = tooltipDiv;
    this.heightPx = heightPx;
    this.series = null;
    this.hoverIndex = null;
    this.renderScheduled = false;
    this.canvas.style.height = `${this.heightPx}px`;
    this.resizeObserver = new ResizeObserver(() => this.requestRender());
    this.resizeObserver.observe(this.canvas);

    this.canvas.addEventListener("mousemove", (ev) => this.onMove(ev));
    this.canvas.addEventListener("mouseleave", () => this.onLeave());
  }

  setSeries(series) {
    this.series = series;
    this.requestRender();
  }

  clear() {
    this.series = null;
    this.hoverIndex = null;
    this.tooltipDiv.hidden = true;
    const ctx = this.canvas.getContext("2d");
    if (!ctx) return;
    ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
  }

  onLeave() {
    this.hoverIndex = null;
    this.tooltipDiv.hidden = true;
    this.requestRender();
  }

  onMove(ev) {
    if (!this.series) return;
    const rect = this.canvas.getBoundingClientRect();
    const x = ev.clientX - rect.left;
    const idx = this.pickIndex(x, rect.width);
    if (idx === null) return;
    this.hoverIndex = idx;
    this.showTooltip(ev.clientX, ev.clientY);
    this.requestRender();
  }

  pickIndex(x, width) {
    const { dates } = this.series;
    const n = dates.length;
    if (n === 0) return null;

    const padL = 44;
    const padR = 12;
    const innerW = Math.max(1, width - padL - padR);
    if (n === 1) return 0;
    const step = innerW / (n - 1);
    const raw = (x - padL) / step;
    const idx = Math.max(0, Math.min(n - 1, Math.round(raw)));
    return idx;
  }

  showTooltip(clientX, clientY) {
    if (!this.series || this.hoverIndex === null) return;
    const { dates, values, label, unit } = this.series;
    const dayKey = dates[this.hoverIndex];
    const value = values[this.hoverIndex];

    let html = null;
    if (typeof this.series.tooltipHtml === "function") {
      try {
        html = this.series.tooltipHtml({ dayKey, value, index: this.hoverIndex });
      } catch {
        html = null;
      }
    }
    if (typeof html !== "string" || !html) {
      const digits = unit === "lb" || unit === "kg" || unit === "h" ? 1 : 0;
      const valueLabel = typeof value === "number" ? `${formatNumber(value, digits)} ${unit}` : "—";
      html = `<div class="tip-title">${escapeHtml(label)}</div>
          <div class="mono">${escapeHtml(formatDayWeekdayLong(dayKey))}</div>
          <div>${escapeHtml(valueLabel)}</div>`;
    }

    this.tooltipDiv.innerHTML = html;

    const margin = 14;
    this.tooltipDiv.hidden = false;
    const rect = this.tooltipDiv.getBoundingClientRect();
    const left = Math.min(window.innerWidth - rect.width - margin, clientX + 12);
    const top = Math.min(window.innerHeight - rect.height - margin, clientY + 12);
    this.tooltipDiv.style.left = `${Math.max(margin, left)}px`;
    this.tooltipDiv.style.top = `${Math.max(margin, top)}px`;
  }

  requestRender() {
    if (this.renderScheduled) return;
    this.renderScheduled = true;
    requestAnimationFrame(() => {
      this.renderScheduled = false;
      this.render();
    });
  }

  render() {
    const series = this.series;
    if (!series) return;

    const cssWidth = this.canvas.clientWidth;
    if (!Number.isFinite(cssWidth) || cssWidth <= 0) return;
    const cssHeight = this.heightPx;
    const dpr = window.devicePixelRatio || 1;
    const nextWidth = Math.max(1, Math.round(cssWidth * dpr));
    const nextHeight = Math.max(1, Math.round(cssHeight * dpr));
    if (this.canvas.width !== nextWidth) this.canvas.width = nextWidth;
    if (this.canvas.height !== nextHeight) this.canvas.height = nextHeight;
    const ctx = this.canvas.getContext("2d");
    if (!ctx) return;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

    const { dates, values, color, kind, anomalies, unit } = series;
    const n = dates.length;

    const padL = 44;
    const padR = 12;
    const padT = 10;
    const padB = 22;

    const plotW = cssWidth - padL - padR;
    const plotH = cssHeight - padT - padB;

    ctx.clearRect(0, 0, cssWidth, cssHeight);

    const colors = getThemeColors();
    ctx.strokeStyle = colors.chartGrid;
    ctx.lineWidth = 1;
    for (let i = 0; i <= 2; i += 1) {
      const y = padT + (plotH * i) / 2;
      ctx.beginPath();
      ctx.moveTo(padL, y);
      ctx.lineTo(cssWidth - padR, y);
      ctx.stroke();
    }

    const defined = values.filter(isFiniteNumber);
    let min = defined.length > 0 ? Math.min(...defined) : 0;
    let max = defined.length > 0 ? Math.max(...defined) : 1;

    const overrideMin = isFiniteNumber(series.yMin) ? series.yMin : null;
    const overrideMax = isFiniteNumber(series.yMax) ? series.yMax : null;
    const snapStep = isFiniteNumber(series.ySnapStep) && series.ySnapStep > 0 ? series.ySnapStep : null;

    const barFloorAtZero =
      kind === "bar" && (overrideMin === null || overrideMin === 0) && (defined.length === 0 || min >= 0);

    if (barFloorAtZero) min = 0;
    if (overrideMin !== null) min = overrideMin;
    if (overrideMax !== null) max = overrideMax;
    if (max === min) {
      if (barFloorAtZero) {
        max += 1;
      } else {
        max += 1;
        min -= 1;
      }
    }

    if (overrideMin === null && overrideMax === null && snapStep !== null && defined.length > 0) {
      min = Math.floor(min / snapStep) * snapStep;
      max = Math.ceil(max / snapStep) * snapStep;
      if (max === min) {
        max += snapStep;
        min -= snapStep;
      }
      min -= snapStep;
      max += snapStep;
    } else if (overrideMin === null && overrideMax === null) {
      const pad = (max - min) * 0.08;
      max += pad;
      if (!barFloorAtZero) min -= pad;
    }

    if (barFloorAtZero) min = Math.max(0, min);

    const yFor = (v) => padT + ((max - v) / (max - min)) * plotH;

    // y labels
    const digits = isFiniteNumber(series.yLabelDigits)
      ? series.yLabelDigits
      : unit === "lb" || unit === "kg" || unit === "h"
        ? 1
        : 0;
    ctx.fillStyle = colors.chartLabel;
    ctx.font =
      "11px ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, 'Liberation Mono', 'Courier New', monospace";
    ctx.textAlign = "left";
    ctx.textBaseline = "middle";
    ctx.fillText(formatNumber(max, digits), 6, padT);
    ctx.fillText(formatNumber((min + max) / 2, digits), 6, padT + plotH / 2);
    ctx.fillText(formatNumber(min, digits), 6, padT + plotH);

    // anomaly shading
    const anomalySet =
      anomalies instanceof Set ? anomalies : anomalies?.indices instanceof Set ? anomalies.indices : null;
    if (anomalySet && anomalySet.size > 0 && n > 1) {
      const step = plotW / (n - 1);
      ctx.fillStyle = colors.chartAnomaly;
      for (const idx of anomalySet) {
        if (typeof idx !== "number" || !Number.isFinite(idx)) continue;
        if (idx < 0 || idx >= n) continue;
        const x = padL + idx * step;
        ctx.fillRect(x - step * 0.35, padT, step * 0.7, plotH);
      }
    }

    // series
    ctx.strokeStyle = color;
    ctx.fillStyle = color;
    ctx.lineWidth = 2;

    const barColorList = Array.isArray(series.barColors) ? series.barColors : null;
    const barColorFn = typeof series.barColor === "function" ? series.barColor : null;
    const barFillFor = (idx, v) => {
      const candidate = barColorList?.[idx];
      if (typeof candidate === "string" && candidate) return candidate;
      if (barColorFn) {
        try {
          const fnColor = barColorFn({ index: idx, dayKey: dates[idx], value: v });
          if (typeof fnColor === "string" && fnColor) return fnColor;
        } catch {
          // ignore
        }
      }
      return color;
    };

    if (n === 1) {
      const v = values[0];
      if (isFiniteNumber(v)) {
        if (kind === "bar") {
          const barW = 18;
          const x = padL;
          const y = yFor(v);
          ctx.globalAlpha = 0.85;
          ctx.fillStyle = barFillFor(0, v);
          ctx.fillRect(x - barW / 2, y, barW, padT + plotH - y);
          ctx.globalAlpha = 1;
        } else {
          ctx.beginPath();
          ctx.arc(padL, yFor(v), 3, 0, Math.PI * 2);
          ctx.fill();
        }
      }
    } else if (kind === "bar") {
      const step = plotW / (n - 1);
      const barW = Math.max(4, Math.min(18, step * 0.65));
      for (let i = 0; i < n; i += 1) {
        const v = values[i];
        if (!isFiniteNumber(v)) continue;
        const x = padL + i * step;
        const y = yFor(v);
        ctx.globalAlpha = 0.85;
        ctx.fillStyle = barFillFor(i, v);
        ctx.fillRect(x - barW / 2, y, barW, padT + plotH - y);
        ctx.globalAlpha = 1;
      }
    } else {
      ctx.beginPath();
      let started = false;
      const step = plotW / (n - 1);
      for (let i = 0; i < n; i += 1) {
        const v = values[i];
        if (!isFiniteNumber(v)) continue;
        const x = padL + i * step;
        const y = yFor(v);
        if (!started) {
          ctx.moveTo(x, y);
          started = true;
        } else {
          ctx.lineTo(x, y);
        }
      }
      ctx.stroke();

      // points
      for (let i = 0; i < n; i += 1) {
        const v = values[i];
        if (!isFiniteNumber(v)) continue;
        const x = padL + i * step;
        const y = yFor(v);
        ctx.globalAlpha = 0.9;
        ctx.beginPath();
        ctx.arc(x, y, 2.2, 0, Math.PI * 2);
        ctx.fill();
        ctx.globalAlpha = 1;
      }
    }

    // x labels (first/middle/last)
    ctx.fillStyle = colors.chartLabel;
    ctx.font =
      "11px ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, 'Liberation Mono', 'Courier New', monospace";
    ctx.textBaseline = "alphabetic";
    ctx.textAlign = "center";
    const labelFor = (idx) => (n === 1 || n === 7 ? formatDayTickWeekday(dates[idx]) : dates[idx].slice(5));

    if (n === 1) {
      ctx.fillText(labelFor(0), padL, cssHeight - 6);
    } else {
      const labels = [0, Math.floor((n - 1) / 2), n - 1].filter((v, idx, arr) => arr.indexOf(v) === idx);
      for (const idx of labels) {
        const x = padL + (plotW * idx) / (n - 1);
        ctx.textAlign = idx === 0 ? "left" : idx === n - 1 ? "right" : "center";
        ctx.fillText(labelFor(idx), x, cssHeight - 6);
      }
    }

    // hover marker
    if (this.hoverIndex !== null && n > 1) {
      const step = plotW / (n - 1);
      const x = padL + this.hoverIndex * step;
      ctx.strokeStyle = colors.chartHover;
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(x, padT);
      ctx.lineTo(x, padT + plotH);
      ctx.stroke();
    }
  }
}
