// lib/sleeper.ts

// ================== Public REST helpers ==================

export async function getLeagueData(leagueId: string) {
  const res = await fetch(`https://api.sleeper.app/v1/league/${leagueId}`, {
    cache: "no-store",
  });
  if (!res.ok) throw new Error("Failed to fetch league");
  return res.json();
}

export async function getStandings(leagueId: string) {
  const res = await fetch(
    `https://api.sleeper.app/v1/league/${leagueId}/rosters`,
    { cache: "no-store" }
  );
  if (!res.ok) throw new Error("Failed to fetch rosters");
  return res.json();
}

export async function getLeagueUsers(leagueId: string) {
  const res = await fetch(
    `https://api.sleeper.app/v1/league/${leagueId}/users`,
    { cache: "no-store" }
  );
  if (!res.ok) throw new Error("Failed to fetch users");
  return res.json();
}

export async function getMatchups(leagueId: string, week: number) {
  const res = await fetch(
    `https://api.sleeper.app/v1/league/${leagueId}/matchups/${week}`,
    { cache: "no-store" }
  );
  if (!res.ok) throw new Error("Failed to fetch matchups");
  return res.json();
}

export async function getLeagueMetadata(leagueId: string) {
  const res = await fetch(`https://api.sleeper.app/v1/league/${leagueId}`, {
    cache: "no-store",
  });
  if (!res.ok) throw new Error("Failed to fetch league metadata");
  return res.json();
}

// NFL season state — the reliable source for the current/active week.
// Returns { season, season_type, week, display_week, leg, ... }.
export type NflState = {
  season: string;
  season_type: string; // "pre" | "regular" | "post" | "off"
  week: number;
  display_week?: number;
  leg?: number;
};

export async function getNflState(): Promise<NflState> {
  const res = await fetch("https://api.sleeper.app/v1/state/nfl", {
    cache: "no-store",
  });
  if (!res.ok) throw new Error("Failed to fetch NFL state");
  return res.json();
}

// ================== Types ==================

type Scoring = "half_ppr" | "ppr" | "std";

type SleeperProjection = {
  player_id?: string;
  playerId?: string;
  stats?: Record<string, unknown>;
  [key: string]: unknown;
};

type SleeperGqlNode = {
  player_id: string;
  stats?: Record<string, unknown>;
  [key: string]: unknown;
};

type SleeperGqlResponse = {
  data?: Record<string, SleeperGqlNode[]>;
};

// ================== Public Projections ==================

export async function getProjections(
  season: number,
  week: number,
  scoring: Scoring = "half_ppr"
): Promise<Map<string, number>> {
  const url = `https://api.sleeper.app/v1/projections/nfl/${season}/${week}?season_type=regular`;
  const res = await fetch(url, { cache: "no-store" });
  if (!res.ok) throw new Error("Failed to fetch projections");

  const raw = await res.json();

  const data: Record<string, SleeperProjection> = Array.isArray(raw)
    ? Object.fromEntries(
        raw
          .map((r: SleeperProjection) => [String(r.player_id ?? r.playerId ?? ""), r])
          .filter(([k]) => k)
      )
    : {};

  const statKey =
    scoring === "ppr" ? "pts_ppr" : scoring === "std" ? "pts_std" : "pts_half_ppr";

  const map = new Map<string, number>();
  for (const [key, row] of Object.entries(data)) {
    const stats = row?.stats ?? {};
    const rawPts =
      stats[statKey] ??
      (stats as Record<string, unknown>).fantasy_points ??
      (stats as Record<string, unknown>).proj_fp ??
      0;
    const pts = Number(rawPts);
    map.set(String(key), Number.isFinite(pts) ? pts : 0);
  }
  return map;
}

// ================== Private GraphQL helpers ==================

import { SLEEPER_GQL_URL, buildProjectionsPayload } from "./sleeper_gql_query";

export async function postSleeperGql(payload: unknown): Promise<SleeperGqlResponse> {
  const res = await fetch(
    `/api/sleeper-gql?url=${encodeURIComponent(SLEEPER_GQL_URL)}`,
    {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(payload),
      cache: "no-store",
    }
  );
  if (!res.ok) {
    const txt = await res.text();
    throw new Error(`Sleeper GQL ${res.status}: ${txt}`);
  }
  return res.json();
}

