// Le joker « L'envie » (thème de la prochaine carte) et la règle d'une
// seule autre proposition par tour.

import assert from "node:assert/strict";
import { after, test } from "node:test";

import {
  createCouple,
  currentCard,
  game,
  pool,
  rejects,
  rpc,
  sql,
  startTwoPhoneGame,
} from "./helpers.mjs";

after(() => pool.end());

const playerOf = (couple, g) => (g.active_player === 1 ? couple.a : couple.b);
const otherOf = (couple, g) => (g.active_player === 1 ? couple.b : couple.a);
const bonusOf = (g, n) => g[`bonus_player_${n}`] || {};

async function advance(couple, code, action, winner = 1) {
  const g = await game(code);
  return rpc(playerOf(couple, g), "advance_protocol_guarded", {
    p_game_code: code,
    p_action: action,
    p_duel_winner: action === "duel" ? winner : null,
    p_expected_turn_no: g.turn_no,
    p_expected_card_id: g.current_card_id,
    p_expected_card_source: g.current_card_source,
  });
}

// termine le tour en cours sans se soucier de la carte (scellée acceptée)
async function finishTurn(couple, code, winner = 1) {
  let g = await game(code);
  if (g.sealed_status === "pending") {
    await rpc(playerOf(couple, g), "accept_sealed_card", { p_game_code: code, p_expected_card_id: g.current_card_id });
  }
  const card = await currentCard(code);
  return advance(couple, code, card.type === "duel" ? "duel" : card.type === "scene" ? "pass" : "done", winner);
}

const categoryOf = async (cardId) =>
  (
    await sql(
      `select f.category from public.protocol_cards c
       join public.protocol_card_families f on f.family_key = c.family_key
       where c.id = $1`,
      [cardId]
    )
  )[0]?.category;

test("au départ, une envie chacun ; les thèmes proposés ont des cartes", async () => {
  const couple = await createCouple();
  const code = await startTwoPhoneGame(couple);
  const g = await game(code);

  assert.equal(bonusOf(g, 1).desire, 1);
  assert.equal(bonusOf(g, 2).desire, 1);

  const categories = await rpc(playerOf(couple, g), "get_desire_categories", { p_game_code: code });
  assert.ok(categories.length > 0, "des thèmes à choisir");
  for (const c of categories) assert.ok(c.count >= 2);
});

test("l'envie : la prochaine carte vient du thème choisi, et les deux le voient", async () => {
  const couple = await createCouple();
  const code = await startTwoPhoneGame(couple);
  let g = await game(code);
  const chooser = g.active_player;

  const categories = await rpc(playerOf(couple, g), "get_desire_categories", { p_game_code: code });
  const theme = categories.sort((x, y) => y.count - x.count)[0].category;

  await rejects(rpc(otherOf(couple, g), "use_desire", { p_game_code: code, p_category: theme }), /only active player/i);
  await rpc(playerOf(couple, g), "use_desire", { p_game_code: code, p_category: theme });

  g = await game(code);
  assert.equal(bonusOf(g, chooser).desire, 0, "l'envie est engagée");
  assert.equal(bonusOf(g, chooser).desire_armed, theme);

  await finishTurn(couple, code, chooser === 1 ? 2 : 1);
  g = await game(code);
  assert.equal(await categoryOf(g.current_card_id), theme, "la carte suivante est du thème");
  assert.equal(bonusOf(g, chooser).desire_armed, undefined);

  for (const user of [couple.a, couple.b]) {
    const shown = await rpc(user, "get_protocol_current_card", { p_game_code: code });
    assert.deepEqual(shown.desire, { category: theme, by: chooser });
  }

  // une autre proposition reste dans le thème
  const before = g.current_card_id;
  await advance(couple, code, "alternative");
  g = await game(code);
  if (g.current_card_id !== before) {
    assert.equal(await categoryOf(g.current_card_id), theme, "l'autre proposition garde le thème");
  }

  // le tour suivant redevient normal
  await finishTurn(couple, code);
  const shown = await rpc(couple.a, "get_protocol_current_card", { p_game_code: code });
  assert.equal(shown.desire, null);
});

