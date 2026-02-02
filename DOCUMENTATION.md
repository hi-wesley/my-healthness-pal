# MyHealthnessPal - Documentation

This document outlines the design, tech stack, and future enhancements for this repository.

## Goals and scope
- Provide a simple, static dashboard that summarizes daily health/fitness signals (sleep, exercise, nutrition, blood pressure, weight, resting heart rate).
- Keep the frontend deployable as static assets (no build step required).
- Optionally generate "For You" AI insights via a small backend service.

Non-goals (current state):
- No user accounts or server-side persistence (everything is sample-driven / in-memory).
- Not medical advice (see disclaimer in the UI).

## Tech stack
### Frontend
- Static HTML/CSS/JS (ES modules).
- Vanilla JS rendering and state (no React/Vue/etc).
- Canvas-based mini charts and tooltips.
- Local storage for:
  - active sample profile
  - cached sample payloads
  - cached AI insights for a given profile + dayKey

Key files:
- `index.html` - layout and DOM anchors
- `app.js` - entrypoint (imports the UI module)
- `modules/ui.js` - app bootstrap (DOM wiring, sample loading, aggregation, rendering)
- `modules/` - data aggregation, stress score, insights client, chart utilities
- `modules/ui/` - UI helpers (formatters, renderers, storage, sample generation, insights view)

### Backend (optional)
- Node.js (package specifies `>=18`), ESM modules.
- Express server that:
  - serves the static frontend from the repo root
  - exposes `/health`
  - exposes an async job-based `/insights` API
- OpenAI Node SDK (`openai`) using the Responses API to generate a JSON insights payload.
- In-memory job store for insights generation (ephemeral; jobs expire after a short TTL).

Key files:
- `backend/server.js`
- `backend/package.json`

### Netlify (deployment option)
- `netlify.toml` publishes a minimal `dist/` by copying static assets.
- `/health` is redirected to the backend origin.
- `/insights` is proxied through a Netlify Function so secrets are not exposed to the browser.

Key files:
- `netlify.toml`
- `netlify/functions/insights.js`

## Architecture overview

### Local (frontend-only)
Browser -> static server -> frontend

- Works for dashboard rendering using sample data.
- AI insights are unavailable (no `/insights` endpoint).

### Local (full stack)
Browser -> backend (`backend/server.js`) -> OpenAI

- The backend serves the frontend and handles `/insights`.
- Same-origin requests from the browser can call `/insights` directly.

### Netlify + remote backend
Browser -> Netlify (static) -> Netlify Function -> backend -> OpenAI

- The Netlify function attaches the `x-mhp-proxy-secret` header so the backend can restrict `/insights`.
- The frontend never sees the secret.

## Data model and pipeline (frontend)

### Raw payload
The frontend supports either:
- `{ "user": { "id"?, "name"?, "tz"? }, "records": [...] }`, or
- a raw `[...]` array of record objects

### Record normalization + validation
Implemented in `modules/data.js`:
- Each record must include:
  - `type` (string)
  - `data` (object)
  - either `timestamp` (ISO string) OR both `start` and `end` (ISO strings)
  - optional `source` (string)
- Records are normalized to internal objects with parsed `Date` values.

### Daily aggregation
Implemented in `modules/data.js`:
- Records are aggregated into daily summaries based on the user's time zone.
- Output `days[]` contains one entry per dayKey from minDayKey..maxDayKey (missing days are filled with empty shells).
- The app uses daily metrics like:
  - sleep_hours, sleep_quality, sleep_minutes, sleep_primary
  - workout_minutes, workout_calories, workout_load, workout_by_activity
  - calories, carbs_g, protein_g, fat_g, sugar_g
  - steps
  - rhr_bpm, weight_kg, bp_systolic, bp_diastolic

### Stress score
Implemented in `modules/stress.js`:
- Produces a 0-100 "stress_score" where higher is better recovery / lower physiological stress.
- Uses recent baselines and absolute thresholds across:
  - sleep_hours (lower is worse)
  - rhr_bpm (higher is worse)
  - workout_load (higher is worse)
