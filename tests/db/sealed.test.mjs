// Cartes scellées : deux par joueur, cachées tant qu'elles ne sont pas
// acceptées, un cran plus chaudes, refus = carte normale, passer après
// avoir accepté = joker offert à l'autre.

import assert from "node:assert/strict";
import { after, test } from "node:test";

import {
  createCouple,
  currentCard,
  game,
  pool,
  rejects,
  rpc,
  startTwoPhoneGame,
} from "./helpers.mjs";

after(() => pool.end());

const playerOf = (couple, g) => (g.active_player === 1 ? couple.a : couple.b);
const otherOf = (couple, g) => (g.active_player === 1 ? couple.b : couple.a);

// avance d'un tour sans toucher aux cartes scellées (comme un appel direct)
async function advance(couple, code, action) {
  const g = await game(code);
  return rpc(playerOf(couple, g), "advance_protocol_guarded", {
    p_game_code: code,
    p_action: action,
    p_duel_winner: action === "duel" ? 1 : null,
    p_expected_turn_no: g.turn_no,
    p_expected_card_id: g.current_card_id,
    p_expected_card_source: g.current_card_source,
  });
}

async function finishTurn(couple, code) {
  const card = await currentCard(code);
  if (card.type === "duel") return advance(couple, code, "duel");
  if (card.type === "scene") return advance(couple, code, "pass");
  return advance(couple, code, "done");
}

// joue jusqu'à la prochaine carte scellée ; null si la partie finit avant
async function untilSealed(couple, code) {
  for (let i = 0; i < 40; i += 1) {
    const g = await game(code);
    if (g.status !== "playing") return null;
    if (g.sealed_status === "pending") return g;
    await finishTurn(couple, code);
  }
  return null;
}

async function sealedGame(intensity = [5, 5]) {
  for (let attempt = 0; attempt < 5; attempt += 1) {
    const couple = await createCouple();
    const code = await startTwoPhoneGame(couple, intensity);
    const g = await untilSealed(couple, code);
    if (g) return { couple, code, g };
  }
  throw new Error("aucune carte scellée en cinq parties");
}

test("une partie complète : une carte scellée par joueur, une dans chaque moitié, jamais d'affilée", async () => {
  const totals = [];

  for (let run = 0; run < 3; run += 1) {
    const couple = await createCouple();
    const code = await startTwoPhoneGame(couple);
    const seen = [];

    for (let i = 0; i < 60; i += 1) {
      const g = await game(code);
      if (g.status !== "playing") break;
      if (g.sealed_status === "pending") {
        const card = await currentCard(code);
        seen.push({ turn: g.turn_no, type: card.type, player: g.active_player });
        await rpc(playerOf(couple, g), "accept_sealed_card", { p_game_code: code, p_expected_card_id: g.current_card_id });
      }
      await finishTurn(couple, code);
    }

    const g = await game(code);
    assert.ok(g.sealed_used_p1 <= 1 && g.sealed_used_p2 <= 1, "une au plus par joueur");
    assert.equal(seen.length, g.sealed_used_p1 + g.sealed_used_p2);
    assert.equal(g.sealed_accepted, seen.length);
    for (const s of seen) {
      assert.ok(s.turn >= 4, `pas avant le 4e tour (${s.turn})`);
      assert.equal(s.type, "action");
    }
    if (seen.length === 2) {
      const half = Math.floor((4 + g.target_turns - 1) / 2);
      assert.notEqual(seen[0].player, seen[1].player);
      assert.ok(seen[0].turn <= half && seen[1].turn > half, `tours ${seen[0].turn}, ${seen[1].turn}`);
      assert.ok(seen[1].turn - seen[0].turn >= 2, "jamais d'affilée");
    }
    totals.push(seen.length);
  }

  // en pratique, deux par partie
  assert.ok(totals.every((n) => n === 2), `cartes scellées par partie : ${totals.join(", ")}`);
});

test("tant qu'elle n'est pas acceptée, la carte est cachée aux deux joueurs et bloque le tour", async () => {
  const { couple, code, g } = await sealedGame();
  const real = await currentCard(code);

  for (const user of [couple.a, couple.b]) {
    const shown = await rpc(user, "get_protocol_current_card", { p_game_code: code });
    assert.equal(shown.sealed, "pending");
    assert.equal(shown.title, "Carte scellée");
    assert.equal(shown.prompt, "");
    assert.ok(!JSON.stringify(shown).includes(real.prompt), "le texte ne fuit pas");
  }

  await rejects(advance(couple, code, "done"), /accepted or refused/i);
  await rejects(advance(couple, code, "alternative"), /accepted or refused/i);
  await rejects(
    rpc(otherOf(couple, g), "accept_sealed_card", { p_game_code: code, p_expected_card_id: g.current_card_id }),
    /not active player/i
  );

  const summary = await rpc(couple.a, "get_protocol_sealed_summary", { p_game_code: code });
  assert.equal(summary.status, "pending");
  assert.ok(summary.offered >= 1);
});

