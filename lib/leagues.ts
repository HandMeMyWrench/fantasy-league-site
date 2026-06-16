// lib/leagues.ts
// Shared league configuration + standings helpers.
// This is the single source of truth for league IDs and the relegation rule.
// When a new season starts, add it here and every page that imports this updates.

export type SeasonYear = "2026" | "2025" | "2024";

export const LEAGUES: Record<SeasonYear, { upper: string; lower: string | null }> = {
  // 2026: fill these in once the new Sleeper leagues are created.
  "2026": {
    upper: "",
    lower: "",
  },
  "2025": {
    upper: "1243754325482684416",
    lower: "1255233614015119360",
  },
  "2024": {
    upper: "1048479451052494848",
    lower: null,
  },
};

// How many teams stay up (top of the upper league) and, equivalently, how many
// get promoted from the top of the lower league. The bottom this-many of the
// upper league are relegated. For a 12-team league this is 6.
export const RELEGATION_SPOTS = 6;

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
