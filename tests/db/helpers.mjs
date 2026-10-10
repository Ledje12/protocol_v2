// Outils communs aux tests : appeler les fonctions de la base
// comme le fait l'app (rôle « authenticated », identité dans le
// jeton), créer des joueurs, un couple, une partie.

import assert from "node:assert/strict";
import crypto from "node:crypto";
import pg from "pg";

export const pool = new pg.Pool({
  connectionString:
    process.env.TEST_DATABASE_URL ||
    "postgres://postgres@127.0.0.1:5432/protocol_test",
  max: 4,
});

const param = (value) =>
  value !== null && typeof value === "object" ? JSON.stringify(value) : value;

// Exécute une requête en tant que joueur, dans une transaction,
// comme PostgREST : role authenticated + jwt claims.
export async function asUser(user, sql, params = []) {
  const client = await pool.connect();

  try {
    await client.query("begin");
    await client.query(
      "select set_config('request.jwt.claims', $1, true)",
      [JSON.stringify({ sub: user.id, role: "authenticated" })]
    );
    await client.query("set local role authenticated");
    const result = await client.query(sql, params.map(param));
    await client.query("commit");
    return result;
  } catch (error) {
    await client.query("rollback").catch(() => {});
    throw error;
  } finally {
    client.release();
  }
}

// supabase.rpc(fn, args) : valeur simple pour une fonction scalaire,
// lignes pour une fonction qui renvoie une table.
export async function rpc(user, fn, args = {}) {
  const keys = Object.keys(args);
  const call = keys.map((key, i) => `${key} => $${i + 1}`).join(", ");
  const result = await asUser(
    user,
    `select * from public.${fn}(${call})`,
    keys.map((key) => args[key])
  );

  if (result.fields.length === 1 && result.fields[0].name === fn) {
    return result.rows[0]?.[fn];
  }

  return result.rows;
}

// Vérifie qu'un appel est refusé avec un message donné.
export async function rejects(promise, pattern) {
  await assert.rejects(promise, (error) => {
    assert.match(error.message, pattern);
    return true;
  });
}

// Requête directe (administrateur), pour préparer ou vérifier.
export async function sql(text, params = []) {
  return (await pool.query(text, params.map(param))).rows;
}

export async function createUser(name, sex) {
  const email = `${name.toLowerCase()}-${crypto.randomUUID()}@test.local`;
  const [user] = await sql(
    "insert into auth.users (email) values ($1) returning id, email",
    [email]
  );

  await asUser(
    user,
    "insert into public.protocol_profiles (user_id, display_name, sex) values ($1, $2, $3)",
    [user.id, name, sex]
  );

  return { ...user, name, sex };
}

// Deux joueurs associés en couple (comme l'écran d'association).
export async function createCouple() {
  const a = await createUser("Alex", "male");
  const b = await createUser("Bea", "female");

  const invite = await rpc(a, "create_protocol_couple_invite");
  await rpc(b, "join_protocol_couple", { p_code: invite.code });

  const [{ couple_id }] = await sql(
    "select couple_id from public.protocol_couple_members where user_id = $1",
    [a.id]
  );

  return { a, b, coupleId: couple_id };
}

export const game = async (code) =>
  (await sql("select * from public.games where code = $1", [code]))[0];

// Partie sur deux téléphones jusqu'à la première carte.
export async function startTwoPhoneGame({ a, b }, intensity = [5, 5]) {
  const [{ code }] = await rpc(a, "create_protocol_game");
  await rpc(b, "join_protocol_game", { p_game_code: code });

  // prénoms et sexes repris des profils (salle d'attente)
  await rpc(a, "save_protocol_identity", { p_game_code: code });
  await rpc(b, "save_protocol_identity", { p_game_code: code });

  await rpc(a, "set_protocol_ready", { p_game_code: code });
  await rpc(b, "set_protocol_ready", { p_game_code: code });

  await rpc(a, "submit_calibration", {
    p_game_code: code,
    p_intensity: intensity[0],
    p_answers: {},
  });
  await rpc(b, "submit_calibration", {
    p_game_code: code,
    p_intensity: intensity[1],
    p_answers: {},
  });

  await rpc(a, "start_protocol", { p_game_code: code });
  return code;
}

// Joue le tour en cours avec l'action donnée, comme le bouton de l'app.
export async function play(user, code, action, duelWinner = null) {
  const g = await game(code);

  return rpc(user, "advance_protocol_guarded", {
    p_game_code: code,
    p_action: action,
    p_duel_winner: duelWinner,
    p_expected_turn_no: g.turn_no,
    p_expected_card_id: g.current_card_id,
    p_expected_card_source: g.current_card_source,
  });
}

export const currentCard = async (code) =>
  (
    await sql(
      `select c.* from public.games g
       join public.protocol_cards c on c.id = g.current_card_id
       where g.code = $1`,
      [code]
    )
  )[0];
