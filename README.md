# MyHealthnessPal (Fitness Tracker Demo)

https://my-healthness-pal.netlify.app/

https://youtu.be/GKUiJHwpMxs

https://github.com/hi-wesley/my-healthness-pal/blob/main/DOCUMENTATION.md

Static, browser-based dashboard for daily health/fitness signals (sleep, exercise, nutrition, blood pressure, weight, resting HR). Optionally, a small Node/Express backend can generate AI insights via the OpenAI API.

## Repository layout
- Frontend (repo root): `index.html`, `styles.css`, `app.js`, `modules/`
- Backend: `backend/` (Express server that also serves the static frontend)
- Netlify: `netlify.toml` + `netlify/functions/insights.js` (build + proxy setup)
- Dev script: `scripts/check-ui-wiring.js`

## What’s included
- Dashboard (2×3): Sleep, Physiological stress, Exercise, Nutrition, Blood pressure, Weight
- Insights ("For You"): Overall summary + one card per category (optionally AI-generated)

## Run locally
### Frontend only (no AI insights)
Serve the repo root with any static server (ES modules require `http://`, not `file://`).

Example:
- `python3 -m http.server 5173`
- Open `http://localhost:5173`

Without a backend, the insights section will show placeholders / "AI insights unavailable".

### Full stack (frontend + AI insights backend)
1) `cd backend`
2) Create `backend/.env`:
```env
OPENAI_API_KEY=...
# Optional
OPENAI_MODEL=gpt-5.2
PORT=8787
```
3) `npm install`
4) `npm run dev`
5) Open `http://localhost:8787`
6) Verify: `curl http://localhost:8787/health`

## Deploy
### Netlify (frontend)
This repo includes a `netlify.toml` that:
- builds a minimal `dist/` by copying static frontend assets
- redirects `/health` to your backend origin
- proxies `/insights` through a Netlify Function (`netlify/functions/insights.js`) so the proxy secret is never exposed client-side

Netlify env vars:
- `MHP_BACKEND_ORIGIN` (backend base URL; defaults to `http://5.78.180.72:8787` in this repo’s config)
- `MHP_PROXY_SECRET` (sent as `x-mhp-proxy-secret`; should match backend `INSIGHTS_PROXY_SECRET`)

### Backend (Node/Express)
Run `backend/server.js` on Node 18+ (it serves the static frontend from the repo root).

Endpoints:
- `GET /health`
- `POST /insights` (starts an async job; returns `202` with a `jobId`)
- `GET /insights?jobId=...` (polls the job; returns `202` pending or `200` with results)

Backend env vars:
- Required for AI: `OPENAI_API_KEY`
- Optional: `OPENAI_MODEL`, `PORT`, `CORS_ORIGIN`
- Production hardening:
  - `NODE_ENV=production`
  - `INSIGHTS_PROXY_SECRET` (enforces `x-mhp-proxy-secret` on `/insights`)
  - Rate limiting: `INSIGHTS_RATE_ANY_PER_MIN`, `INSIGHTS_RATE_POST_PER_MIN`, `INSIGHTS_RATE_GET_PER_MIN`
- Debug (non-production only): `INSIGHTS_INCLUDE_RAW=1`

## Data model (frontend)
The dashboard aggregates records into daily summaries. The payload shape is:
- `{ "user": { "id"?, "name"?, "tz"? }, "records": [...] }`, or
- a raw `[...]` array of records.

Each record must include:
- `type` (string)
- `data` (object)
- either `timestamp` (ISO string) or both `start` + `end` (ISO strings)
- optional `source` (string)

Supported record types are implemented in `modules/data.js` (e.g. `sleep_session`, `nutrition`, `steps`, `workout`, `resting_heart_rate`, `blood_pressure`, `weight`). Sample data is generated from `modules/ui/samples.js` via `modules/ui/sampleGenerator.js`.
