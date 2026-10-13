// « Nos soirées » : le souvenir de chaque partie terminée, gardé
// même après une revanche, visible du duo seulement.

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
  startTwoPhoneGame,
} from "./helpers.mjs";

after(() => pool.end());

const playerOf = (couple, g) => (g.active_player === 1 ? couple.a : couple.b);

async function playToEnd(couple, code) {
  for (let turn = 0; turn < 60; turn += 1) {
    const g = await game(code);
    if (g.status !== "playing") {
      return g;
    }
    const card = await currentCard(code);
    await play(playerOf(couple, g), code, card.type === "duel" ? "duel" : "pass", 1);
  }
  throw new Error("partie trop longue");
}

test("une partie terminée devient une soirée, gardée après la revanche", async () => {
  const couple = await createCouple();
  const code = await startTwoPhoneGame(couple);
  const end = await playToEnd(couple, code);
  assert.equal(end.status, "finished");

  const [recap] = await rpc(couple.a, "get_protocol_recaps", {}).then((rows) => rows);
  assert.ok(recap, "une soirée");
  assert.equal(recap.cards.length, end.target_turns);
  assert.ok(recap.cards.every((card) => card.title && card.type && card.outcome));
  assert.ok(recap.started_at && recap.finished_at);

  // avis lus à l'affichage : le mien, et 🔥 à deux
  const first = recap.cards[0];
  for (const user of [couple.a, couple.b]) {
    await rpc(user, "set_card_rating", {
      p_card_source: first.source,
      p_card_id: first.card_id,
      p_rating: "fire",
    });
  }
  const [again] = await rpc(couple.a, "get_protocol_recaps", {});
  assert.equal(again.cards[0].my_rating, "fire");
  assert.equal(again.cards[0].fire_both, true);
  assert.equal(again.cards[1].fire_both, false);

  // la revanche efface l'historique de la partie, pas la soirée
  await rpc(couple.a, "rematch_protocol", { p_game_code: code });
  assert.equal((await rpc(couple.b, "get_protocol_recaps", {})).length, 1);
});

test("une soirée ne se voit et ne s'oublie qu'à deux", async () => {
  const couple = await createCouple();
  const other = await createCouple();
  const code = await startTwoPhoneGame(couple);
  await playToEnd(couple, code);

  const [recap] = await rpc(couple.a, "get_protocol_recaps", {});
  assert.deepEqual(await rpc(other.a, "get_protocol_recaps", {}), []);
  await rejects(rpc(other.a, "delete_protocol_recap", { p_recap_id: recap.id }), /not found/i);
  await rejects(asUser(couple.a, "select * from public.protocol_game_recaps"), /permission denied/);

  assert.equal(await rpc(couple.b, "delete_protocol_recap", { p_recap_id: recap.id }), true);
  assert.deepEqual(await rpc(couple.a, "get_protocol_recaps", {}), []);
});
