export async function getLeagueData(leagueId: string) {
  const res = await fetch(`https://api.sleeper.app/v1/league/${leagueId}`, {
    cache: "no-store",
  });
  if (!res.ok) throw new Error("Failed to fetch league");
  return res.json();
}

export async function getStandings(leagueId: string) {
  const res = await fetch(`https://api.sleeper.app/v1/league/${leagueId}/rosters`, {
    cache: "no-store",
  });
  if (!res.ok) throw new Error("Failed to fetch rosters");
  return res.json();
}

export async function getLeagueUsers(leagueId: string) {
  const res = await fetch(`https://api.sleeper.app/v1/league/${leagueId}/users`, {
    cache: "no-store",
  });
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
