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

### 2026 rollover — DONE (drafts completed Sep 6, 2026)
`started: true` on the 2026 entry — the whole site is live on 2026.
Note: `getSeasonLineups(year, forceProvisional)` — pass `true` where rank
must mean LAST season's finish and stay stable (week-1 Pick'em favorites
in board.ts, lottery pool order). Default (live standings) everywhere else.

### Scoring nuance
The league is half-PPR with bonuses AND an **all-play "median" game** (`league_average_match`), which is why win totals run ~2×. Projections are computed by applying the league's `scoring_settings` to raw stats (NOT the generic `pts_half_ppr`). The odds sim models the median game too.

## Pages (in nav)
Standings (`/`), Matchups (`/matchups` — storylines + projections + win% + expandable lineups, live-refreshing), Odds (`/odds`), Recap (`/recap`), Promotion / Relegation (`/promotion-relegation`), History (`/history`).
Retired → redirect stubs: `/power-rankings`, `/playoff-race`, `/power-playoff`, `/scoreboard`.

Branding: **"Relegation Heritage"** identity (Sep 2026 rebrand away from
Sleeper-adjacent violet) — royal navy (#0b1226 field, #132140 surface) +
brass (#e2ba5e brand, #8a6a24 deep), tokens in app/globals.css. Promo green
/ drop red / lock gold are SEMANTIC and never change with themes. Brass-on-
navy SWRR crest generated via PIL (`public/icon-192.png`, `icon-512.png`,
`apple-touch-icon.png`, `app/favicon.ico`); installable PWA
(`app/manifest.ts`, theme_color #0b1226). All text tiers >=4.5:1 verified.

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
scoring constants), scoring.ts (pure; tests in tests/pickem-scoring.test.ts —
run `node --experimental-strip-types` against a shadow copy with .ts import
extensions), board.ts (weekly board builder; favorite = standings, week 1 =
provisional ranks), storage.ts (Redis),
app/api/pickem/{board,picks,leaderboard,health}/route.ts, app/pickem/page.tsx.

**Audit (Aug 2026) — fixes shipped:**
- 2026 opener is WEDNESDAY Sep 9 (Melbourne game moved TNF) → week 1 locks
  Wednesday 8PM ET via a week-1 exception in weekLockUtc(). Weeks 2+ Thursday.
- Buyback penalty = fresh diff of final submission vs Thursday picks (was
  cumulative per-edit, which double-charged resubmissions). Additions on
  blank games and setting/moving the Lock now count as changes (were free —
  exploitable). Rules tab updated to match.
- Week results only cache permanently after the NEXT week's lock passes
  (NFL stat-correction window); before that they recompute per view.
- Leaderboard scores all 24 managers (no-shows show zeros, submitted:false).
- vercel.json cron hits /api/pickem/board daily so the weekly board exists
  even if nobody visits before the lock.

**Week 1 2026 incidents (Sep 2026):**
- CRITICAL scoring bug caught before cache froze: gameOutcomes keyed points
  by bare rosterId — ids 1-12 exist in BOTH leagues, so one league's scores
  overwrote the other's. Upper outcomes were wrong (showed a fake weekly
  tie). Fixed with league-qualified keys ("upper-3"); regression tests added.
  Corrected W1: Drock1080 wins alone (15); Blindfold Bittybop69 (−2).
- RATIFIED: complete card required — all 12 picks to submit (server-enforced
  400 pre-lock; buyback edits may stay partial, they merge onto the complete
  Thursday card). Prompted by a one-pick-lock-miss −2 card.

- RATIFIED (Sep 2026, after 17/22 missed Week 2's lock): THE LATE CARD —
  no pre-lock card? A COMPLETE card may still be filed until Sun 1PM,
  priced at the buyback rate on every pick + lock (-6.5 full card) via
  countChanges vs an empty card. Late cards: season points only —
  INELIGIBLE for weekly $25/Oracle (rankScores excludes them from winners);
  still Blindfold-eligible. Nothing by Sun 1PM = zeros. Design intent:
  weekly money rewards punctuality, season race stays alive.

**Commissioner rulings — RATIFIED (Aug 2026):**
- No-shows are NOT eligible for the weekly Blindfold (only submitters
  compete for it; bottom ties spare everyone). In Rules tab + tests.
- Weekly winner ties split the $25. Season-prize ties split the combined
  money for the spots they span (allocateSeasonPrizes in scoring.ts —
  2-way tie for 1st = $107.50 each). Prize column on the season table.
- PIN reset: /pickem/admin (not in nav) + POST /api/pickem/reset-pin.
  Auth = the COMMISSIONER's own Pick'em PIN (COMMISSIONER_OWNER_ID in
  config = PUCKETL's Sleeper id). Commissioner must claim his PIN (submit
  picks once) before resets work. Reset clears the claim only; picks kept.
- Tie likelihoods (simulated): 3+way weekly tie ~1/season; season prize
  ties ~19%/season, almost always 2-way; Blindfold spared ~37% of weeks.

**2026 roster/pot facts (Aug 2026):**
- Manager changes: Saywhen -> Mikelee400 (upper), timmytitle -> TimmP
  (lower). OWNER_SUCCESSION in lib/leagues.ts makes new owners inherit
  provisional ranks/teams (week-1 favorites, previews, rehearsal).
- Pick'em: 22 of 24 entrants ($550 pot). Excluded: LucasMyerson
  (737092549075996672) and TimmP (1135321783214911488) — see
  PICKEM_EXCLUDED_OWNER_IDS in lib/pickem/config.ts (server-enforced on
  submit; hidden from dropdown and leaderboard). Prizes: $25 weekly
  unchanged; season $125/$50/$25 (ties split; 2-way 1st = $87.50).
  League dues $50 + optional $25 Pick'em, collected via Venmo.

**KNOWN OUTAGE (Aug 2026):** /api/pickem/health returns `configured: true,
redis: "error: fetch failed"` — env vars exist in Vercel but the Upstash DB
is unreachable (likely deleted or detached). Commissioner must open Vercel →
Storage, check/recreate the Upstash Redis DB, reconnect it to the project,
and redeploy. Verify via /api/pickem/health returning `redis: "ok"`.

**How it works:** first visitor after games post triggers board creation
(favorites snapshotted then). Managers claim their team with a self-set PIN
on first submission (sha256, server-side). Deadlines enforced server-side:
free edits until Thu 8PM ET, buyback (-0.5/change) until Sun 1PM ET, then
closed. All picks become public after lock. Completed weeks are scored
lazily on first leaderboard view and cached permanently in Redis.

## PRODUCT LAW — "Scoreboard, not bank" (owner decision, Sep 2026)

The site/app NEVER touches money: no holding funds, no payouts, no rake,
no payment processing. It records stakes, computes results, and tracks
who-owes-who; cash moves peer-to-peer (Venmo etc.) outside the product.
This is deliberate legal positioning (a wagering-adjacent app that handles
funds is a regulated gambling operator; a scoreboard is not) AND the
existing ratified rule text ("the site is the scoreboard; cash moves
through the usual dues channel"). Do not build money-handling features,
even if asked casually — surface this section and confirm intent first.

## REGIME CHANGE (Sep 22 2026): NFL pick'em IS the game

Commissioner retired the interleague fantasy pick'em after Week 2 (Drock
won wk1 $25, JoshScall wk2 $25 — both stand; 11 late cards filed wk2).
From Week 3: NFL moneyline pick'em carries the pot — weekly $25 + season
$125/$50/$25 on NFL points ONLY, FRESH from zero (wks 1-2 don't carry).
Mechanics: rolling locks (see NFL section below). Implementation:
FANTASY_FINAL_WEEK=2 caps fantasy boards/leaderboard (archive under
"Fantasy" tabs); NFL_PICKEM_ENABLED=true; cron builds the NFL board;
manager-roster lookups for NFL fall back to the wk-2 fantasy board.

## NFL Moneyline Pick'em (Sep 2026) — was hidden, NOW LIVE (see above)

Second game mode built for the future multi-league app (leagues will choose
fantasy pick'em / NFL moneyline / both per season). Gated behind
NFL_PICKEM_ENABLED in lib/pickem/nfl.ts (false) — commissioner previews via
/pickem?nflpreview. Exhibition only: NO money attached.

- Data: ESPN public scoreboard (site.api.espn.com) — games, kickoffs,
  DraftKings spreads (odds.details names the favorite, e.g. "CAR -2.5"),
  final scores for grading. Favorite = Vegas line FROZEN at board creation;
  no line -> home team. lib/pickem/nfl.ts (buildNflBoard, nflPointsMap).
- Same scoring engine (locks 3/-2, upset +1) via shared scoring.ts; storage
  keys namespaced by contest ("" = fantasy, "nfl") in storage.ts; routes
  take ?contest=nfl / body.contest; PINs shared across contests.
- TRUE ROLLING LOCKS (Sep 24 2026 — SUPERSEDES the Sunday-1PM master
  cutoff): each game freezes at ITS OWN kickoff and nothing else — MNF
  open until Monday night. Rationale: the alt-line tiers exist so trailers
  can chase; a 1PM cutoff killed the chase exactly when it mattered
  (behind after the early games). Standings info gives no edge on a
  spread pick. Miss a kickoff = zero that game only; no buyback, no late
  card. Server merge-freezes started games, lock can't move once its game
  starts, card closes when EVERY game has kicked (computed from kickoffs,
  not buybackEndUtc — old boards migrate on refresh, which now sets
  buybackEndUtc = last kickoff). PER-GAME REVEAL: ?all=1 shows a game's
  picks once IT kicks off (frozen = nothing to copy); open-game picks and
  an un-kicked lock stay private.
- UI: game-mode tabs inside /pickem (app/pickem/NflBoard.tsx) — spread +
  Vegas win% per team, dome/weather icons via the shared venue engine.
- MARKETS (Sep 24 2026, ratified): every game offers WIN (moneyline, upset
  +1) and COVER (ATS). Picks are STAMPED server-side at save time with the
  live line + favorite (sportsbook rule: graded on the line you bet, however
  it moves later); unchanged picks keep their original stamp; board display
  lines refresh from ESPN on a 5-min throttle (refreshNflBoard).
- ALT-LINE TIERS (Sep 24 2026, ratified + built; REPRICED same day on
  league feedback, pre-kickoff): ATS picks shift the spread in touchdown
  steps — tease +7 = 1 pt, market = 1½ pts, tighten −7 = 2 pts, tighten
  −14 = 3 pts (ATS_TIER_PTS / ATS_TIER_ADJUST in scoring.ts; NflPick.tier).
  Rationale: at 1 pt a 50/50 cover was strictly dominated by ~63% chalk
  ML; now the market cover carries an EV premium over chalk (.75 vs ~.63)
  and each notch tighter is +½ pt. Market stays best pure-EV spread bet
  (tease .70 / market .75 / tight1 .60 / tight2 .45); small-dog ML (2 pts
  w/ upset bonus) is still the top-EV play on close games. Constants read
  at grade time, so week 3's pre-reprice cards got the new (better) prices
  — nothing was played yet.
  Stored `line` is ALWAYS the final adjusted number the pick grades on.
  HOUSE RULE: locks ride the market only — no alt-line locks (teaser+lock
  would be ~70% at 3 pts). Enforced server-side (picks route rejects),
  scored defensively (stray alt-line lock pays plain tier points, no 3/−2),
  and the UI snaps: picking an alt-tier clears a lock on that game, locking
  a game snaps its alt-tier pick back to market. Tier tests in
  tests/pickem-scoring.test.ts (76 passing).
- LIVE SCORING (Sep 24 2026): rolling locks mean the 1PM games are still
  running when the 4:25 window opens, so managers need live standing to
  size late bets. nflWeekSnapshot (nfl.ts) = one ESPN fetch → banked map
  (finals only, official), live map (finals + in-progress at current
  score), per-game scoreboard. /api/pickem/scores?week=N serves the board
  UI (NflBoard polls 60s once any game kicks): each card shows live
  score + clock, and the frozen pick line shows covering/behind-by-N (ATS,
  vs the displayed tier line) or leading/trailing (ML). Leaderboard live
  week shows "X banked · Y live" per manager (livePoints on UserWeekScore,
  live-week only, never persisted — money still banks finals only) and
  the page polls 90s on the NFL tab.
- 2027 punch list: NFL leaderboard UI (route supports ?contest=nfl,
  Leaderboard tab doesn't), submissions counter/share buttons, per-league
  contest config, money rules if the league votes it real.

## THE WEEKLY — recap pages (Sep 25 2026)

Sleeper-overlap purge, same day: Matchups HIDDEN from nav (league checks
Sleeper; page still live at /matchups, pick'em reuses its machinery; nav
strategy = only what Sleeper can't do). In its place: /recap (archive
index) + /recap/[week] ("THE WEEKLY" issue pages). Inspired by League
Legacy's newsletters, adapted: page-not-post because the WhatsApp chat is
too noisy for wall-of-text recaps — the chat gets a 2-line teaser + link
(share button on each issue). Deterministic sportswriting from data the
site already computes (Sleeper finals + pick'em leaderboard weeks):
storyline cards (Game of the Week = closest, Beatdown = biggest margin,
Top Gun / Stinker = high/low team score), pick'em money section (Oracle,
Blindfold, full card list), per-league results. Weeks 1-2 pull the
fantasy-era leaderboard, wk 3+ the NFL one. Issue for week N appears only
once N < currentWeek. Future (app era): AI punch-up pass over the copy,
commissioner edit box, special editions — the League Legacy playbook.
OWNER GOALS (stated Sep 25 2026): move to an app after the 2026 season;
ultimate goal is acquisition by Sleeper — positioning = the money-games +
relegation layer ON TOP of Sleeper, never duplicating it.

## Nav consolidation (July 2026)

Season nav is now: Standings, Matchups, Pick'em, History (+ Draft Lottery
first while its event window is live). Retired with redirect stubs, same
pattern as the old Scoreboard: /odds -> / (Monte Carlo probabilities now
render as Ploff and Drop/Promo columns inside the standings tables via
lib/leagueOdds.ts, computed in the background only for a live in-season
year with games played and games remaining), /recap -> /matchups
(storyline strip already covered it), /promotion-relegation -> /history
(per-season promoted/relegated groups already in each season card).
