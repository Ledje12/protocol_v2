// Cartes perso en partie : une à deux par partie quand le couple en a
// écrit, jamais pour le mauvais joueur, jamais deux fois la même.

import assert from "node:assert/strict";
import { after, test } from "node:test";

import { createCouple, currentCard, game, pool, rpc, sql, startTwoPhoneGame } from "./helpers.mjs";

after(() => pool.end());

const playerOf = (couple, g) => (g.active_player === 1 ? couple.a : couple.b);

async function playToEnd(couple, code) {
  const seen = [];
  for (let i = 0; i < 60; i += 1) {
    const g = await game(code);
    if (g.status !== "playing") break;
    if (g.sealed_status === "pending") {
      await rpc(playerOf(couple, g), "accept_sealed_card", { p_game_code: code, p_expected_card_id: g.current_card_id });
    }
    let type;
    if (g.current_card_source === "custom") {
      const [c] = await sql("select * from public.protocol_custom_cards where id = $1", [g.current_custom_card_id]);
      seen.push({ ...c, player: g.active_player, sex: g.active_player === 1 ? g.player_1_sex : g.player_2_sex });
      type = c.type;
    } else {
      type = (await currentCard(code)).type;
    }
    await rpc(playerOf(couple, g), "advance_protocol_guarded", {
      p_game_code: code,
      p_action: type === "duel" ? "duel" : type === "scene" ? "pass" : "done",
      p_duel_winner: type === "duel" ? 1 : null,
      p_expected_turn_no: g.turn_no,
      p_expected_card_id: g.current_card_source === "custom" ? g.current_custom_card_id : g.current_card_id,
      p_expected_card_source: g.current_card_source,
    });
  }
  return seen;
}

test("une à deux cartes perso par partie, pour le bon joueur, jamais la même deux fois", async () => {
  const counts = [];

  for (let run = 0; run < 4; run += 1) {
    const couple = await createCouple();
    for (let k = 0; k < 6; k += 1) {
      await sql(
        `insert into public.protocol_custom_cards (couple_id, created_by, type, title, prompt, intensity, target_sex)
         values ($1, $2, 'action', $3, 'consigne perso', $4, $5)`,
        [couple.coupleId, couple.a.id, `Perso ${run}-${k}`, 1 + (k % 3), k === 0 ? "female" : null]
      );
    }

    const code = await startTwoPhoneGame(couple);
    const seen = await playToEnd(couple, code);

    // une ou deux ; le tirage normal peut, rarement, en ajouter une
    assert.ok(seen.length >= 1 && seen.length <= 3, `une à deux (${seen.length})`);
    assert.equal(new Set(seen.map((c) => c.id)).size, seen.length, "jamais la même deux fois");
    for (const c of seen) {
      assert.ok(!c.target_sex || c.target_sex === c.sex, "la carte va au bon joueur");
    }
    counts.push(seen.length);
  }

  assert.ok(counts.reduce((a, b) => a + b, 0) <= 10, `cartes perso par partie : ${counts.join(", ")}`);
});

test("sans carte perso, rien ne change", async () => {
  const couple = await createCouple();
  const code = await startTwoPhoneGame(couple);
  const seen = await playToEnd(couple, code);
  assert.equal(seen.length, 0);
});