- Also produces a qualitative label ("Low", "Moderate", "High") based on score bands.

## UI design (frontend)

### Rendering model
The bootstrap in `modules/ui.js` builds a `model`:
- `days`, `minDayKey`, `maxDayKey`
- `recordCount`, `sources`
- `timeZone`, `userId`, `userName`

That model is passed to:
- the focus dashboard renderer (charts + headline numbers)
- the insights view renderer ("For You")

### Sample data
- Sample profiles are defined in `modules/ui/samples.js`.
- Sample payloads are generated in `modules/ui/sampleGenerator.js`.
- The selected profile is stored in local storage so reloads keep the same sample.

### Charts
- Canvas charts are implemented in `modules/charting.js` (and legacy chart code exists in `modules/ui.js`).
- Range toggles (1/7/30, etc) are wired through `modules/ui/events.js`.

## AI insights design

### Frontend contract
The frontend requests AI insights via `modules/insights.js` and `modules/ui/insightsView.js`:
- `POST /insights` with `{ profileId, profileName, dayKey, timeZone, days }`
  - `days` is normalized for insights (includes computed stress fields), capped to recent history.
- Poll `GET /insights?jobId=...` until:
  - `202` (pending), or
  - `200` with `{ ok: true, insights: { overall, sleep, stress, exercise, nutrition, bp, weight } }`

The UI caches insights in local storage keyed by `profileId:dayKey`.

### Backend contract
Implemented in `backend/server.js`:
- `POST /insights` returns `202` with a `jobId` and starts generation asynchronously.
- `GET /insights?jobId=...` returns:
  - `202` while pending
  - `200` with generated insights when done
  - `500` if the job failed
- The OpenAI response is expected to be a single JSON object containing exactly:
  - `overall`, `sleep`, `stress`, `exercise`, `nutrition`, `bp`, `weight`
  - each with `{ title: string, body: string }`

### Security model for insights (prod)
- Backend can require a shared secret via `INSIGHTS_PROXY_SECRET`.
- The secret is sent in the `x-mhp-proxy-secret` header.
- Netlify's `netlify/functions/insights.js` injects the secret server-side using `MHP_PROXY_SECRET`.

### Rate limiting and logging
Backend includes:
- per-IP fixed-window rate limiting for `/insights`
- request logging for `/insights` calls

## Configuration reference

### Backend env vars (`backend/.env`)
Required for AI:
- `OPENAI_API_KEY`

Optional:
- `OPENAI_MODEL` (defaults in code)
- `PORT` (defaults to `8787`)
- `CORS_ORIGIN` (`*` or comma-separated list)

Production hardening:
- `NODE_ENV=production`
- `INSIGHTS_PROXY_SECRET` (required in production to protect `/insights`)
- Rate limiting:
  - `INSIGHTS_RATE_ANY_PER_MIN`
  - `INSIGHTS_RATE_POST_PER_MIN`
  - `INSIGHTS_RATE_GET_PER_MIN`

Debug (non-production only):
- `INSIGHTS_INCLUDE_RAW=1` (includes partial raw model output in error responses)

### Netlify env vars
- `MHP_BACKEND_ORIGIN` (backend base URL)
- `MHP_PROXY_SECRET` (sent as `x-mhp-proxy-secret`)

## Future enhancements

### Data ingestion
- Add a real import UI (paste JSON, upload file).
- Add adapters for common sources (Apple Health export, Google Fit, Garmin, Oura, Whoop, Cronometer, etc).

### Persistence and accounts
- Add authentication and user accounts.
- Add background processing for daily aggregation and insights generation.

### Insights quality
- Move to strict schema validation (e.g., JSON schema) and reject/repair malformed model output.
- Add evals and golden fixtures for prompt changes.

### UX improvements
- Add drill-down views per metric (sleep sessions, workouts, meals).
- Add accessibility polishing (keyboard navigation, focus states, ARIA audits).

### Engineering hygiene
- Add automated tests for:
  - record normalization and aggregation
  - stress scoring
  - insights request/response validation