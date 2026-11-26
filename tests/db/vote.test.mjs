// La carte « Oui / Non » : cinq cartes, chacun vote en secret, une
// seule envie commune est jouée plus tard, au tour de son joueur.
// Et le bandeau des cartes déjà aimées.

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

// joue le tour en cours selon le type de carte, comme les joueurs
async function step(couple, code) {
  const g = await game(code);
  const card = await currentCard(code);
  const action = card?.type === "duel" ? "duel" : card?.type === "scene" ? "pass" : "done";
  return play(playerOf(couple, g), code, action, 1);
}
const userOf = (couple, n) => (n === 1 ? couple.a : couple.b);

async function voteGame() {
  const couple = await createCouple();
  await rpc(couple.a, "set_protocol_vote_enabled", { p_enabled: true });
  const code = await startTwoPhoneGame(couple);
  return { couple, code };
}

// joue des tours jusqu'à l'ouverture du vote
async function untilVote(couple, code) {
  for (let i = 0; i < 25; i += 1) {
    const g = await game(code);
    if (g.vote_status === "open") return g;
    if (g.status !== "playing") break;
    await step(couple, code);
  }
  throw new Error("le vote ne s'est pas ouvert");
}

const votes = (g) =>
  sql("select * from public.protocol_game_votes where game_id = $1 order by position", [g.id]);

const cardOf = (user, code) => rpc(user, "get_protocol_current_card", { p_game_code: code });

async function voteAll(couple, code, choose) {
  const g = await game(code);
  const rows = await votes(g);
  for (const n of [1, 2]) {
    for (const row of rows) {
      await rpc(userOf(couple, n), "cast_protocol_vote", {
        p_game_code: code,
        p_position: row.position,
        p_yes: choose(n, row),
      });
    }
  }
  return rows;
}

test("le vote s'ouvre une fois, en milieu de partie, avec trois cartes pour l'un et deux pour l'autre", async () => {
  const { couple, code } = await voteGame();
  const g = await untilVote(couple, code);

  assert.ok(g.vote_turn >= 8 && g.vote_turn <= 17, `tour ${g.vote_turn}`);

  const rows = await votes(g);
  assert.equal(rows.length, 5);
  assert.equal(new Set(rows.map((r) => r.card_id)).size, 5);
  assert.equal(rows.filter((r) => r.for_player === g.active_player).length, 3);
  assert.equal(rows.filter((r) => r.for_player !== g.active_player).length, 2);

  // la partie attend : impossible de passer au tour suivant
  await rejects(step(couple, code), /Vote in progress/);

  // chacun voit les cinq cartes, la carte du tour reste cachée
  const view = await cardOf(couple.a, code);
  assert.equal(view.vote.status, "open");
  assert.equal(view.vote.cards.length, 5);
  assert.ok(view.vote.cards.every((c) => c.title && c.prompt && [1, 2].includes(c.for_player)));
  assert.equal(view.prompt, "");
});

test("un vote est définitif, et l'autre ne voit que l'avancée, jamais les réponses", async () => {
  const { couple, code } = await voteGame();
  const g = await untilVote(couple, code);
  const [first] = await votes(g);

  await rpc(couple.a, "cast_protocol_vote", { p_game_code: code, p_position: first.position, p_yes: true });
  await rejects(
    rpc(couple.a, "cast_protocol_vote", { p_game_code: code, p_position: first.position, p_yes: false }),
    /already cast/
  );
  await rejects(
    rpc(couple.a, "cast_protocol_vote", { p_game_code: code, p_position: 9, p_yes: true }),
    /Unknown vote card|violates|out of range/
  );

  const seenByB = await cardOf(couple.b, code);
  assert.equal(seenByB.vote.partner, 1);
  assert.equal(seenByB.vote.mine, 0);
  assert.ok(seenByB.vote.cards.every((c) => c.voted === false));
  assert.equal(JSON.stringify(seenByB).includes("vote_p1"), false);
});

