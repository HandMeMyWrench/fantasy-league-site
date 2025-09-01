"use client";

import React, { useEffect, useMemo, useState } from "react";
import {
  getMatchups,
  getStandings,
  getLeagueUsers,
  getLeagueMetadata,
  getPrivateOrPublicProjections, // GQL+REST fallback
} from "@/lib/sleeper";

/* ----------------------------- types & config ----------------------------- */

type SeasonYear = "2025" | "2024";

const LEAGUES: Record<SeasonYear, { upper: string; lower: string | null }> = {
  "2025": {
    upper: "1243754325482684416",
    lower: "1255233614015119360",
  },
  "2024": {
    upper: "1048479451052494848",
    lower: null,
  },
};

type Roster = {
  metadata: Record<string, string>;
  owner_id: string;
  roster_id: number;
  settings: { wins: number };
};

type User = {
  user_id: string;
  display_name: string;
  avatar: string;
};

type Matchup = {
  matchup_id: number;
  roster_id: number;
  points: number;
  custom_points?: number;
  starters?: string[]; // "0" means empty slot
};

type PlayerCatalogRow = {
  full_name?: string;
  first_name?: string;
  last_name?: string;
  position?: string;
  team?: string;
};

/* ---------------------- win% model (mean/variance) ----------------------- */

// Positional coefficients of variation (tunable heuristics)
const POS_CV: Record<string, number> = {
  QB: 0.32,
  RB: 0.50,
  WR: 0.50,
  TE: 0.55,
  K: 0.60,
  DEF: 0.60, // Sleeper uses "DEF" for DST
};
// Minimum standard deviation by position (prevents tiny σ for small projections)
const POS_SIGMA_FLOOR: Record<string, number> = {
  QB: 1.6,
  RB: 1.3,
  WR: 1.3,
  TE: 1.4,
  K: 1.2,
  DEF: 1.8,
};

function erf(x: number) {
  // Abramowitz & Stegun 7.1.26 approximation
  const a1 = 0.254829592,
    a2 = -0.284496736,
    a3 = 1.421413741,
    a4 = -1.453152027,
    a5 = 1.061405429;
  const p = 0.3275911;
  const sign = x < 0 ? -1 : 1;
  const t = 1 / (1 + p * Math.abs(x));
  const y =
    1 -
    (((((a5 * t + a4) * t + a3) * t + a2) * t + a1) * t) *
      Math.exp(-x * x);
  return sign * y;
}

function normCdf(z: number) {
  return 0.5 * (1 + erf(z / Math.SQRT2));
}

/** Smooth, animated percent bar like Sleeper */
function WinBar({ side, percent }: { side: "left" | "right"; percent: number }) {
  const fillClass = side === "left" ? "bg-green-500" : "bg-red-500";
  const rounded = side === "left" ? "rounded-l-full" : "rounded-r-full";

  // keep within [2,98] so the bar never fully disappears/overlaps
  const clamped = Math.max(2, Math.min(98, percent));

  return (
    <div className="w-full">
      <div className="h-1.5 w-full bg-gray-700/70 rounded-full overflow-hidden">
        <div
          className={`${fillClass} h-full ${rounded} transition-all duration-700`}
          style={{ width: `${clamped}%` }}
        />
      </div>
      <div className={`mt-1 text-[11px] ${side === "left" ? "text-left" : "text-right"} text-gray-300`}>
        {Math.round(percent)}%
      </div>
    </div>
  );
}

/* --------------------------- component starts here ------------------------ */

