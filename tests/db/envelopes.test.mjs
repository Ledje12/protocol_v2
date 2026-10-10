// L'enveloppe : écrite en secret vers 60 % de la partie, scellée,
// ouverte seulement à la fin normale de la partie.

import assert from "node:assert/strict";
import { after, test } from "node:test";

import {
  asUser,
  createCouple,
  currentCard,
  game,
  play,
  pool,
  rejects,
  rpc,
  sql,
  startTwoPhoneGame,
} from "./helpers.mjs";

after(() => pool.end());

const playerOf = (couple, g) => (g.active_player === 1 ? couple.a : couple.b);

async function playTurn(couple, code) {
  const g = await game(code);
  const card = await currentCard(code);
  await play(playerOf(couple, g), code, card.type === "duel" ? "duel" : "pass", 1);
}

async function playUntil(couple, code, condition) {
  for (let turn = 0; turn < 60; turn += 1) {
    const g = await game(code);

    if (g.status !== "playing" || condition(g)) {
      return g;
    }

    await playTurn(couple, code);
  }

  throw new Error("partie trop longue");
}

const envelope = (user, code) => rpc(user, "get_protocol_envelope", { p_game_code: code });
const seal = (user, code, message) =>
  rpc(user, "seal_protocol_envelope", { p_game_code: code, p_message: message });

test("l'enveloppe se propose après 60 % de la partie, pas avant", async () => {
  const couple = await createCouple();
  const code = await startTwoPhoneGame(couple);
  const { target_turns } = await game(code);
  const dueTurn = Math.floor(target_turns * 0.6) + 1;

  assert.deepEqual(
    { ...(await envelope(couple.a, code)), player_no: undefined },
    { enabled: true, due: false, sealed: false, player_no: undefined }
  );
  await rejects(seal(couple.a, code, "trop tôt"), /not available/i);

  await playUntil(couple, code, (g) => g.turn_no >= dueTurn);
  assert.equal((await envelope(couple.a, code)).due, true);
  assert.equal((await envelope(couple.b, code)).due, true);
});

test("scellée : impossible de la modifier, de la lire avant la fin ou depuis l'app", async () => {
  const couple = await createCouple();
  const code = await startTwoPhoneGame(couple);
  const { target_turns } = await game(code);
  await playUntil(couple, code, (g) => g.turn_no >= Math.floor(target_turns * 0.6) + 1);

  await rejects(seal(couple.a, code, "x".repeat(141)), /too long/i);
  assert.equal(await seal(couple.a, code, "  Ce que je veux pour la fin.  "), true);
  assert.equal((await envelope(couple.a, code)).sealed, true);
  assert.equal((await envelope(couple.b, code)).sealed, false, "l'autre n'en sait rien");

  await rejects(seal(couple.a, code, "changement d'avis"), /already sealed/i);
  await rejects(rpc(couple.b, "open_protocol_envelopes", { p_game_code: code }), /not finished/i);
  await rejects(
    asUser(couple.b, "select message from public.protocol_game_envelopes"),
    /permission denied/i
  );
  await rejects(
    rpc(couple.b, "get_protocol_envelope_as", { p_game_code: code, p_player_no: 1 }),
    /not a single-device game/i
  );
});

test("fin de partie : seules les enveloppes écrites s'ouvrent, puis la revanche repart à neuf", async () => {
  const couple = await createCouple();
  const code = await startTwoPhoneGame(couple);
  const { target_turns } = await game(code);
  await playUntil(couple, code, (g) => g.turn_no >= Math.floor(target_turns * 0.6) + 1);

  await seal(couple.a, code, "Ce que je veux pour la fin.");
  await seal(couple.b, code, ""); // passe

  const end = await playUntil(couple, code, () => false);
  assert.equal(end.status, "finished");

  const opened = await rpc(couple.b, "open_protocol_envelopes", { p_game_code: code });
  assert.deepEqual(opened, [
    { player_no: 1, name: "Alex", message: "Ce que je veux pour la fin." },
  ]);

  await rpc(couple.a, "rematch_protocol", { p_game_code: code });
  const [{ n }] = await sql(
    `select count(*)::int as n from public.protocol_game_envelopes e
     join public.games g on g.id = e.game_id where g.code = $1`,
    [code]
  );
  assert.equal(n, 0, "la revanche efface les enveloppes");
});

test("réglage du couple : sans enveloppe, rien ne se propose", async () => {
  const couple = await createCouple();
  assert.equal(await rpc(couple.a, "get_protocol_envelope_enabled"), true);
  await rpc(couple.b, "set_protocol_envelope_enabled", { p_enabled: false });
  assert.equal(await rpc(couple.a, "get_protocol_envelope_enabled"), false);

  const code = await startTwoPhoneGame(couple);
  const { target_turns } = await game(code);
  await playUntil(couple, code, (g) => g.turn_no >= Math.floor(target_turns * 0.6) + 1);

  assert.equal((await envelope(couple.a, code)).due, false);
  await rejects(seal(couple.a, code, "non"), /disabled/i);
});

test("un seul téléphone : chacun scelle la sienne à son tour", async () => {
  const couple = await createCouple();
  const code = await rpc(couple.a, "create_single_device_game");

  for (const player of [1, 2]) {
    await rpc(couple.a, "submit_calibration_as", {
      p_game_code: code,
      p_player_no: player,
      p_intensity: 5,
      p_answers: {},
    });
  }
  await rpc(couple.a, "start_protocol", { p_game_code: code });

  const { target_turns } = await game(code);
  const dueTurn = Math.floor(target_turns * 0.6) + 1;

  while ((await game(code)).turn_no < dueTurn) {
    const card = await currentCard(code);
    await play(couple.a, code, card.type === "duel" ? "duel" : "pass", 1);
  }

  for (const player of [1, 2]) {
    const state = await rpc(couple.a, "get_protocol_envelope_as", {
      p_game_code: code,
      p_player_no: player,
    });
    assert.equal(state.due, true);
    assert.equal(state.player_no, player);

    await rpc(couple.a, "seal_protocol_envelope_as", {
      p_game_code: code,
      p_player_no: player,
      p_message: `Enveloppe ${player}`,
    });
  }

  const [{ n }] = await sql(
    `select count(*)::int as n from public.protocol_game_envelopes e
     join public.games g on g.id = e.game_id where g.code = $1`,
    [code]
  );
  assert.equal(n, 2);
});
