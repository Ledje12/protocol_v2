// Partie sur deux téléphones : association, calibration, tirage,
// jokers, duel, STOP, scènes à étape privée.

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
  sql,
  startTwoPhoneGame,
} from "./helpers.mjs";

after(() => pool.end());

const playerOf = (couple, g) => (g.active_player === 1 ? couple.a : couple.b);

const styleOf = async (card) =>
  (
    await sql(
      "select style from public.protocol_card_families where family_key = $1",
      [card.family_key]
    )
  )[0]?.style;

// Joue la carte en cours comme un joueur pressé : les duels sont
// gagnés par le joueur 1 (ou celui indiqué), le reste est fait
// (scènes : passées).
async function playTurn(couple, code, duelWinner = 1) {
  const g = await game(code);
  const card = await currentCard(code);
  const user = playerOf(couple, g);

  if (card.type === "duel") {
    await play(user, code, "duel", duelWinner);
  } else if (card.type === "scene") {
    await play(user, code, "pass");
  } else {
    await play(user, code, "done");
  }

  return { g, card };
}

// Joue toute la partie et renvoie les cartes tirées.
async function playToEnd(couple, code) {
  const drawn = [];

  for (let turn = 0; turn < 60; turn += 1) {
    const g = await game(code);

    if (g.status !== "playing") {
      break;
    }

    drawn.push({ ...(await currentCard(code)), activePlayer: g.active_player, g });
    await playTurn(couple, code);
  }

  assert.equal((await game(code)).status, "finished", "la partie doit se terminer");
  return drawn;
}

async function setCardStyle(user, style) {
  await rpc(user, "set_protocol_couple_settings", {
    p_director_mode: "custom",
    p_director_profile: "classic",
    p_director_duration: "normal",
  });
  await rpc(user, "set_protocol_card_style", { p_style: style });
}

async function imposeType(couple, code, type) {
  const g = await game(code);

  await rpc(playerOf(couple, g), "use_choose_type_guarded", {
    p_game_code: code,
    p_card_type: type,
    p_expected_turn_no: g.turn_no,
    p_expected_card_id: g.current_card_id,
    p_expected_card_source: g.current_card_source,
  });

  return g.active_player;
}

test("association et lancement d'une partie à deux téléphones", async () => {
  const couple = await createCouple();
  const code = await startTwoPhoneGame(couple);
  const g = await game(code);

  assert.equal(g.status, "playing");
  assert.equal(g.turn_no, 1);
  assert.ok(g.current_card_id, "une première carte est tirée");
  assert.equal(g.couple_id, couple.coupleId);
  assert.deepEqual(
    [g.player_1_name, g.player_1_sex, g.player_2_name, g.player_2_sex],
    ["Alex", "male", "Bea", "female"]
  );

  // deux jokers chacun au départ, plus de points
  for (const bonus of [g.bonus_player_1, g.bonus_player_2]) {
    assert.equal(bonus.choose_type, true);
    assert.equal(bonus.take_control, true);
  }
});

test("seul le joueur dont c'est le tour peut jouer", async () => {
  const couple = await createCouple();
  const code = await startTwoPhoneGame(couple);
  const g = await game(code);
  const waiting = g.active_player === 1 ? couple.b : couple.a;

  await rejects(play(waiting, code, "pass"), /not active player/i);
});

test("une partie complète respecte la calibration la plus prudente et le sexe de chacun", async () => {
  const couple = await createCouple();
  const code = await startTwoPhoneGame(couple, [5, 2]);
  const drawn = await playToEnd(couple, code);

  assert.ok(drawn.length >= 10, `partie trop courte : ${drawn.length} cartes`);

  for (const card of drawn) {
    assert.ok(card.intensity <= 2, `carte d'intensité ${card.intensity} malgré une calibration à 2`);

    const sex = card.activePlayer === 1 ? "male" : "female";
    assert.ok(
      card.target_sex === null || card.target_sex === sex,
      `carte pour ${card.target_sex} tirée pour un joueur ${sex}`
    );
  }
});

test("style Vanilla : aucune carte kinky", async () => {
  const couple = await createCouple();
  await setCardStyle(couple.a, "vanilla");
  const code = await startTwoPhoneGame(couple);

  for (const card of await playToEnd(couple, code)) {
    assert.equal(await styleOf(card), "vanilla", `carte ${card.family_key} en mode Vanilla`);
  }
});

test("style Kinky : seulement des cartes kinky, sauf vérités, duels et niveaux 1-2", async () => {
  const couple = await createCouple();
  await setCardStyle(couple.b, "kinky");
  const code = await startTwoPhoneGame(couple);
  const drawn = await playToEnd(couple, code);

  for (const card of drawn) {
    assert.ok(
      (await styleOf(card)) === "kinky" ||
        ["truth", "duel"].includes(card.type) ||
        card.intensity <= 2,
      `carte vanilla ${card.type} niveau ${card.intensity} en mode Kinky`
    );
  }
});