const MatchupsPage = () => {
  const [year] = useState<SeasonYear>("2025");

  const [currentWeek, setCurrentWeek] = useState<number | null>(null);
  const [selectedWeek, setSelectedWeek] = useState<number | null>(null);
  const [season, setSeason] = useState<number | null>(null);

  const [usersMap, setUsersMap] = useState<Record<string, User>>({});
  const [upperLeague, setUpperLeague] = useState<Roster[]>([]);
  const [lowerLeague, setLowerLeague] = useState<Roster[] | null>(null);
  const [upperMatchups, setUpperMatchups] = useState<Matchup[]>([]);
  const [lowerMatchups, setLowerMatchups] = useState<Matchup[]>([]);

  // player catalog & projections
  const [playersMap, setPlayersMap] = useState<Record<string, PlayerCatalogRow>>(
    {}
  );
  const [projMap, setProjMap] = useState<Map<string, number>>(new Map());
  const [projLoading, setProjLoading] = useState(false);
  const [projError, setProjError] = useState<string | null>(null);

  // UI: show/hide starting lineups for a matchup
  const [openLineups, setOpenLineups] = useState<Record<number, boolean>>({});

  const maxWeek = 18;

  /* -------------------------- load base league data -------------------------- */
  useEffect(() => {
    const loadInitialData = async () => {
      const leagueId = LEAGUES[year].upper;

      const [rosters, users, metadata] = await Promise.all([
        getStandings(leagueId),
        getLeagueUsers(leagueId),
        getLeagueMetadata(leagueId),
      ]);

      const userMap = Object.fromEntries(users.map((u: User) => [u.user_id, u]));
      setUsersMap(userMap);
      setUpperLeague(rosters);

      const week =
        metadata?.season_type === "pre_draft" ? null : Number(metadata?.week || 1);
      setCurrentWeek(week);
      setSelectedWeek(week);
      setSeason(Number(metadata?.season) || null);
    };

    loadInitialData();
  }, [year]);

  /* ---------------------------- load weekly matchups --------------------------- */
  useEffect(() => {
    const loadMatchups = async () => {
      if (!selectedWeek) return;

      const leagueId = LEAGUES[year].upper;
      const matchups = await getMatchups(leagueId, selectedWeek);
      setUpperMatchups(matchups);

      if (LEAGUES[year].lower) {
        const lowerId = LEAGUES[year].lower!;
        const [lowerRosters, lowerUsers, lowerMu] = await Promise.all([
          getStandings(lowerId),
          getLeagueUsers(lowerId),
          getMatchups(lowerId, selectedWeek),
        ]);
        const lowerUserMap = Object.fromEntries(
          lowerUsers.map((u: User) => [u.user_id, u])
        );
        setUsersMap((prev) => ({ ...prev, ...lowerUserMap }));
        setLowerLeague(lowerRosters);
        setLowerMatchups(lowerMu);
      } else {
        setLowerLeague(null);
        setLowerMatchups([]);
      }
    };

    loadMatchups();

    const interval = setInterval(loadMatchups, 60_000);
    return () => clearInterval(interval);
  }, [selectedWeek, year]);

  /* ------------------------- load Sleeper player catalog ----------------------- */
  useEffect(() => {
    const loadPlayers = async () => {
      try {
        const res = await fetch("https://api.sleeper.app/v1/players/nfl", {
          cache: "force-cache",
        });
        const data = (await res.json()) as Record<string, PlayerCatalogRow>;
        setPlayersMap(data ?? {});
      } catch (e) {
        console.warn("[players] failed to load catalog", e);
      }
    };
    loadPlayers();
  }, []);

  /* ------------------------------ load projections ---------------------------- */
  const allStarterIds: string[] = useMemo(() => {
    const take = (arr: Matchup[]) =>
      arr.flatMap((m) => (m.starters ?? [])).filter((s) => s && s !== "0");
    const ids = [...new Set([...take(upperMatchups), ...take(lowerMatchups)])];
    return ids;
  }, [upperMatchups, lowerMatchups]);

  useEffect(() => {
    const loadProjections = async () => {
      if (!season || !selectedWeek) return;
      if (!allStarterIds.length) {
        setProjMap(new Map());
        return;
      }
      try {
        setProjLoading(true);
        setProjError(null);
        const map = await getPrivateOrPublicProjections(
          season,
          selectedWeek,
          allStarterIds
        );
        setProjMap(map);
      } catch (e: any) {
        console.warn("[proj] error", e);
        setProjError(e?.message ?? "Failed to load projections");
        setProjMap(new Map());
      } finally {
        setProjLoading(false);
      }
    };
    loadProjections();
  }, [season, selectedWeek, allStarterIds]);

  /* --------------------------------- helpers --------------------------------- */

  const nameFor = (pid?: string) => {
    if (!pid) return "—";
    const row = playersMap[pid];
    if (!row) return `#${pid}`;
    const name =
      row.full_name ||
      [row.first_name, row.last_name].filter(Boolean).join(" ").trim() ||
      `#${pid}`;
    const tag = [row.position, row.team].filter(Boolean).join(" · ");
    return tag ? `${name} (${tag})` : name;
  };

  const sumProjected = (starters?: string[]) => {
    if (!starters?.length) return 0;
    let total = 0;
    for (const pid of starters) {
      if (!pid || pid === "0") continue;
      total += projMap.get(pid) ?? 0;
    }
    return total;
  };

  // Compute team (mean, variance) from starters
  const teamDistribution = (starters?: string[]) => {
    let mu = 0;
    let variance = 0;
    if (!starters?.length) return { mu, variance };

    for (const pid of starters) {
      if (!pid || pid === "0") continue;
      const mean = projMap.get(pid) ?? 0;
      mu += mean;

      const pos = (playersMap[pid]?.position ?? "").toUpperCase();
      const cv = POS_CV[pos] ?? 0.5;
      const floor = POS_SIGMA_FLOOR[pos] ?? 1.3;
      const sigma = Math.max(cv * mean, floor);
      variance += sigma * sigma;
    }
    return { mu, variance };
  };

  // Live win% from Normal difference with live points added to the means
  const winProb = (actual1: number, s1?: string[], actual2?: number, s2?: string[]) => {
    const d1 = teamDistribution(s1);
    const d2 = teamDistribution(s2);
    const mu1 = actual1 + d1.mu;
    const mu2 = (actual2 ?? 0) + d2.mu;
    const denom = Math.sqrt(d1.variance + d2.variance);
    if (!isFinite(denom) || denom === 0) {
      // fallback to naive share
      const p1 = mu1;
      const p2 = mu2;
      const tot = p1 + p2 || 1;
      return [(p1 / tot) * 100, (p2 / tot) * 100] as const;
    }
    const z = (mu1 - mu2) / denom;
    const p1 = normCdf(z) * 100;
    return [p1, 100 - p1] as const;
  };

  const renderStartersList = (starters?: string[]) => {
    const clean = (starters ?? []).filter((s) => s && s !== "0");
    if (clean.length === 0) {
      return <div className="text-sm text-gray-400">No starters set.</div>;
    }
    return (
      <ul className="space-y-1">
        {clean.map((pid) => (
          <li key={pid} className="text-sm text-gray-200">
            {nameFor(pid)}
            {projMap.size > 0 && (
              <span className="text-gray-400">
                {" "}
                — {(projMap.get(pid) ?? 0).toFixed(1)}
              </span>
            )}
          </li>
        ))}
      </ul>
    );
  };

  const renderMatchups = (matchups: Matchup[], league: Roster[]) => {
    const pairs = Object.values(
      matchups.reduce((acc, m) => {
        acc[m.matchup_id] = acc[m.matchup_id] || [];
        acc[m.matchup_id].push(m);
        return acc;
      }, {} as Record<number, Matchup[]>)
    );

    return pairs.map((pair) => {
      if (pair.length !== 2) return null;
      const [team1, team2] = pair;
      const roster1 = league.find((r) => r.roster_id === team1.roster_id);
      const roster2 = league.find((r) => r.roster_id === team2.roster_id);
      if (!roster1 || !roster2) return null;

      const user1 = usersMap[roster1.owner_id];
      const user2 = usersMap[roster2.owner_id];

      const actual1 = Number(team1.points ?? 0);
      const actual2 = Number(team2.points ?? 0);

      const proj1 = sumProjected(team1.starters);
      const proj2 = sumProjected(team2.starters);

      // Live win probability using actual + projected means
      const [prob1, prob2] =
        projMap.size > 0
          ? winProb(actual1, team1.starters, actual2, team2.starters)
          : (() => {
              const tot = actual1 + actual2 || 1;
              return [(actual1 / tot) * 100, (actual2 / tot) * 100] as const;
            })();

      const isOpen = !!openLineups[pair[0].matchup_id];

      // if you want a subtle tint for the side currently favored:
      const winnerHighlight =
        prob1 > prob2 ? "" : prob2 > prob1 ? "" : "";

      return (
        <div
          key={pair[0].matchup_id}
          className={`bg-gray-800 border border-purple-600 rounded p-4 shadow-sm ${winnerHighlight}`}
        >
          <div className="flex justify-between items-center">
            <div className="flex items-center gap-2">
              <img
                src={
                  user1?.avatar
                    ? `https://sleepercdn.com/avatars/${user1.avatar}`
                    : "/file.svg"
                }
                alt={user1?.display_name}
                className="w-6 h-6 rounded-full"
              />
              <span className="font-medium text-white">
                {roster1.metadata?.team_name || user1?.display_name || "Team 1"}
              </span>
            </div>

            <div className="text-center w-[420px] max-w-full">
              <div className="text-sm font-bold text-purple-300">
                {actual1.toFixed(1)} - {actual2.toFixed(1)}
              </div>
              <div className="text-xs text-gray-400">
                {projError ? (
                  <>Proj: n/a (error)</>
                ) : projLoading ? (
                  <>Proj: …</>
                ) : (
                  <>
                    Proj: {proj1.toFixed(1)} - {proj2.toFixed(1)}
                    <br />
                  </>
                )}
                Win %: {Math.round(prob1)}% - {Math.round(prob2)}%
              </div>

              {/* dynamic bars */}
              <div className="mt-3 grid grid-cols-2 gap-4">
                <WinBar side="left" percent={prob1} />
                <WinBar side="right" percent={prob2} />
              </div>

              <button
                onClick={() =>
                  setOpenLineups((prev) => ({
                    ...prev,
                    [pair[0].matchup_id]: !prev[pair[0].matchup_id],
                  }))
                }
                className="mt-3 text-xs px-3 py-1 rounded bg-purple-700 hover:bg-purple-600 text-white"
              >
                {isOpen ? "Hide lineups" : "Show lineups"}
              </button>
            </div>

            <div className="flex items-center gap-2">
              <img
                src={
                  user2?.avatar
                    ? `https://sleepercdn.com/avatars/${user2.avatar}`
                    : "/file.svg"
                }
                alt={user2?.display_name}
                className="w-6 h-6 rounded-full"
              />
              <span className="font-medium text-white">
                {roster2.metadata?.team_name || user2?.display_name || "Team 2"}
              </span>
            </div>
          </div>

          {isOpen && (
            <div className="mt-4 grid grid-cols-1 md:grid-cols-2 gap-4">
              <div>
                <div className="text-sm font-semibold text-purple-300 mb-1">
                  {roster1.metadata?.team_name || user1?.display_name || "Team 1"} Starters
                </div>
                <div className="rounded border border-purple-700/40 bg-gray-900/40 p-3">
                  {renderStartersList(team1.starters)}
                </div>
              </div>

              <div>
                <div className="text-sm font-semibold text-purple-300 mb-1">
                  {roster2.metadata?.team_name || user2?.display_name || "Team 2"} Starters
                </div>
                <div className="rounded border border-purple-700/40 bg-gray-900/40 p-3">
                  {renderStartersList(team2.starters)}
                </div>
              </div>
            </div>
          )}
        </div>
      );
    });
  };

  /* --------------------------------- render --------------------------------- */

  return (
    <div className="p-6">
      <h1 className="text-3xl font-bold text-purple-300 mb-6 text-center">
        Weekly Matchups
      </h1>

      <div className="flex flex-wrap justify-center items-center gap-4 mb-8">
        <button
          onClick={() => setSelectedWeek((prev) => Math.max(1, (prev ?? 1) - 1))}
          className="bg-purple-700 hover:bg-purple-600 px-4 py-2 rounded text-white font-semibold"
          disabled={!selectedWeek || selectedWeek <= 1}
        >
          ← Prev
        </button>

        <div className="text-lg font-bold text-purple-300">
          Week {selectedWeek ?? "-"}
        </div>

        <button
          onClick={() => setSelectedWeek((prev) => Math.min(maxWeek, (prev ?? 1) + 1))}
          className="bg-purple-700 hover:bg-purple-600 px-4 py-2 rounded text-white font-semibold"
          disabled={!selectedWeek || selectedWeek >= maxWeek}
        >
          Next →
        </button>

        {selectedWeek !== currentWeek && currentWeek && (
          <button
            onClick={() => setSelectedWeek(currentWeek)}
            className="bg-gray-700 hover:bg-gray-600 px-4 py-2 rounded text-white font-medium"
          >
            Go to Current Week
          </button>
        )}
      </div>

      <div className="space-y-12">
        <div>
          <h2 className="text-2xl font-semibold text-purple-300 mb-4">
            Upper League
          </h2>
          {upperMatchups.length > 0 && upperLeague.length > 0 ? (
            <div className="space-y-3">
              {renderMatchups(upperMatchups, upperLeague)}
            </div>
          ) : (
            <p className="text-gray-400 text-center">Waiting for matchups...</p>
          )}
        </div>

        {LEAGUES[year].lower && lowerLeague && (
          <div>
            <h2 className="text-2xl font-semibold text-green-300 mb-4">
              Lower League
            </h2>
            {lowerMatchups.length > 0 && lowerLeague.length > 0 ? (
              <div className="space-y-3">
                {renderMatchups(lowerMatchups, lowerLeague)}
              </div>
            ) : (
              <p className="text-gray-400 text-center">Waiting for matchups...</p>
            )}
          </div>
        )}
      </div>
    </div>
  );
};

export default MatchupsPage;
