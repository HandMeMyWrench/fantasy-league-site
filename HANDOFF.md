# Project Handoff — Self Will Run Riot Fantasy Relegation League

A living brief so a fresh assistant session can get up to speed fast. **Read this first.**

## What this is
A fantasy football website for a Sleeper league that runs a custom **relegation system**:
two 12-team leagues, an **Upper** and a **Lower**. Bottom teams of the Upper get relegated;
top teams of the Lower get promoted. It solves Sleeper's inability to merge two leagues.

- **Repo:** https://github.com/HandMeMyWrench/fantasy-league-site
- **Live site:** https://fantasy-league-site-green.vercel.app (deployed on Vercel, project `fantasy-league-site`)
- **Stack:** Next.js (App Router) 15.3.8, React 19, TypeScript, Tailwind CSS v4. No backend/database — it reads the public Sleeper API only.

## How to work on it (deploy workflow)
- Edit files in the connected folder, run `npx next build` to verify, then commit & push to `main`.
- Vercel auto-deploys `main` in ~40s. **The GitHub→Vercel webhook occasionally lags** — if no new deployment appears in ~2 min, push an empty commit to nudge it (`git commit --allow-empty`).
- **Vercel blocks deploys on Next.js versions with known CVEs** — keep Next patched (this bit us once; fixed by bumping to 15.3.8).
- **Pushing needs a GitHub token.** Each new session must be re-given a fine-grained PAT with *Contents: read/write* on this repo (tokens don't carry between sessions).
- **Files in the connected folder can be created/edited but NOT deleted** (permission limitation). "Removed" pages are therefore redirect stubs, not deletions.

## Key architecture
- `lib/leagues.ts` — **single source of truth.** `LEAGUES` maps each season to `{ upper, lower, movement, started }`. Helpers: `latestActiveSeason()`, `hasStarted()`, `movementSpots()`, `sortStandings()`, `pointsFor()`.
- `lib/sleeper.ts` — all Sleeper API calls + league-scored projections (`getProjectedStats`, `scoreStats`, `getLeagueScoring`).
- `lib/odds.ts` — Monte Carlo playoff/relegation simulator.
- `components/RelegationSpotlight.tsx` — home-page drama banner.

### Relegation rule (per season, via `movement`)
- **2025** (inaugural): one-time **6 up / 6 down** reshuffle.
- **2026 onward:** permanent **3 up / 3 down**.

### 2026 rollover — IMPORTANT
2026 league IDs are wired in but `started: false`, so the site shows the **provisional preview** (derived from the 2025 finish) and keeps "current season" views on 2025. **When the 2026 season actually kicks off, flip `started` to `true` on the 2026 entry in `lib/leagues.ts`** — the whole site then goes live on 2026 automatically.

### Scoring nuance
The league is half-PPR with bonuses AND an **all-play "median" game** (`league_average_match`), which is why win totals run ~2×. Projections are computed by applying the league's `scoring_settings` to raw stats (NOT the generic `pts_half_ppr`). The odds sim models the median game too.

## Pages (in nav)
Standings (`/`), Matchups (`/matchups` — storylines + projections + win% + expandable lineups, live-refreshing), Odds (`/odds`), Recap (`/recap`), Promotion / Relegation (`/promotion-relegation`), History (`/history`).
Retired → redirect stubs: `/power-rankings`, `/playoff-race`, `/power-playoff`, `/scoreboard`.

Branding: custom **SWRR** logo (`public/icon-192.png`, `icon-512.png`, `apple-touch-icon.png`, `app/favicon.ico`); installable PWA (`app/manifest.ts`).

## Ideas not yet built (backlog)
- **Trash-talk / video board** (Marco Polo style, video-with-captions). Plan: Cloudflare R2 for video (free, zero egress) + native-camera capture + a small backend. *Paused.*
- **WhatsApp chat synopsis** — via WhatsApp's "Export chat" → generate a recap (live mirroring is ToS-risky, avoided).
- Champion banner, all-time records (Hall of Fame/Shame), manager profile pages, season trend charts, auto weekly recap on a schedule.
