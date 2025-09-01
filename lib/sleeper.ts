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
};
export default SleeperAPI;