test("joker « Imposer le type » puis duel gagné : le joker est rechargé", async () => {
  const couple = await createCouple();
  let code = await startTwoPhoneGame(couple);

  // pas deux duels de suite : partir d'une première carte qui n'en est pas un
  while ((await currentCard(code)).type === "duel") {
    code = await startTwoPhoneGame(couple);
  }

  const jokerPlayer = await imposeType(couple, code, "duel");
  const bonusKey = `bonus_player_${jokerPlayer}`;

  let g = await game(code);
  assert.equal(g[bonusKey].choose_type, undefined, "le joker est consommé");
  assert.equal(g[bonusKey].choose_type_armed, "duel");

  await playTurn(couple, code);
  g = await game(code);
  assert.equal((await currentCard(code)).type, "duel", "la carte suivante est un duel");

  await play(playerOf(couple, g), code, "duel", jokerPlayer);
  g = await game(code);
  assert.equal(g[bonusKey].choose_type, true, "le duel gagné recharge le joker");
});

test("joker « Prendre la main » : le même joueur rejoue", async () => {
  const couple = await createCouple();
  const code = await startTwoPhoneGame(couple);
  let g = await game(code);
  const player = g.active_player;

  await rpc(playerOf(couple, g), "use_take_control_guarded", {
    p_game_code: code,
    p_expected_turn_no: g.turn_no,
    p_expected_card_id: g.current_card_id,
    p_expected_card_source: g.current_card_source,
  });

  // un duel gagné rechargerait le joker : c'est l'autre qui gagne
  await playTurn(couple, code, player === 1 ? 2 : 1);
  g = await game(code);
  assert.equal(g.active_player, player, "le joueur garde la main");
  assert.notEqual(g[`bonus_player_${player}`].take_control, true);
});

test("STOP puis reprise : la partie continue, sans redonner de jokers", async () => {
  const couple = await createCouple();
  const code = await startTwoPhoneGame(couple);
  let g = await game(code);
  const user = playerOf(couple, g);
  const bonusKey = `bonus_player_${g.active_player}`;

  await rpc(user, "use_take_control_guarded", {
    p_game_code: code,
    p_expected_turn_no: g.turn_no,
    p_expected_card_id: g.current_card_id,
    p_expected_card_source: g.current_card_source,
  });

  await rpc(couple.a, "stop_protocol_game", { p_game_code: code });
  assert.equal((await game(code)).status, "paused");
  await rejects(play(user, code, "pass"), /./);

  await rpc(couple.b, "resume_protocol_game", { p_game_code: code });
  g = await game(code);
  assert.equal(g.status, "playing");
  assert.notEqual(g[bonusKey].take_control, true, "la reprise ne recharge pas les jokers");
});

test("type imposé indisponible (scène en début de partie) : tirage normal et joker rendu", async () => {
  const couple = await createCouple();
  const code = await startTwoPhoneGame(couple);

  // pas de scène avant 20 % de la partie
  const player = await imposeType(couple, code, "scene");
  await playTurn(couple, code);

  const g = await game(code);
  assert.equal(g.turn_no, 2, "la partie avance");
  assert.notEqual((await currentCard(code)).type, "scene");
  assert.equal(g[`bonus_player_${player}`].choose_type, true, "le joker est rendu");
  assert.equal(g[`bonus_player_${player}`].choose_type_armed, undefined);
});

test("scène : l'étape privée montre à chacun son propre texte", async () => {
  const couple = await createCouple();
  const code = await startTwoPhoneGame(couple);

  // scènes possibles à partir de 20 % de la partie
  while ((await game(code)).turn_no < 5) {
    await playTurn(couple, code);
  }

  await imposeType(couple, code, "scene");
  await playTurn(couple, code);

  let g = await game(code);
  const card = await currentCard(code);
  assert.equal(card.type, "scene");

  const state = (user) => rpc(user, "get_scene_state", { p_game_code: code });
  assert.equal((await state(couple.a)).step_no, 1);

  await rpc(playerOf(couple, g), "advance_scene_step_guarded", {
    p_game_code: code,
    p_expected_card_id: card.id,
    p_expected_scene_step_no: 1,
  });

  const [forA, forB] = [await state(couple.a), await state(couple.b)];
  assert.equal(forA.step_no, 2);
  assert.equal(forA.is_private, true);
  assert.equal(forA.prompt, "Texte privé du joueur 1.");
  assert.equal(forB.prompt, "Texte privé du joueur 2.");

  for (const user of [couple.a, couple.b]) {
    await rpc(user, "mark_scene_step_read_guarded", {
      p_game_code: code,
      p_expected_card_id: card.id,
      p_expected_scene_step_no: 2,
    });
  }

  g = await game(code);
  assert.equal(g.scene_step_read_player_1, true);
  assert.equal(g.scene_step_read_player_2, true);
});

test("un joueur extérieur au couple ne voit pas la partie", async () => {
  const couple = await createCouple();
  const other = await createCouple();
  const code = await startTwoPhoneGame(couple);

  await rejects(rpc(other.a, "get_scene_state", { p_game_code: code }), /denied/i);
  await rejects(play(other.a, code, "pass"), /denied/i);
});
