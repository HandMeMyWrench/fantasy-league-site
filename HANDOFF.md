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

## Pick'em (added July 2026) — FIRST STATEFUL FEATURE

The site now has a small backend for SWRR Pick'em ($25 buy-in weekly pick
contest — see /pickem Rules tab for the ruleset the league ratified).

**Architecture change:** picks are stored in Upstash Redis via Next.js API
routes (`app/api/pickem/*`). Everything else on the site remains
client-side/static. The storage layer degrades gracefully: if Redis env vars
are absent, /pickem shows a "not switched on yet" state and nothing breaks.

**One-time setup (commissioner, in Vercel dashboard):**
1. Project → Storage → Create Database → Upstash for Redis (free tier is
   plenty: 24 users, KB-sized writes).
2. Connect it to the project — env vars (UPSTASH_REDIS_REST_URL/TOKEN or
   KV_REST_API_URL/TOKEN; both supported) inject automatically.
3. Redeploy. Done.

**Key files:** lib/pickem/config.ts (season kickoff date, deadlines, money,
scoring constants — VERIFY KICKOFF_THURSDAY_UTC against the real NFL
schedule), scoring.ts (pure, unit-tested), board.ts (weekly board builder;
favorite = standings, week 1 = provisional ranks), storage.ts (Redis),
app/api/pickem/{board,picks,leaderboard}/route.ts, app/pickem/page.tsx.

**How it works:** first visitor after games post triggers board creation
(favorites snapshotted then). Managers claim their team with a self-set PIN
on first submission (sha256, server-side). Deadlines enforced server-side:
free edits until Thu 8PM ET, buyback (-0.5/change) until Sun 1PM ET, then
closed. All picks become public after lock. Completed weeks are scored
lazily on first leaderboard view and cached permanently in Redis.

## Nav consolidation (July 2026)

Season nav is now: Standings, Matchups, Pick'em, History (+ Draft Lottery
first while its event window is live). Retired with redirect stubs, same
pattern as the old Scoreboard: /odds -> / (Monte Carlo probabilities now
render as Ploff and Drop/Promo columns inside the standings tables via
lib/leagueOdds.ts, computed in the background only for a live in-season
year with games played and games remaining), /recap -> /matchups
(storyline strip already covered it), /promotion-relegation -> /history
(per-season promoted/relegated groups already in each season card).