test("des oui communs : une seule carte, jouée au tour suivant par son joueur", async () => {
  const { couple, code } = await voteGame();
  const opened = await untilVote(couple, code);
  await voteAll(couple, code, () => true);

  let g = await game(code);
  assert.equal(g.vote_status, "done");
  assert.equal(g.vote_result, "match");
  assert.equal(g.vote_play_turn, opened.turn_no + 1);

  // le résultat s'affiche le temps du tour du vote
  const reveal = await cardOf(couple.b, code);
  assert.equal(reveal.vote.result, "match");
  assert.equal(reveal.vote.card.for_player, g.vote_for_player);
  assert.ok(reveal.prompt);

  // la partie reprend : l'envie commune est la carte du tour suivant
  await step(couple, code);
  g = await game(code);
  assert.equal(g.turn_no, opened.turn_no + 1);
  assert.equal(String(g.current_card_id), String(g.vote_card_id));
  assert.equal(g.active_player, g.vote_for_player);
  assert.equal((await cardOf(couple.a, code)).vote_pick, true);

  // une seule fois, puis l'alternance reprend
  await step(couple, code);
  const after = await game(code);
  assert.equal(after.vote_played_turn, opened.turn_no + 1);
  assert.equal(after.active_player, 3 - g.active_player);
  assert.equal((await cardOf(couple.a, code)).vote_pick, false);
});

test("envie pour celui qui vient de jouer : il garde la main pour ce tour", async () => {
  const { couple, code } = await voteGame();
  const opened = await untilVote(couple, code);
  const mine = opened.active_player;
  await voteAll(couple, code, (_, row) => row.for_player === mine);

  await step(couple, code);
  const g = await game(code);
  assert.equal(g.active_player, mine);
  assert.equal(String(g.current_card_id), String(g.vote_card_id));
});

test("un seul téléphone : chacun vote à son tour, en se passant le téléphone", async () => {
  const couple = await createCouple();
  await rpc(couple.a, "set_protocol_vote_enabled", { p_enabled: true });
  const code = await rpc(couple.a, "create_single_device_game");
  for (const player of [1, 2]) {
    await rpc(couple.a, "submit_calibration_as", {
      p_game_code: code, p_player_no: player, p_intensity: 5, p_answers: {},
    });
  }
  await rpc(couple.a, "start_protocol", { p_game_code: code });

  const opened = await untilVote(couple, code);
  const rows = await votes(opened);

  for (const player of [1, 2]) {
    for (const row of rows) {
      await rpc(couple.a, "cast_protocol_vote_as", {
        p_game_code: code, p_player_no: player, p_position: row.position, p_yes: true,
      });
    }
    const view = await cardOf(couple.a, code);
    if (player === 1) {
      assert.equal(view.vote.count_p1, rows.length);
      assert.equal(view.vote.count_p2, 0);
      assert.ok(view.vote.cards.every((c) => c.voted_p1 && !c.voted_p2));
    }
  }

  const g = await game(code);
  assert.equal(g.vote_result, "match");
  assert.equal(g.vote_play_turn, opened.turn_no + 1);
});

test("aucun oui commun : rien n'est révélé, la partie continue", async () => {
  const { couple, code } = await voteGame();
  await untilVote(couple, code);
  await voteAll(couple, code, (n) => n === 1);

  const g = await game(code);
  assert.equal(g.vote_result, "none");
  assert.equal(g.vote_card_id, null);
  const view = await cardOf(couple.a, code);
  assert.equal(view.vote.result, "none");
  assert.equal(view.vote.card, null);

  await step(couple, code);
  assert.equal((await game(code)).vote_status, "done");
});

test("réglage coupé : aucun vote de toute la partie", async () => {
  const couple = await createCouple();
  const code = await startTwoPhoneGame(couple);
  for (let i = 0; i < 19; i += 1) {
    const g = await game(code);
    if (g.status !== "playing") break;
    assert.equal(g.vote_status, null);
    await step(couple, code);
  }
});

test("carte déjà aimée : chacun voit qui l'avait aimée ou adorée", async () => {
  const couple = await createCouple();
  const code = await startTwoPhoneGame(couple);
  const g = await game(code);

  await rpc(couple.b, "set_card_rating", {
    p_card_source: g.current_card_source,
    p_card_id: g.current_card_id,
    p_rating: "fire",
  });

  const forA = await cardOf(couple.a, code);
  assert.deepEqual(forA.liked, { me: null, partner: "fire" });
  const forB = await cardOf(couple.b, code);
  assert.deepEqual(forB.liked, { me: "fire", partner: null });

  // un pouce vers le bas ne s'affiche pas
  await rpc(couple.a, "set_card_rating", {
    p_card_source: g.current_card_source,
    p_card_id: g.current_card_id,
    p_rating: "dislike",
  });
  assert.equal((await cardOf(couple.b, code)).liked.partner, null);
});
