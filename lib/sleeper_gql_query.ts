// lib/sleeper_gql_query.ts

export const SLEEPER_GQL_URL = "https://sleeper.com/graphql";

/**
 * Build the same “batch” query Sleeper uses:
 * two aliases for the week — one for actual stats and one for projections.
 * We only need { player_id, stats } for our totals.
 */
export function buildProjectionsPayload(
  season: number,
  week: number,
  playerIds: string[]
) {
  const ids = playerIds.map((id) => `"${id}"`).join(",");

  const alias = (category: "stat" | "proj") =>
    `nfl__regular__${season}__${week}__${category}`;

  const query = `
    query get_player_score_and_projections_batch {
      ${alias("stat")}: stats_for_players_in_week(
        sport: "nfl", season: "${season}", season_type: "regular",
        week: ${week}, category: "stat", player_ids: [${ids}]
      ) { player_id stats }

      ${alias("proj")}: stats_for_players_in_week(
        sport: "nfl", season: "${season}", season_type: "regular",
        week: ${week}, category: "proj", player_ids: [${ids}]
      ) { player_id stats }
    }
  `;

  return {
    operationName: "get_player_score_and_projections_batch",
    variables: {},
    query,
  };
}
