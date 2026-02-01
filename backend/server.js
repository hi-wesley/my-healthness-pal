import "dotenv/config";
import cors from "cors";
import express from "express";
import OpenAI from "openai";
import path from "path";
import { fileURLToPath } from "url";

const PORT = Number.parseInt(process.env.PORT || "8787", 10);
const OPENAI_MODEL = (process.env.OPENAI_MODEL || "gpt-5.2").trim();
const ANALYSIS_VERSION = 1;
const corsOriginRaw = (process.env.CORS_ORIGIN || "*").trim();
const corsOrigin =
  corsOriginRaw === "*"
    ? "*"
    : corsOriginRaw
      .split(",")
      .map((o) => o.trim())
      .filter(Boolean);

function isPlainObject(value) {
  return (
    value !== null &&
    typeof value === "object" &&
    Object.prototype.toString.call(value) === "[object Object]"
  );
}

function extractJsonObject(text) {
  const raw = typeof text === "string" ? text.trim() : "";
  if (!raw) return null;
  try {
    return JSON.parse(raw);
  } catch {
    // fall through
  }

  const start = raw.indexOf("{");
  const end = raw.lastIndexOf("}");
  if (start === -1 || end === -1 || end <= start) return null;

  try {
    return JSON.parse(raw.slice(start, end + 1));
  } catch {
    return null;
  }
}

function toToneScore(value) {
  const num = typeof value === "number" ? value : typeof value === "string" ? Number(value) : NaN;
  if (!Number.isFinite(num)) return null;
  return Math.max(0, Math.min(100, Math.round(num)));
}

function normalizeInsightTextBlock(value) {
  if (!isPlainObject(value)) return null;
  const title = typeof value.title === "string" ? value.title.trim() : "";
  const body = typeof value.body === "string" ? value.body.trim() : "";
  if (!title || !body) return null;
  return { title, body };
}

function normalizeInsightsText(value) {
  if (!isPlainObject(value)) return null;
  const out = {
    overall: normalizeInsightTextBlock(value.overall),
    sleep: normalizeInsightTextBlock(value.sleep),
    stress: normalizeInsightTextBlock(value.stress),
    exercise: normalizeInsightTextBlock(value.exercise),
    nutrition: normalizeInsightTextBlock(value.nutrition),
    bp: normalizeInsightTextBlock(value.bp),
    weight: normalizeInsightTextBlock(value.weight),
  };
  if (!out.overall || !out.sleep || !out.stress || !out.exercise || !out.nutrition || !out.bp || !out.weight) {
    return null;
  }
  return out;
}

function normalizeToneBlock(value) {
  if (!isPlainObject(value)) return null;
  const toneScore = toToneScore(value.toneScore ?? value.score);
  if (toneScore === null) return null;
  return { toneScore };
}

function normalizeToneScores(value) {
  if (!isPlainObject(value)) return null;
  const out = {
    overall: normalizeToneBlock(value.overall),
    sleep: normalizeToneBlock(value.sleep),
    stress: normalizeToneBlock(value.stress),
    exercise: normalizeToneBlock(value.exercise),
    nutrition: normalizeToneBlock(value.nutrition),
    bp: normalizeToneBlock(value.bp),
    weight: normalizeToneBlock(value.weight),
  };
  if (!out.overall || !out.sleep || !out.stress || !out.exercise || !out.nutrition || !out.bp || !out.weight) {
    return null;
  }
  return out;
}

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const WEB_ROOT = path.resolve(__dirname, "..");

const app = express();
app.use(cors({ origin: corsOrigin }));
app.use(express.json({ limit: "2mb" }));
app.use(express.static(WEB_ROOT));

app.get("/health", (req, res) => {
  res.json({
    ok: true,
    openai: {
      configured: Boolean(process.env.OPENAI_API_KEY),
      model: OPENAI_MODEL,
    },
  });
});

