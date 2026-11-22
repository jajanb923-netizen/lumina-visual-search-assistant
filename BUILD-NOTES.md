# BUILD-NOTES — Lumina (StackUp November Coding Challenge)

Built 22 Nov 2026, 02:12–03:00 WIB, by a coordinator subagent.
Challenge: https://hackathon.stackup.dev/web/events/stackup-november-coding-challenge
Deadline: submit before 25 Nov 2026 11:00 WIB (12:00 GMT+8). Registration open until 24 Nov.

## What was chosen and why

- **Statement 2 — Visual Search Assistant.** The cleanest multimodal loop
  (image → text → speech, plus visual-search Q&A), fully buildable on free
  tiers, most demo-able in 60 seconds, and the accessibility story is the
  strongest judging angle (usability 25% + innovation 10%).
- **Next.js 15.5.29 (App Router, TypeScript strict) + React 19.** Matches the
  criteria's "best practices for Next.js". Started on 15.1.6, upgraded twice
  after npm flagged CVE-2025-66478 and the Dec 2025 security update; 15.5.29
  installs with no vulnerability warning.
- **OpenRouter `:free` vision models, not Gemini-direct.** Groq has no vision
  model on this key (verified: 11 models, none vision-capable). A Gemini
  direct key would have needed the user's existing key plumbed through the
  build; OpenRouter gives one free key, no card, and a 5-model failover
  chain — including two Gemini-family models (gemma-4) — which is strictly
  more reliable for a judge running the app cold.
- **Speech via the browser Web Speech API.** Free, no key, no network, and
  the natural choice for the statement's "speech synthesis" requirement.

## Verification (all live, 22 Nov 2026)

- `npx next build`: clean, TypeScript strict, 0 errors. First Load JS 108 kB.
- `POST /api/analyze` (cat, via curl): 8.1 s with 1 failover (particle 429 →
  nemotron OK); repeat 2.4 s direct. Description accurate (green eyes,
  bamboo rail, green wall).
- `POST /api/analyze` (dog): 4.7 s direct, particle-1, clean JSON.
- `POST /api/ask` ("What colour are the cat's eyes…"): correct answer
  ("green… bamboo rail"), 6.2 s with 1 failover.
- Playwright (headless Chromium, real UI): home → sample photo → live
  analysis → follow-up question → answer. Full flow passed on the 3rd run.
  Two real bugs were found and fixed during this:
  1. **Raw JSON shown as description** — the nemotron reasoning model
     returned truncated JSON; the route's fallback used the raw text. Fixed
     with field-by-field salvage (`salvageAnalysis` in `src/lib/openrouter.ts`,
     unit-tested with tsc-compiled code on truncated + fenced replies).
  2. **Per-attempt timeout 45 s too long** — first demo run timed out at
     90 s on a congested free pool. Cut to 20 s per attempt.
- Demo video: `docs/demo-video.mp4`, 29.1 s, H.264, 1.05 MB — title card +
  scripted real-UI flow + end card. Frames spot-checked.
- Screenshots: `docs/shot-1-home.png`, `shot-2-analyzing.png`,
  `shot-3-results.png`, `shot-4-ask.png` — all from the live app.

## What the demo video does NOT show

- Speech playback: headless Chromium has no speech voices, so the Listen
  button is disabled in the recording and the video shows the speech controls
  + the "no voices in this browser" note. On desktop Chrome/Edge the button
  works (voice picker, rate/pitch, speak-along highlighting). The README
  states this plainly.

## Still needed (parent's steps — do NOT do these in this build)

1. **GitHub repo**: create public repo `jajanb923-netizen/lumina-visual-search-assistant`
   (name in the video end card + README deploy notes assumes this name; rename
   the end card + README footer if a different name is used) and push this
   directory. MIT licence + `.env.example` included; `.env.local` / real keys
   are NOT in the tree (`.gitignore` covers `.env*`, `node_modules`, `.next`).
2. **Video**: upload `docs/demo-video.mp4` to YouTube (channel "Jajan Bae")
   and put the link in the README next to the mp4 link (the challenge asks
   for the video link embedded in the README or a YouTube link).
3. **Register** on the StackUp event page (open until 24 Nov) and **submit**
   before 25 Nov 11:00 WIB: GitHub repo link + video link. Last commit must
   fall inside the submission window (5–25 Nov) — it will, the repo is new.
4. **Key for the judges**: the README tells judges to get their own free
   OpenRouter key. No key is bundled. For the parent's own testing, run with
   the OpenRouter surrogate via the custom.openrouter connector helper
   (`openrouter.py surrogate` → `OPENROUTER_API_KEY` env for that process
   only; never write the key to a file).

## OpenRouter usage during this build

- Key: free tier, $100 limit, usage was 0 at start. All test calls used
  `:free` models only (cost $0 each, confirmed in usage objects).
- Free-pool burstiness is the main reliability risk; the failover chain is
  the mitigation, and it fired correctly in every live test.

## File inventory

- `package.json`, `tsconfig.json`, `next.config.ts`, `.env.example`,
  `.gitignore`, `LICENSE`, `README.md`, `BUILD-NOTES.md` (this file)
- `src/app/layout.tsx`, `src/app/page.tsx`, `src/app/globals.css`
- `src/app/api/analyze/route.ts`, `src/app/api/ask/route.ts`
- `src/lib/openrouter.ts`, `src/lib/samples.ts`, `src/lib/speech.ts`,
  `src/lib/history.ts`
- `public/samples/*.jpg` (6 photos, ~0.9 MB total)
- `docs/demo-video.mp4`, `docs/shot-1..4-*.png`
- `node_modules/`, `.next/` (build artefacts — not for the repo)
