# 2026 Season Setup — Promotion / Relegation

Based on the **final 2025 standings** (ranked by wins, then points-for). In both
leagues there was a clean win-gap at the line (15 wins → 14 wins), so the split
is unambiguous.

> **Note on the rule:** 2025 was the inaugural season, so it used a one-time
> **6-up / 6-down** reshuffle to seed the two tiers (below). From the **2026
> season onward**, the permanent rule is **3-up / 3-down** — the top 3 of the
> lower league are promoted and the bottom 3 of the upper league are relegated.

## Who goes where in 2026

### ⬆️ 2026 UPPER LEAGUE (12 teams)

**Stayed up — top 6 of the 2025 Upper League**

| 2025 finish | Manager | Team |
|---|---|---|
| 1 | schaefer126 | Fragile FaggotTurds |
| 2 | JoshScall | Dyansty Mind |
| 3 | ECoughs | Made O' Glass Boys |
| 4 | DannyJ627 | From 1st to worst?? |
| 5 | Saywhen | Say When |
| 6 | AJ1111 | Congrats leigh! |

**▲ Promoted — top 6 of the 2025 Lower League**

| 2025 finish | Manager | Team |
|---|---|---|
| 1 | ianv000 | Dan Snyder Lives On |
| 2 | BangBangMetz | — |
| 3 | JoshKnepper | Dak Tuah |
| 4 | MandingoSamsel | Dr.CocktailSauce |
| 5 | Drock1080 | Jaxon McConkey |
| 6 | LucasMyerson | — |

### ⬇️ 2026 LOWER LEAGUE (12 teams)

**▼ Relegated — bottom 6 of the 2025 Upper League**

| 2025 finish | Manager | Team |
|---|---|---|
| 7 | Bearballs85 | Bear Ballers |
| 8 | AdamSchefter | GOD2FRAUD |
| 9 | PUCKETL (you) | Rude Dads Club |
| 10 | SteinerVision | The Indian Jussie |
| 11 | papashu | 1/2-5 Guy |
| 12 | poonpunishers | Poonpunishsrs |

**Stayed down — bottom 6 of the 2025 Lower League**

| 2025 finish | Manager | Team |
|---|---|---|
| 7 | Bittybop69 | GapeyLeigh |
| 8 | timmytitle | — |
| 9 | 1pt21Gigawatts | — |
| 10 | PapaDrew17 | Fuck Trophies Everywhere |
| 11 | FuktheSteelers | — |
| 12 | JayGrill | Knepper has a micropenix |

## Steps to set it up on Sleeper

1. **Create the two 2026 leagues** (or continue your existing ones into the new
   season). You'll have a 2026 Upper League and a 2026 Lower League.
2. **Invite the 12 managers above into each league.** The 6 promoted managers go
   into Upper; the 6 relegated managers go into Lower.
3. **Grab the two new league IDs.** Each Sleeper league URL looks like
   `https://sleeper.com/leagues/<LEAGUE_ID>/...` — copy the `<LEAGUE_ID>` for
   both the new Upper and Lower leagues.
4. **Send me the two IDs.** I'll drop them into `lib/leagues.ts` (the `"2026"`
   entry is already stubbed and waiting) and the whole site — standings,
   matchups, power rankings, playoff race, and the new Promotion/Relegation
   page — will light up for 2026 automatically.
