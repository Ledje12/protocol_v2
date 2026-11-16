// Dilemmes : deux choix sous une carte. Celui dont c'est le tour
// choisit une fois, l'autre le voit, personne d'autre n'y touche.

import assert from "node:assert/strict";
import { after, before, test } from "node:test";

import { createCouple, game, pool, rejects, rpc, sql, startTwoPhoneGame } from "./helpers.mjs";

let dilemma;
let plain;

before(async () => {
  [dilemma] = await sql(
    `insert into public.protocol_cards
       (type, title, prompt, intensity, active, library_version, library_key, choice_a, choice_b)
     values ('action', 'Dilemme test', 'Carte de test', 3, true, 'v1', 'test_choice_dilemma',
             'Option A', 'Option B')
     on conflict (library_key) do update set active = true
     returning id`
  );
  [plain] = await sql(
    `insert into public.protocol_cards
       (type, title, prompt, intensity, active, library_version, library_key)
     values ('action', 'Sans choix', 'Carte de test', 3, true, 'v1', 'test_choice_plain')
     on conflict (library_key) do update set active = true
     returning id`
  );
});

after(async () => {
  // des parties terminées pointent encore sur ces cartes : on les retire du jeu
  await sql("update public.protocol_cards set active = false where library_key like 'test_choice_%'");
  await pool.end();
});

// partie lancée, carte en cours forcée sur la carte voulue
async function gameOn(card) {
  const couple = await createCouple();
  const code = await startTwoPhoneGame(couple);
  await sql(
    "update public.games set current_card_id = $1, current_card_source = 'official' where code = $2",
    [card.id, code]
  );
  const state = await game(code);
  const [active, other] =
    state.active_player === 1 ? [couple.a, couple.b] : [couple.b, couple.a];
  return { code, active, other, state };
}

test("carte sans choix : rien à afficher, rien à choisir", async () => {
  const { code, active } = await gameOn(plain);

  assert.equal(await rpc(active, "get_card_choice", { p_game_code: code }), null);
  await rejects(
    rpc(active, "set_card_choice", { p_game_code: code, p_choice: 1 }),
    /No choice on this card/
  );
});

test("le joueur dont c'est le tour choisit, l'autre le voit", async () => {
  const { code, active, other, state } = await gameOn(dilemma);

  const before = await rpc(other, "get_card_choice", { p_game_code: code });
  assert.deepEqual(before.options, ["Option A", "Option B"]);
  assert.equal(before.choice, null);
  assert.equal(before.can_choose, false, "l'autre attend");
  assert.equal(
    (await rpc(active, "get_card_choice", { p_game_code: code })).can_choose,
    true
  );

  const mine = await rpc(active, "set_card_choice", { p_game_code: code, p_choice: 2 });
  assert.equal(mine.choice, 2);
  assert.equal(mine.chosen_by, state.active_player);
  assert.equal(mine.can_choose, false);

  const seen = await rpc(other, "get_card_choice", { p_game_code: code });
  assert.equal(seen.choice, 2);
  assert.equal(seen.chosen_by, state.active_player);
});

test("on ne change pas d'avis : le premier choix reste", async () => {
  const { code, active } = await gameOn(dilemma);

  await rpc(active, "set_card_choice", { p_game_code: code, p_choice: 1 });
  const again = await rpc(active, "set_card_choice", { p_game_code: code, p_choice: 2 });

  assert.equal(again.choice, 1);
});

test("ni l'autre joueur, ni un autre couple, ni une valeur hors 1 ou 2", async () => {
  const { code, active, other } = await gameOn(dilemma);
  const strangers = await createCouple();

  await rejects(
    rpc(other, "set_card_choice", { p_game_code: code, p_choice: 1 }),
    /Not your turn/
  );
  await rejects(
    rpc(strangers.a, "set_card_choice", { p_game_code: code, p_choice: 1 }),
    /Access to game denied/
  );
  await rejects(
    rpc(strangers.a, "get_card_choice", { p_game_code: code }),
    /Access to game denied/
  );
  await rejects(
    rpc(active, "set_card_choice", { p_game_code: code, p_choice: 3 }),
    /Invalid choice/
  );
  assert.equal((await rpc(active, "get_card_choice", { p_game_code: code })).choice, null);
});

test("le choix appartient à la carte jouée : rien ne déborde sur la suivante", async () => {
  const { code, active } = await gameOn(dilemma);

  await rpc(active, "set_card_choice", { p_game_code: code, p_choice: 1 });
  await sql("update public.games set turn_no = turn_no + 1 where code = $1", [code]);

  const next = await rpc(active, "get_card_choice", { p_game_code: code });
  assert.equal(next.choice, null);
});

test("un libellé seul est refusé : les deux choix vont ensemble", async () => {
  await rejects(
    sql("update public.protocol_cards set choice_a = 'Seul' where id = $1", [plain.id]),
    /protocol_cards_choices_check/
  );
});
