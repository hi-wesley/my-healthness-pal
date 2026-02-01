import "dotenv/config";
import cors from "cors";
import express from "express";
import OpenAI from "openai";
import path from "path";
import { fileURLToPath } from "url";

const PORT = Number.parseInt(process.env.PORT || "8787", 10);
const OPENAI_MODEL = (process.env.OPENAI_MODEL || "gpt-5.2").trim();
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

function normalizeInsightBlock(value) {
  if (!isPlainObject(value)) return null;
  const title = typeof value.title === "string" ? value.title.trim() : "";
  const body = typeof value.body === "string" ? value.body.trim() : "";
  if (!title || !body) return null;
  return { title, body };
}

function normalizeInsights(value) {
  if (!isPlainObject(value)) return null;
  const out = {
    overall: normalizeInsightBlock(value.overall),
    sleep: normalizeInsightBlock(value.sleep),
    stress: normalizeInsightBlock(value.stress),
    exercise: normalizeInsightBlock(value.exercise),
    nutrition: normalizeInsightBlock(value.nutrition),
    bp: normalizeInsightBlock(value.bp),
    weight: normalizeInsightBlock(value.weight),
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

  const prompt = [
    "You are generating short, actionable, non-medical demo insights for a fitness dashboard.",
    "Write in a friendly, direct tone. Avoid diagnosis and avoid fear-mongering.",
    'Format any durations as "7h 46m" (no decimals; no "min" units).',
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
    const response = await client.responses.create({
      model: OPENAI_MODEL,
      input: prompt,
      max_output_tokens: 650,
    });

    const text = typeof response.output_text === "string" ? response.output_text : "";
    const parsed = extractJsonObject(text);
    const insights = normalizeInsights(parsed);

    if (!insights) {
      res.status(502).json({
        ok: false,
        error: "Model returned invalid insights JSON.",
        raw: text.slice(0, 5000),
      });
      return;
    }

    res.json({
      ok: true,
      model: OPENAI_MODEL,
      dayKey,
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