test("accepter : la carte se retourne, donne une envie, ne peut plus être changée", async () => {
  const { couple, code, g } = await sealedGame();
  const user = playerOf(couple, g);
  const bonusKey = g.active_player === 1 ? "bonus_player_1" : "bonus_player_2";

  // envie déjà utilisée, pour voir le gain
  await pool.query(
    `update public.games set ${bonusKey} = jsonb_set(coalesce(${bonusKey}, '{}'::jsonb), '{desire}', '0') where code = $1`,
    [code]
  );

  await rpc(user, "accept_sealed_card", { p_game_code: code, p_expected_card_id: g.current_card_id });

  const after = await game(code);
  assert.equal(after.sealed_status, "accepted");
  assert.equal(after[bonusKey].desire, 1, "une envie de gagnée");

  const shown = await rpc(user, "get_protocol_current_card", { p_game_code: code });
  assert.equal(shown.sealed, "accepted");
  assert.equal(shown.prompt, (await currentCard(code)).prompt);

  await rejects(advance(couple, code, "alternative"), /cannot be changed/i);

  await advance(couple, code, "done");
  const next = await game(code);
  assert.equal(next.turn_no, g.turn_no + 1);
  assert.notEqual(next.sealed_status, "accepted");
});

test("passer après avoir accepté : l'envie va à l'autre", async () => {
  const { couple, code, g } = await sealedGame();
  const otherKey = g.active_player === 1 ? "bonus_player_2" : "bonus_player_1";

  await pool.query(
    `update public.games set ${otherKey} = jsonb_set(coalesce(${otherKey}, '{}'::jsonb), '{desire}', '0') where code = $1`,
    [code]
  );

  await rpc(playerOf(couple, g), "accept_sealed_card", { p_game_code: code, p_expected_card_id: g.current_card_id });
  await rpc(playerOf(couple, g), "pass_sealed_card", { p_game_code: code, p_expected_card_id: g.current_card_id });

  const next = await game(code);
  assert.equal(next.turn_no, g.turn_no + 1);
  assert.equal(next[otherKey].desire, 1, "l'autre gagne une envie");
});

test("refuser compte comme l'autre proposition du tour", async () => {
  const { couple, code, g } = await sealedGame();

  await rpc(playerOf(couple, g), "refuse_sealed_card", { p_game_code: code, p_expected_card_id: g.current_card_id });
  const after = await rpc(playerOf(couple, g), "get_protocol_current_card", { p_game_code: code });
  assert.equal(after.alternative_used, true);
  await rejects(advance(couple, code, "alternative"), /one alternative per turn/i);
});

test("refuser : une carte normale la remplace, au même tour, sans joker", async () => {
  const { couple, code, g } = await sealedGame();
  const before = await currentCard(code);

  await rpc(playerOf(couple, g), "refuse_sealed_card", { p_game_code: code, p_expected_card_id: g.current_card_id });

  const after = await game(code);
  assert.equal(after.turn_no, g.turn_no);
  assert.equal(after.sealed_status, null);
  assert.notEqual(after.current_card_id, before.id);
  assert.equal(after.sealed_accepted, 0);

  const shown = await rpc(couple.a, "get_protocol_current_card", { p_game_code: code });
  assert.equal(shown.sealed, undefined);
});

test("réglage du couple : sans cartes scellées, aucune n'arrive", async () => {
  const couple = await createCouple();
  assert.equal(await rpc(couple.a, "get_protocol_sealed_enabled"), true, "actif par défaut");
  await rpc(couple.a, "set_protocol_sealed_enabled", { p_enabled: false });
  assert.equal(await rpc(couple.b, "get_protocol_sealed_enabled"), false, "réglage du couple");

  const code = await startTwoPhoneGame(couple);
  assert.equal(await untilSealed(couple, code), null);
  const g = await game(code);
  assert.equal(g.sealed_used_p1 + g.sealed_used_p2, 0);
});

test("un autre couple ne peut ni lire ni accepter la carte scellée", async () => {
  const { code, g } = await sealedGame();
  const stranger = await createCouple();

  await rejects(rpc(stranger.a, "get_protocol_sealed_summary", { p_game_code: code }), /denied|not found|not allowed|authentication/i);
  await rejects(
    rpc(stranger.a, "accept_sealed_card", { p_game_code: code, p_expected_card_id: g.current_card_id }),
    /denied|not found|not allowed|authentication/i
  );
  await rejects(rpc(stranger.a, "get_protocol_current_card", { p_game_code: code }), /denied|not found|not allowed|authentication/i);
});