export function parseProjectionsFromGql(json: SleeperGqlResponse): Map<string, number> {
  const out = new Map<string, number>();
  if (!json?.data) return out;

  const KEYS = [
    "pts_half_ppr",
    "pts_ppr",
    "pts_std",
    "fantasy_points",
    "fp",
    "points",
    "proj_fp",
  ];

  const take = (pid: string, node: SleeperGqlNode) => {
    if (!pid || !node) return;
    const stats = node.stats ?? node;
    for (const k of KEYS) {
      const v = Number(stats?.[k as keyof typeof stats]);
      if (Number.isFinite(v)) {
        out.set(String(pid), v);
        return;
      }
    }
  };

  const entries = Object.entries(json.data) as Array<[string, SleeperGqlNode[]]>;
  const projFirst = entries.sort(([a], [b]) =>
    a.endsWith("__proj") && !b.endsWith("__proj") ? -1 : 0
  );

  for (const [, arr] of projFirst) {
    if (!Array.isArray(arr)) continue;
    for (const row of arr) take(row?.player_id, row);
  }
  return out;
}

export async function getLeagueExactProjections(
  _leagueId: string,
  season: number,
  week: number,
  playerIds: string[]
): Promise<Map<string, number>> {
  if (!playerIds?.length) return new Map();

  const payload = buildProjectionsPayload(season, week, playerIds);
  const raw = await postSleeperGql(payload);
  const map = parseProjectionsFromGql(raw);

  if (map.size === 0) {
    return getProjections(season, week, "half_ppr");
  }
  return map;
}

export async function getPrivateOrPublicProjections(
  season: number,
  week: number,
  playerIds?: string[]
): Promise<Map<string, number>> {
  try {
    if (playerIds?.length) {
      const raw = await postSleeperGql(
        buildProjectionsPayload(season, week, playerIds)
      );
      const m = parseProjectionsFromGql(raw);
      if (m.size) return m;
    }
  } catch {
    // fallback below
  }
  return getProjections(season, week, "half_ppr");
}

// ================== League-accurate projections ==================
// Sleeper's website computes projected (and actual) fantasy points by applying
// the LEAGUE's scoring settings to each player's raw stat line. The generic
// `pts_half_ppr` value ignores league-specific bonuses (yardage bonuses, long-TD
// bonuses, custom kicker scoring, etc.), so it never matches the Sleeper app.
// These helpers fetch the raw projected stats and apply the league scoring.

export type ScoringSettings = Record<string, number>;

export async function getLeagueScoring(leagueId: string): Promise<ScoringSettings> {
  const league = await getLeagueData(leagueId);
  return (league?.scoring_settings ?? {}) as ScoringSettings;
}

/** Apply a league's scoring settings to a raw stat line → fantasy points. */
export function scoreStats(
  stats: Record<string, unknown> | undefined,
  scoring: ScoringSettings
): number {
  if (!stats) return 0;
  let pts = 0;
  for (const key in stats) {
    const weight = scoring[key];
    if (weight) {
      const v = Number(stats[key]);
      if (Number.isFinite(v)) pts += v * weight;
    }
  }
  return pts;
}

/**
 * Fetch RAW projected stat lines per player via Sleeper's GraphQL endpoint
 * (the public REST /v1/projections endpoint now returns empty objects).
 * Returns a map of player_id -> stats so league scoring can be applied.
 */
export async function getProjectedStats(
  season: number,
  week: number,
  playerIds: string[]
): Promise<Map<string, Record<string, unknown>>> {
  const out = new Map<string, Record<string, unknown>>();
  if (!playerIds?.length) return out;

  const raw = await postSleeperGql(buildProjectionsPayload(season, week, playerIds));
  if (!raw?.data) return out;

  // Prefer the "proj" alias over the "stat" alias when both are present.
  const entries = (Object.entries(raw.data) as Array<[string, SleeperGqlNode[]]>).sort(
    ([a], [b]) => (a.endsWith("__proj") ? -1 : b.endsWith("__proj") ? 1 : 0)
  );

  for (const [, arr] of entries) {
    if (!Array.isArray(arr)) continue;
    for (const node of arr) {
      const pid = String(node?.player_id ?? "");
      if (pid && node?.stats && !out.has(pid)) out.set(pid, node.stats);
    }
  }
  return out;
}

// Optional default export so either import style works:
const SleeperAPI = {
  getLeagueData,
  getStandings,
  getLeagueUsers,
  getMatchups,
  getLeagueMetadata,
  getProjections,
  postSleeperGql,
  parseProjectionsFromGql,
  getLeagueExactProjections,
  getPrivateOrPublicProjections,
  getLeagueScoring,
  scoreStats,
  getProjectedStats,
};
export default SleeperAPI;
