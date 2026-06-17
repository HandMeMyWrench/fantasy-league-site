// lib/leagues.ts
// Shared league configuration + standings helpers.
// This is the single source of truth for league IDs and the relegation rule.
// When a new season starts, add it here and every page that imports this updates.

export type SeasonYear = "2026" | "2025" | "2024";

// `movement` = how many teams move between tiers based on THAT season's final
// standings: the top `movement` of the lower league are promoted, and the
// bottom `movement` of the upper league are relegated.
//
// 2025 was the inaugural season, so it used a one-time 6-up / 6-down reshuffle
// to seed the two tiers. From 2026 onward the permanent rule is 3-up / 3-down.
export type LeagueSeason = {
  upper: string;
  lower: string | null;
  movement: number;
  // `started` = the season has drafted and is playing real games. While false,
  // "current season" views fall back to the last started season and the
  // standings page shows the provisional (derived) preview instead of empty
  // pre-draft rosters. Flip 2026 to `true` once the draft is done.
  started: boolean;
};

export const LEAGUES: Record<SeasonYear, LeagueSeason> = {
  "2026": {
    upper: "1372742288362446848",
    lower: "1354548298421137408",
    movement: 3,
    started: false, // pre-draft — flip to true when the 2026 season kicks off
  },
  "2025": {
    upper: "1243754325482684416",
    lower: "1255233614015119360",
    movement: 6, // inaugural-season reshuffle (one-time)
    started: true,
  },
  "2024": {
    upper: "1048479451052494848",
    lower: null,
    movement: 0, // single league, no promotion/relegation
    started: true,
  },
};

// Has the season drafted and started playing real games?
export function hasStarted(year: SeasonYear): boolean {
  return !!LEAGUES[year]?.started;
}

// The standing rule for any new season going forward.
export const DEFAULT_MOVEMENT = 3;

// How many teams move between tiers based on a given season's finish.
export function movementSpots(year: SeasonYear): number {
  return LEAGUES[year]?.movement ?? DEFAULT_MOVEMENT;
}

// The newest season that has actually started (drafted + playing). "Current
// season" views use this so they roll forward automatically — when 2026 is
// marked started, Matchups/Recap/Spotlight all move to 2026 with no code change.
// Falls back to the newest season that at least has IDs.
export function latestActiveSeason(): SeasonYear {
  const years = (Object.keys(LEAGUES) as SeasonYear[]).sort((a, b) => Number(b) - Number(a));
  const started = years.filter((y) => LEAGUES[y].upper && LEAGUES[y].started);
  if (started[0]) return started[0];
  const withIds = years.filter((y) => LEAGUES[y].upper);
  return withIds[0] ?? "2025";
}

export type RosterLite = {
  owner_id: string;
  metadata?: Record<string, string>;
  settings?: {
    wins?: number;
    losses?: number;
    ties?: number;
    fpts?: number;
    fpts_decimal?: number;
    fpts_against?: number;
    fpts_against_decimal?: number;
  };
};

// Sleeper returns points-for as an integer part (fpts) plus a hundredths part
// (fpts_decimal), e.g. 1403 + 24 => 1403.24. NOTE: the field is `fpts`, not
// `points_for` — reading `points_for` returns undefined.
export function pointsFor(r: RosterLite): number {
  return (r.settings?.fpts ?? 0) + (r.settings?.fpts_decimal ?? 0) / 100;
}

export function pointsAgainst(r: RosterLite): number {
  return (
    (r.settings?.fpts_against ?? 0) +
    (r.settings?.fpts_against_decimal ?? 0) / 100
  );
}

// Proper standings order: most wins first, then points-for as the tiebreaker.
export function sortStandings<T extends RosterLite>(rosters: T[]): T[] {
  return [...rosters].sort(
    (a, b) =>
      (b.settings?.wins ?? 0) - (a.settings?.wins ?? 0) ||
      pointsFor(b) - pointsFor(a)
  );
}