test("thème sans carte possible : tirage normal et envie rendue ; annuler la rend aussi", async () => {
  const couple = await createCouple();
  const code = await startTwoPhoneGame(couple);
  let g = await game(code);
  const chooser = g.active_player;

  await sql(
    `insert into public.protocol_card_families (family_key, category, category_position, style)
     values ('test_vide', 'Thème vide', 99, 'vanilla') on conflict (family_key) do nothing`
  );

  await rpc(playerOf(couple, g), "use_desire", { p_game_code: code, p_category: "Thème vide" });
  await finishTurn(couple, code, chooser === 1 ? 2 : 1);
  g = await game(code);
  assert.equal(g.turn_no, 2, "la partie avance");
  assert.equal(bonusOf(g, chooser).desire, 1, "l'envie est rendue");
  assert.equal(g.desire_category, null);

  // annuler avant la fin du tour rend l'envie
  await finishTurn(couple, code);
  g = await game(code);
  const user = playerOf(couple, g);
  const n = g.active_player;
  const left = bonusOf(g, n).desire;
  const categories = await rpc(user, "get_desire_categories", { p_game_code: code });
  await rpc(user, "use_desire", { p_game_code: code, p_category: categories[0].category });
  await rpc(user, "use_desire", { p_game_code: code, p_category: null });
  g = await game(code);
  assert.equal(bonusOf(g, n).desire, left);
  assert.equal(bonusOf(g, n).desire_armed, undefined);

  await rejects(rpc(user, "use_desire", { p_game_code: code, p_category: "N'existe pas" }), /unknown category/i);

  await sql("delete from public.protocol_card_families where family_key = 'test_vide'");
});

test("sans envie en main, impossible ; un duel gagné en redonne une, deux au plus", async () => {
  const couple = await createCouple();
  const code = await startTwoPhoneGame(couple);
  let g = await game(code);
  const n = g.active_player;
  const user = playerOf(couple, g);
  const categories = await rpc(user, "get_desire_categories", { p_game_code: code });

  await sql(
    `update public.games set bonus_player_${n} = jsonb_set(bonus_player_${n}, '{desire}', '0') where code = $1`,
    [code]
  );
  await rejects(rpc(user, "use_desire", { p_game_code: code, p_category: categories[0].category }), /no desire left/i);

  // duel gagné : +1, plafonné à 2
  await sql(
    `update public.games set bonus_player_${n} = jsonb_set(bonus_player_${n}, '{desire}', '2') where code = $1`,
    [code]
  );
  for (let i = 0; i < 40; i += 1) {
    g = await game(code);
    if (g.status !== "playing") break;
    if ((await currentCard(code)).type === "duel" && g.sealed_status !== "pending") {
      await advance(couple, code, "duel", n);
      g = await game(code);
      assert.equal(bonusOf(g, n).desire, 2, "jamais plus de deux");
      return;
    }
    await finishTurn(couple, code);
  }
});

test("STOP puis reprise : les envies restent ce qu'elles étaient", async () => {
  const couple = await createCouple();
  const code = await startTwoPhoneGame(couple);
  let g = await game(code);
  const n = g.active_player;
  const categories = await rpc(playerOf(couple, g), "get_desire_categories", { p_game_code: code });
  await rpc(playerOf(couple, g), "use_desire", { p_game_code: code, p_category: categories[0].category });

  await rpc(couple.a, "stop_protocol_game", { p_game_code: code });
  await rpc(couple.b, "resume_protocol_game", { p_game_code: code });
  g = await game(code);
  assert.equal(g.status, "playing");
  assert.equal(bonusOf(g, n).desire, 0, "la reprise ne redonne pas d'envie");
});

test("une seule autre proposition par tour, puis jouer ou passer", async () => {
  const couple = await createCouple();
  const code = await startTwoPhoneGame(couple);
  let g = await game(code);

  await advance(couple, code, "alternative");
  g = await game(code);
  assert.equal(g.alternative_used, true);
  const shown = await rpc(playerOf(couple, g), "get_protocol_current_card", { p_game_code: code });
  assert.equal(shown.alternative_used, true);

  await rejects(advance(couple, code, "alternative"), /one alternative per turn/i);

  await advance(couple, code, (await currentCard(code)).type === "duel" ? "duel" : "pass");
  g = await game(code);
  assert.equal(g.turn_no, 2);
  assert.equal(g.alternative_used, false, "nouveau tour, nouvelle proposition possible");
});
