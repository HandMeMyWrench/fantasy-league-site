"use client";

import React, { useEffect, useMemo, useState } from "react";
import {
  getMatchups,
  getStandings,
  getLeagueUsers,
  getLeagueMetadata,
  getNflState,
  getLeagueScoring,
  getProjectedStats,
  scoreStats,
  type ScoringSettings,
} from "@/lib/sleeper";
import { LEAGUES, type SeasonYear } from "@/lib/leagues";

/* ----------------------------- types ----------------------------- */

type Roster = {
  metadata: Record<string, string>;
  owner_id: string;
  roster_id: number;
  settings?: { wins?: number; losses?: number; ties?: number };
};

type User = {
  user_id: string;
  display_name: string;
  avatar: string | null;
};

type Matchup = {
  matchup_id: number;
  roster_id: number;
  points: number;
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

const POS_CV: Record<string, number> = { QB: 0.32, RB: 0.5, WR: 0.5, TE: 0.55, K: 0.6, DEF: 0.6 };
const POS_SIGMA_FLOOR: Record<string, number> = { QB: 1.6, RB: 1.3, WR: 1.3, TE: 1.4, K: 1.2, DEF: 1.8 };

function erf(x: number) {
  const a1 = 0.254829592, a2 = -0.284496736, a3 = 1.421413741, a4 = -1.453152027, a5 = 1.061405429;
  const p = 0.3275911;
  const sign = x < 0 ? -1 : 1;
  const t = 1 / (1 + p * Math.abs(x));
  const y = 1 - ((((a5 * t + a4) * t + a3) * t + a2) * t + a1) * t * Math.exp(-x * x);
  return sign * y;
}
function normCdf(z: number) {
  return 0.5 * (1 + erf(z / Math.SQRT2));
}

const YEAR: SeasonYear = "2025";
const MAX_WEEK = 18;

const MatchupsPage = () => {
  const [currentWeek, setCurrentWeek] = useState<number | null>(null);
  const [selectedWeek, setSelectedWeek] = useState<number | null>(null);
  const [season, setSeason] = useState<number | null>(null);

  const [usersMap, setUsersMap] = useState<Record<string, User>>({});
  const [upperLeague, setUpperLeague] = useState<Roster[]>([]);
  const [lowerLeague, setLowerLeague] = useState<Roster[]>([]);
  const [upperMatchups, setUpperMatchups] = useState<Matchup[]>([]);
  const [lowerMatchups, setLowerMatchups] = useState<Matchup[]>([]);

  const [playersMap, setPlayersMap] = useState<Record<string, PlayerCatalogRow>>({});
  const [scoringUpper, setScoringUpper] = useState<ScoringSettings>({});
  const [scoringLower, setScoringLower] = useState<ScoringSettings>({});
  const [statsMap, setStatsMap] = useState<Map<string, Record<string, unknown>>>(new Map());
  const [projLoading, setProjLoading] = useState(false);
  const [projError, setProjError] = useState<string | null>(null);

  const [openLineups, setOpenLineups] = useState<Record<number, boolean>>({});

  /* -------------------------- base league data -------------------------- */
  useEffect(() => {
    const load = async () => {
      const upperId = LEAGUES[YEAR].upper;
      const lowerId = LEAGUES[YEAR].lower;

      const [uRosters, uUsers, meta, nflState, uScoring] = await Promise.all([
        getStandings(upperId),
        getLeagueUsers(upperId),
        getLeagueMetadata(upperId),
        getNflState(),
        getLeagueScoring(upperId),
      ]);

      const map: Record<string, User> = {};
      for (const u of uUsers as User[]) map[u.user_id] = u;
      setUpperLeague(uRosters);
      setScoringUpper(uScoring);

      if (lowerId) {
        const [lRosters, lUsers, lScoring] = await Promise.all([
          getStandings(lowerId),
          getLeagueUsers(lowerId),
          getLeagueScoring(lowerId),
        ]);
        for (const u of lUsers as User[]) map[u.user_id] = u;
        setLowerLeague(lRosters);
        setScoringLower(lScoring);
      }
      setUsersMap(map);

      const isPreseason = nflState?.season_type === "pre" || nflState?.season_type === "off";
      const week = isPreseason ? 1 : Number(nflState?.display_week || nflState?.week || 1);
      setCurrentWeek(week);
      setSelectedWeek(week);
      setSeason(Number(meta?.season) || Number(nflState?.season) || null);
    };
    load();
  }, []);

  /* ---------------------------- weekly matchups --------------------------- */
  useEffect(() => {
    const load = async () => {
      if (!selectedWeek) return;
      const upperId = LEAGUES[YEAR].upper;
      const lowerId = LEAGUES[YEAR].lower;
      const u = await getMatchups(upperId, selectedWeek);
      setUpperMatchups(u);
      if (lowerId) setLowerMatchups(await getMatchups(lowerId, selectedWeek));
    };
    load();
    const interval = setInterval(load, 60_000);
    return () => clearInterval(interval);
  }, [selectedWeek]);

  /* ------------------------- player catalog ----------------------- */
  useEffect(() => {
    const load = async () => {
      try {
        const res = await fetch("https://api.sleeper.app/v1/players/nfl", { cache: "force-cache" });
        setPlayersMap(((await res.json()) as Record<string, PlayerCatalogRow>) ?? {});
      } catch (e) {
        console.warn("[players] failed to load catalog", e);
      }
    };
    load();
  }, []);

  /* ------------------------------ projections ---------------------------- */
  const allStarterIds = useMemo(() => {
    const take = (arr: Matchup[]) => arr.flatMap((m) => m.starters ?? []).filter((s) => s && s !== "0");
    return [...new Set([...take(upperMatchups), ...take(lowerMatchups)])];
  }, [upperMatchups, lowerMatchups]);

  useEffect(() => {
    const load = async () => {
      if (!season || !selectedWeek || !allStarterIds.length) {
        setStatsMap(new Map());
        return;
      }
      try {
        setProjLoading(true);
        setProjError(null);
        setStatsMap(await getProjectedStats(season, selectedWeek, allStarterIds));
      } catch (e) {
        setProjError(e instanceof Error ? e.message : "Failed to load projections");
        setStatsMap(new Map());
      } finally {
        setProjLoading(false);
      }
    };
    load();
  }, [season, selectedWeek, allStarterIds]);

  // Per-league projection maps: same raw stats, each league's own scoring.
  const projUpper = useMemo(() => {
    const m = new Map<string, number>();
    statsMap.forEach((stats, pid) => m.set(pid, scoreStats(stats, scoringUpper)));
    return m;
  }, [statsMap, scoringUpper]);
  const projLower = useMemo(() => {
    const m = new Map<string, number>();
    statsMap.forEach((stats, pid) => m.set(pid, scoreStats(stats, scoringLower)));
    return m;
  }, [statsMap, scoringLower]);

  /* --------------------------------- helpers --------------------------------- */
  const teamName = (r?: Roster, u?: User) => r?.metadata?.team_name || u?.display_name || "Team";
  const avatar = (u?: User) =>
    u?.avatar ? `https://sleepercdn.com/avatars/${u.avatar}` : "/default-avatar.png";

  const playerLabel = (pid?: string) => {
    if (!pid) return "—";
    const row = playersMap[pid];
    if (!row) return `#${pid}`;
    return row.full_name || [row.first_name, row.last_name].filter(Boolean).join(" ") || `#${pid}`;
  };
  const playerMeta = (pid?: string) => {
    const row = pid ? playersMap[pid] : undefined;
    return [row?.position, row?.team].filter(Boolean).join(" · ");
  };

  const teamDistribution = (proj: Map<string, number>, starters?: string[]) => {
    let mu = 0, variance = 0;
    for (const pid of starters ?? []) {
      if (!pid || pid === "0") continue;
      const mean = proj.get(pid) ?? 0;
      mu += mean;
      const pos = (playersMap[pid]?.position ?? "").toUpperCase();
      const sigma = Math.max((POS_CV[pos] ?? 0.5) * mean, POS_SIGMA_FLOOR[pos] ?? 1.3);
      variance += sigma * sigma;
    }
    return { mu, variance };
  };

  const sumProj = (proj: Map<string, number>, starters?: string[]) =>
    (starters ?? []).reduce((t, pid) => (pid && pid !== "0" ? t + (proj.get(pid) ?? 0) : t), 0);

  const winProb = (proj: Map<string, number>, a1: number, s1?: string[], a2 = 0, s2?: string[]) => {
    const d1 = teamDistribution(proj, s1);
    const d2 = teamDistribution(proj, s2);
    const mu1 = a1 + d1.mu, mu2 = a2 + d2.mu;
    const denom = Math.sqrt(d1.variance + d2.variance);
    if (!isFinite(denom) || denom === 0) {
      const tot = mu1 + mu2 || 1;
      return [(mu1 / tot) * 100, (mu2 / tot) * 100] as const;
    }
    const p1 = normCdf((mu1 - mu2) / denom) * 100;
    return [p1, 100 - p1] as const;
  };

  /* --------------------------------- render --------------------------------- */

  const Lineup = ({ proj, starters }: { proj: Map<string, number>; starters?: string[] }) => {
    const clean = (starters ?? []).filter((s) => s && s !== "0");
    if (!clean.length) return <div className="text-xs text-gray-500">No starters set.</div>;
    return (
      <ul className="space-y-1">
        {clean.map((pid) => (
          <li key={pid} className="flex items-baseline justify-between gap-2 text-xs">
            <span className="truncate text-gray-200">
              {playerLabel(pid)}
              <span className="text-gray-500"> {playerMeta(pid)}</span>
            </span>
            <span className="shrink-0 tabular-nums text-gray-400">
              {(proj.get(pid) ?? 0).toFixed(1)}
            </span>
          </li>
        ))}
      </ul>
    );
  };

  const renderMatchups = (matchups: Matchup[], league: Roster[], proj: Map<string, number>) => {
    const pairs = Object.values(
      matchups.reduce((acc, m) => {
        (acc[m.matchup_id] = acc[m.matchup_id] || []).push(m);
        return acc;
      }, {} as Record<number, Matchup[]>)
    );

    return pairs.map((pair) => {
      if (pair.length !== 2) return null;
      const [t1, t2] = pair;
      const r1 = league.find((r) => r.roster_id === t1.roster_id);
      const r2 = league.find((r) => r.roster_id === t2.roster_id);
      if (!r1 || !r2) return null;
      const u1 = usersMap[r1.owner_id];
      const u2 = usersMap[r2.owner_id];

      const a1 = Number(t1.points ?? 0);
      const a2 = Number(t2.points ?? 0);
      const p1 = sumProj(proj, t1.starters);
      const p2 = sumProj(proj, t2.starters);
      const [w1, w2] = proj.size
        ? winProb(proj, a1, t1.starters, a2, t2.starters)
        : (() => {
            const tot = a1 + a2 || 1;
            return [(a1 / tot) * 100, (a2 / tot) * 100] as const;
          })();

      const lead1 = a1 === a2 ? w1 >= w2 : a1 > a2;
      const id = pair[0].matchup_id;
      const isOpen = !!openLineups[id];

      return (
        <div key={id} className="rounded-lg border border-gray-800 bg-gray-900/70 p-3">
          {/* teams + score */}
          <div className="flex items-center gap-2">
            <div className="flex min-w-0 flex-1 items-center gap-2">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={avatar(u1)} alt="" className="h-7 w-7 rounded-full" />
              <div className="min-w-0">
                <div className={`truncate text-sm font-semibold ${lead1 ? "text-white" : "text-gray-400"}`}>
                  {teamName(r1, u1)}
                </div>
                <div className="text-[11px] text-gray-500">proj {p1.toFixed(1)}</div>
              </div>
            </div>

            <div className="px-1 text-center">
              <div className="text-base font-bold tabular-nums">
                <span className={lead1 ? "text-purple-300" : "text-gray-400"}>{a1.toFixed(1)}</span>
                <span className="text-gray-600"> – </span>
                <span className={!lead1 ? "text-purple-300" : "text-gray-400"}>{a2.toFixed(1)}</span>
              </div>
            </div>

            <div className="flex min-w-0 flex-1 items-center justify-end gap-2 text-right">
              <div className="min-w-0">
                <div className={`truncate text-sm font-semibold ${!lead1 ? "text-white" : "text-gray-400"}`}>
                  {teamName(r2, u2)}
                </div>
                <div className="text-[11px] text-gray-500">proj {p2.toFixed(1)}</div>
              </div>
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={avatar(u2)} alt="" className="h-7 w-7 rounded-full" />
            </div>
          </div>

          {/* slim split win bar */}
          <div className="mt-2.5 flex items-center gap-2">
            <span className="w-8 text-[11px] tabular-nums text-emerald-400">{Math.round(w1)}%</span>
            <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-rose-500/40">
              <div className="h-full rounded-full bg-emerald-500 transition-all duration-700" style={{ width: `${w1}%` }} />
            </div>
            <span className="w-8 text-right text-[11px] tabular-nums text-rose-400">{Math.round(w2)}%</span>
          </div>

          {/* lineups toggle */}
          <button
            onClick={() => setOpenLineups((prev) => ({ ...prev, [id]: !prev[id] }))}
            className="mx-auto mt-2 flex items-center gap-1 text-[11px] text-gray-500 hover:text-purple-300"
          >
            {projLoading ? "loading projections…" : projError ? "projections unavailable" : isOpen ? "Hide lineups ▲" : "Lineups ▼"}
          </button>

          {isOpen && (
            <div className="mt-2 grid grid-cols-2 gap-3 border-t border-gray-800 pt-2">
              <Lineup proj={proj} starters={t1.starters} />
              <Lineup proj={proj} starters={t2.starters} />
            </div>
          )}
        </div>
      );
    });
  };

  const weekNav = (
    <div className="mb-6 flex items-center justify-center gap-2">
      <button
        onClick={() => setSelectedWeek((w) => Math.max(1, (w ?? 1) - 1))}
        disabled={!selectedWeek || selectedWeek <= 1}
        className="rounded bg-gray-800 px-3 py-1 text-sm font-medium text-white hover:bg-gray-700 disabled:opacity-40"
      >
        ←
      </button>
      <span className="min-w-[80px] text-center text-sm font-semibold text-purple-300">
        Week {selectedWeek ?? "–"}
      </span>
      <button
        onClick={() => setSelectedWeek((w) => Math.min(MAX_WEEK, (w ?? 1) + 1))}
        disabled={!selectedWeek || selectedWeek >= MAX_WEEK}
        className="rounded bg-gray-800 px-3 py-1 text-sm font-medium text-white hover:bg-gray-700 disabled:opacity-40"
      >
        →
      </button>
      {selectedWeek !== currentWeek && currentWeek && (
        <button
          onClick={() => setSelectedWeek(currentWeek)}
          className="ml-1 rounded bg-purple-800 px-2 py-1 text-xs text-white hover:bg-purple-700"
        >
          Current
        </button>
      )}
    </div>
  );

  return (
    <main className="min-h-screen bg-black p-6 font-sans text-white">
      <div className="mx-auto max-w-6xl">
        <h1 className="mb-4 text-center text-2xl font-bold text-purple-300">Weekly Matchups</h1>
        {weekNav}

        <section className="mb-8">
          <h2 className="mb-3 text-sm font-bold uppercase tracking-wider text-purple-400">Upper League</h2>
          {upperMatchups.length && upperLeague.length ? (
            <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
              {renderMatchups(upperMatchups, upperLeague, projUpper)}
            </div>
          ) : (
            <p className="text-center text-sm text-gray-500">Waiting for matchups…</p>
          )}
        </section>

        {lowerLeague.length > 0 && (
          <section>
            <h2 className="mb-3 text-sm font-bold uppercase tracking-wider text-emerald-400">Lower League</h2>
            {lowerMatchups.length && lowerLeague.length ? (
              <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
                {renderMatchups(lowerMatchups, lowerLeague, projLower)}
              </div>
            ) : (
              <p className="text-center text-sm text-gray-500">Waiting for matchups…</p>
            )}
          </section>
        )}
      </div>
    </main>
  );
};

export default MatchupsPage;
