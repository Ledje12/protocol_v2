// Missions secrètes : une par joueur au lancement, privée,
// changeable une fois au début, révélée à la fin.

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

const mine = (user, code) => rpc(user, "get_my_mission", { p_game_code: code });

async function withMissions(style = null) {
  const couple = await createCouple();
  await rpc(couple.a, "set_protocol_missions_enabled", { p_enabled: true });

  if (style) {
    await rpc(couple.a, "set_protocol_couple_settings", {
      p_director_mode: "custom",
      p_director_profile: "classic",
      p_director_duration: "normal",
    });
    await rpc(couple.a, "set_protocol_card_style", { p_style: style });
  }

  return couple;
}

async function playToEnd(couple, code) {
  for (let turn = 0; turn < 60; turn += 1) {
    const g = await game(code);

    if (g.status !== "playing") {
      return g;
    }

    const card = await currentCard(code);
    const user = g.active_player === 1 ? couple.a : couple.b;
    await play(user, code, card.type === "duel" ? "duel" : "pass", 1);
  }

  throw new Error("partie trop longue");
}

const missionOf = async (code, player) =>
  (
    await sql(
      `select m.* from public.protocol_game_missions gm
       join public.games g on g.id = gm.game_id
       join public.protocol_missions m on m.id = gm.mission_id
       where g.code = $1 and gm.player_no = $2`,
      [code, player]
    )
  )[0];

test("désactivées par défaut : aucune mission", async () => {
  const couple = await createCouple();
  assert.equal(await rpc(couple.a, "get_protocol_missions_enabled"), false);

  const code = await startTwoPhoneGame(couple);
  const state = await mine(couple.a, code);
  assert.equal(state.enabled, false);
  assert.equal(state.mission, null);
});

test("au lancement : une mission chacun, différente, adaptée à la calibration et au sexe", async () => {
  const couple = await withMissions();
  const code = await startTwoPhoneGame(couple, [5, 2]);

  const [one, two] = [await missionOf(code, 1), await missionOf(code, 2)];
  assert.ok(one && two, "chacun a sa mission");
  assert.notEqual(one.id, two.id);

  for (const [mission, sex] of [[one, "male"], [two, "female"]]) {
    assert.ok(mission.intensity <= 2, "jamais au-delà de la calibration la plus prudente");
    assert.ok(mission.target_sex === null || mission.target_sex === sex);
  }

  const state = await mine(couple.a, code);
  assert.equal(state.mission.title, one.title);
  assert.equal(state.done, false);
  assert.equal(state.can_redraw, true);
});

test("style Vanilla : missions vanilla seulement", async () => {
  const couple = await withMissions("vanilla");
  const code = await startTwoPhoneGame(couple);

  assert.equal((await missionOf(code, 1)).style, "vanilla");
  assert.equal((await missionOf(code, 2)).style, "vanilla");
});

test("secrètes : on ne voit que la sienne, jamais le catalogue", async () => {
  const couple = await withMissions();
  const code = await startTwoPhoneGame(couple);

  assert.equal((await mine(couple.b, code)).mission.title, (await missionOf(code, 2)).title);
  await rejects(asUser(couple.b, "select * from public.protocol_game_missions"), /permission denied/i);
  await rejects(asUser(couple.b, "select * from public.protocol_missions"), /permission denied/i);
  await rejects(rpc(couple.b, "reveal_protocol_missions", { p_game_code: code }), /not finished/i);
});

test("« Une autre » : une seule fois, et seulement en début de partie", async () => {
  const couple = await withMissions();
  const code = await startTwoPhoneGame(couple);
  const before = await missionOf(code, 1);

  const after = await rpc(couple.a, "redraw_my_mission", { p_game_code: code });
  assert.notEqual(after.mission.title, before.title);
  assert.equal(after.can_redraw, false);
  await rejects(rpc(couple.a, "redraw_my_mission", { p_game_code: code }), /not available/i);

  // l'autre, après le 3e tour, ne peut plus en changer
  while ((await game(code)).turn_no <= 3) {
    const g = await game(code);
    const card = await currentCard(code);
    await play(g.active_player === 1 ? couple.a : couple.b, code, card.type === "duel" ? "duel" : "pass", 1);
  }
  assert.equal((await mine(couple.b, code)).can_redraw, false);
  await rejects(rpc(couple.b, "redraw_my_mission", { p_game_code: code }), /not available/i);
});

test("réussie en secret, révélée à la fin, puis la revanche en tire de nouvelles", async () => {
  const couple = await withMissions();
  const code = await startTwoPhoneGame(couple);

  assert.equal(await rpc(couple.b, "set_my_mission_done", { p_game_code: code, p_done: true }), true);
  assert.equal((await mine(couple.b, code)).done, true);

  // STOP puis reprise : les missions restent les mêmes
  const kept = await missionOf(code, 1);
  await rpc(couple.a, "stop_protocol_game", { p_game_code: code });
  await rpc(couple.a, "resume_protocol_game", { p_game_code: code });
  assert.equal((await missionOf(code, 1)).id, kept.id);

  await playToEnd(couple, code);
  const revealed = await rpc(couple.a, "reveal_protocol_missions", { p_game_code: code });
  assert.deepEqual(
    revealed.map(({ player_no, name, done }) => ({ player_no, name, done })),
    [
      { player_no: 1, name: "Alex", done: false },
      { player_no: 2, name: "Bea", done: true },
    ]
  );

  await rpc(couple.a, "rematch_protocol", { p_game_code: code });
  assert.equal(await missionOf(code, 1), undefined, "la revanche efface les missions");
});

test("un seul téléphone : chacun lit et coche la sienne", async () => {
  const couple = await withMissions();
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

  for (const player of [1, 2]) {
    const state = await rpc(couple.a, "get_my_mission_as", { p_game_code: code, p_player_no: player });
    assert.equal(state.player_no, player);
    assert.equal(state.mission.title, (await missionOf(code, player)).title);
  }

  await rpc(couple.a, "set_my_mission_done_as", { p_game_code: code, p_player_no: 2, p_done: true });
  assert.equal((await rpc(couple.a, "get_my_mission_as", { p_game_code: code, p_player_no: 2 })).done, true);
  assert.equal((await rpc(couple.a, "get_my_mission_as", { p_game_code: code, p_player_no: 1 })).done, false);
});
