// Calibration à 3 niveaux (Taquin = 3, Coquin = 4, Indécent = 5) et
// montée proportionnelle à la durée de la partie.

import assert from "node:assert/strict";
import { after, test } from "node:test";

import { createCouple, currentCard, game, play, pool, sql, startTwoPhoneGame } from "./helpers.mjs";

after(() => pool.end());

const ceiling = async (level, turn, turns) =>
  (await sql("select public.protocol_max_intensity($1, $2, $3) as max", [level, turn, turns]))[0].max;

test("la montée suit la durée : paliers à 15 % puis 40 % des cartes", async () => {
  const steps = async (level, turns) => {
    const out = [];
    for (let turn = 1; turn <= turns; turn += 1) out.push(await ceiling(level, turn, turns));
    return out.join("");
  };

  // partie normale (20 cartes) : identique à avant (cartes 3 et 8)
  assert.equal(await steps(5, 20), "333" + "44444" + "5".repeat(12));
  assert.equal(await steps(4, 20), "222" + "33333" + "4".repeat(12));
  assert.equal(await steps(3, 20), "222" + "3".repeat(17));
  // courte (16) et longue (28)
  assert.equal(await steps(5, 16), "33" + "4444" + "5".repeat(10));
  assert.equal(await steps(5, 28), "3333" + "4444444" + "5".repeat(17));
  // ancienne version sans durée = partie de 20 cartes
  const [{ max }] = await sql("select public.protocol_max_intensity(5, 8) as max");
  assert.equal(max, 4);
});

const playerOf = (couple, g) => (g.active_player === 1 ? couple.a : couple.b);

for (const [name, levels, cap] of [
  ["Taquin", [3, 5], 3],
  ["Coquin", [4, 4], 4],
  ["Indécent", [5, 5], 5],
]) {
  test(`${name} : aucune carte au-dessus du plafond, à chaque étape de la montée`, async () => {
    const couple = await createCouple();
    const code = await startTwoPhoneGame(couple, levels);
    const start = await game(code);
    assert.equal(start.shared_profile.intensity, cap, "le plus bas des deux choix");

    for (let turn = 0; turn < 60; turn += 1) {
      const g = await game(code);
      if (g.status !== "playing") break;
      const card = await currentCard(code);
      if (card) {
        assert.ok(
          card.intensity <= (await ceiling(cap, g.turn_no, g.target_turns)),
          `carte ${card.intensity} au tour ${g.turn_no} (${name})`
        );
      }
      await play(playerOf(couple, g), code, card?.type === "duel" ? "duel" : "pass", 1);
    }

    assert.equal((await game(code)).status, "finished");
  });
}
