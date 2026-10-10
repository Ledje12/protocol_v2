// Partie sur un seul téléphone : le téléphone qui crée la partie
// joue pour les deux, mais seulement dans ce mode.

import assert from "node:assert/strict";
import { after, test } from "node:test";

import {
  createCouple,
  currentCard,
  game,
  play,
  pool,
  rejects,
  rpc,
  startTwoPhoneGame,
} from "./helpers.mjs";

after(() => pool.end());

async function startSingleDeviceGame(couple) {
  const code = await rpc(couple.a, "create_single_device_game");
  let g = await game(code);

  assert.equal(g.single_device, true);
  assert.equal(g.status, "calibrating", "pas de salle d'attente");
  assert.deepEqual(
    [g.player_1_name, g.player_2_name, g.player_2_sex],
    ["Alex", "Bea", "female"]
  );

  for (const player of [1, 2]) {
    await rpc(couple.a, "submit_calibration_as", {
      p_game_code: code,
      p_player_no: player,
      p_intensity: 5,
      p_answers: {},
    });
  }

  await rpc(couple.a, "start_protocol", { p_game_code: code });
  g = await game(code);
  assert.equal(g.status, "playing");

  return code;
}

test("un seul téléphone : un compte joue les deux tours", async () => {
  const couple = await createCouple();
  const code = await startSingleDeviceGame(couple);
  const players = [];

  for (let turn = 0; turn < 6; turn += 1) {
    const g = await game(code);
    const card = await currentCard(code);
    players.push(g.active_player);

    // toujours le même téléphone (compte d'Alex), quel que soit le tour
    await play(couple.a, code, card.type === "duel" ? "duel" : "pass", 1);
  }

  assert.ok(players.includes(1) && players.includes(2), "les deux joueurs ont joué");
  assert.equal((await game(code)).turn_no, 7);
});

test("un seul téléphone : chaque joueur lit son texte privé", async () => {
  const couple = await createCouple();
  const code = await startSingleDeviceGame(couple);

  // scènes possibles à partir de 20 % de la partie
  while ((await game(code)).turn_no < 5) {
    const card = await currentCard(code);
    await play(couple.a, code, card.type === "duel" ? "duel" : "pass", 1);
  }

  let g = await game(code);
  await rpc(couple.a, "use_choose_type_guarded", {
    p_game_code: code,
    p_card_type: "scene",
    p_expected_turn_no: g.turn_no,
    p_expected_card_id: g.current_card_id,
    p_expected_card_source: g.current_card_source,
  });
  const before = await currentCard(code);
  await play(couple.a, code, before.type === "duel" ? "duel" : "pass", 1);

  const card = await currentCard(code);
  assert.equal(card.type, "scene");

  await rpc(couple.a, "advance_scene_step_guarded", {
    p_game_code: code,
    p_expected_card_id: card.id,
    p_expected_scene_step_no: 1,
  });

  for (const player of [1, 2]) {
    const view = await rpc(couple.a, "get_scene_state_as", {
      p_game_code: code,
      p_player_no: player,
    });
    assert.equal(view.is_private, true);
    assert.equal(view.prompt, `Texte privé du joueur ${player}.`);

    await rpc(couple.a, "mark_scene_step_read_guarded_as", {
      p_game_code: code,
      p_expected_card_id: card.id,
      p_expected_scene_step_no: 2,
      p_player_no: player,
    });
  }

  g = await game(code);
  assert.equal(g.scene_step_read_player_1, true);
  assert.equal(g.scene_step_read_player_2, true);
});

test("partie à deux téléphones : impossible de jouer à la place de l'autre", async () => {
  const couple = await createCouple();
  const code = await startTwoPhoneGame(couple);

  await rejects(
    rpc(couple.a, "get_scene_state_as", { p_game_code: code, p_player_no: 2 }),
    /not a single-device game/i
  );

  // et la fonction interne n'est pas appelable depuis l'app
  await rejects(
    rpc(couple.a, "protocol_act_as", { p_game_code: code, p_player_no: 2 }),
    /permission denied/i
  );
});

test("un seul téléphone : la revanche repart directement en calibration", async () => {
  const couple = await createCouple();
  const code = await startSingleDeviceGame(couple);

  for (let turn = 0; turn < 60 && (await game(code)).status === "playing"; turn += 1) {
    const card = await currentCard(code);
    await play(couple.a, code, card.type === "duel" ? "duel" : "pass", 1);
  }

  assert.equal((await game(code)).status, "finished");

  await rpc(couple.a, "rematch_protocol", { p_game_code: code });
  const g = await game(code);
  assert.equal(g.status, "calibrating");
});