app.post("/insights", async (req, res) => {
  if (!process.env.OPENAI_API_KEY) {
    res.status(400).json({
      ok: false,
      error: "Missing OPENAI_API_KEY",
    });
    return;
  }

  const body = req.body;
  if (!isPlainObject(body)) {
    res.status(400).json({ ok: false, error: "Expected a JSON object body." });
    return;
  }

  const profileId = typeof body.profileId === "string" ? body.profileId.trim() : "";
  const profileName = typeof body.profileName === "string" ? body.profileName.trim() : "";
  const dayKey = typeof body.dayKey === "string" ? body.dayKey.trim() : "";
  const timeZone =
    typeof body.timeZone === "string" && body.timeZone.trim() ? body.timeZone.trim() : "America/Los_Angeles";
  const days = Array.isArray(body.days) ? body.days.slice(-60) : [];

  if (!profileId) {
    res.status(400).json({ ok: false, error: 'Missing required field "profileId".' });
    return;
  }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dayKey)) {
    res.status(400).json({ ok: false, error: 'Missing/invalid required field "dayKey" (YYYY-MM-DD).' });
    return;
  }
  if (days.length === 0) {
    res.status(400).json({ ok: false, error: 'Missing required field "days" (non-empty array).' });
    return;
  }

  const promptText = [
    "You are generating actionable insights for a fitness dashboard.",
    "Write in a friendly, direct tone.",
    'Format any durations as "7h 46m" (no decimals; no "min" units).',
    "- Learn the user's recent baseline for each metric from the available days (e.g., typical level, range, and variability).",
    "- Detect meaningful deviations (spikes/dips), short trends (2–4 days), and persistent patterns (3+ days).",
    "- For the OVERALL insight, prioritize correlations/relationships between metrics across days.",
    "  Examples of correlation language:",
    "  - 'On days after shorter sleep, your afternoon calories tend to be higher.'",
    "  - 'Higher physiological stress days often line up with higher resting heart rate the next day.'",
    "  - 'When exercise load rises, sleep duration/quality tends to change.'",
    "",
    `Profile: ${profileName || profileId} (${profileId})`,
    `As-of dayKey: ${dayKey}`,
    `Time zone: ${timeZone}`,
    "",
    "Daily data (oldest → newest):",
    JSON.stringify(days),
    "",
    "Return ONLY a single JSON object with EXACTLY these keys and shapes:",
    "{",
    '  "overall":  { "title": string, "body": string },',
    '  "sleep":    { "title": string, "body": string },',
    '  "stress":   { "title": string, "body": string },',
    '  "exercise": { "title": string, "body": string },',
    '  "nutrition":{ "title": string, "body": string },',
    '  "bp":       { "title": string, "body": string },',
    '  "weight":   { "title": string, "body": string }',
    "}",
  ].join("\n");

  try {
    const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
    const insightResponse = await client.responses.create({
      model: OPENAI_MODEL,
      input: promptText,
      max_output_tokens: 750,
    });

    const insightText = typeof insightResponse.output_text === "string" ? insightResponse.output_text : "";
    const insightParsed = extractJsonObject(insightText);
    const insightBlocks = normalizeInsightsText(insightParsed);

    if (!insightBlocks) {
      res.status(502).json({
        ok: false,
        error: "Model returned invalid insights JSON.",
        raw: insightText.slice(0, 5000),
      });
      return;
    }

    const promptTone = [
      "You are scoring the tone of insight cards for a fitness dashboard.",
      "Score EACH card independently based ONLY on that card's title/body.",
      "toneScore is 0–100 where 100 = very good (green), 50 = neutral (yellow), 0 = concerning (red).",
      "Keep scores aligned with the text and avoid extremes unless clearly warranted.",
      "",
      `As-of dayKey: ${dayKey}`,
      `Time zone: ${timeZone}`,
      "",
      "Cards to score:",
      JSON.stringify(insightBlocks),
      "",
      "Return ONLY a single JSON object with EXACTLY these keys and shapes:",
      "{",
      '  "overall":  { "toneScore": number },',
      '  "sleep":    { "toneScore": number },',
      '  "stress":   { "toneScore": number },',
      '  "exercise": { "toneScore": number },',
      '  "nutrition":{ "toneScore": number },',
      '  "bp":       { "toneScore": number },',
      '  "weight":   { "toneScore": number }',
      "}",
    ].join("\n");

    const toneResponse = await client.responses.create({
      model: OPENAI_MODEL,
      input: promptTone,
      max_output_tokens: 220,
    });

    const toneText = typeof toneResponse.output_text === "string" ? toneResponse.output_text : "";
    const toneParsed = extractJsonObject(toneText);
    const toneBlocks = normalizeToneScores(toneParsed);

    if (!toneBlocks) {
      res.status(502).json({
        ok: false,
        error: "Model returned invalid toneScore JSON.",
        raw: toneText.slice(0, 5000),
      });
      return;
    }

    const insights = {
      overall: { ...insightBlocks.overall, ...toneBlocks.overall, toneDayKey: dayKey },
      sleep: { ...insightBlocks.sleep, ...toneBlocks.sleep, toneDayKey: dayKey },
      stress: { ...insightBlocks.stress, ...toneBlocks.stress, toneDayKey: dayKey },
      exercise: { ...insightBlocks.exercise, ...toneBlocks.exercise, toneDayKey: dayKey },
      nutrition: { ...insightBlocks.nutrition, ...toneBlocks.nutrition, toneDayKey: dayKey },
      bp: { ...insightBlocks.bp, ...toneBlocks.bp, toneDayKey: dayKey },
      weight: { ...insightBlocks.weight, ...toneBlocks.weight, toneDayKey: dayKey },
    };

    res.json({
      ok: true,
      model: OPENAI_MODEL,
      dayKey,
      analysisVersion: ANALYSIS_VERSION,
      insights,
    });
  } catch (err) {
    res.status(500).json({
      ok: false,
      error: "Failed to generate insights.",
      details: err instanceof Error ? err.message : String(err),
    });
  }
});

app.listen(PORT, () => {
  console.log(`Backend listening on http://localhost:${PORT}`);
});
