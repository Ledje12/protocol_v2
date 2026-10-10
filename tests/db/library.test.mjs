// Bibliothèque : cartes et catégories lisibles par les joueurs,
// avis 🔥/👍/👎 privés, réglage du style de cartes.

import assert from "node:assert/strict";
import { after, test } from "node:test";

import { asUser, createCouple, pool, rejects, rpc, sql } from "./helpers.mjs";

after(() => pool.end());

test("un joueur voit toutes les cartes actives et leurs catégories", async () => {
  const { a } = await createCouple();
  const [{ total }] = await sql(
    "select count(*)::int as total from public.protocol_cards where active"
  );

  const cards = await asUser(
    a,
    "select count(*)::int as n from public.protocol_cards where active"
  );
  assert.equal(cards.rows[0].n, total);

  const families = await asUser(
    a,
    `select count(*)::int as n, count(distinct category)::int as categories
     from public.protocol_card_families`
  );
  assert.ok(families.rows[0].n > 100);
  assert.equal(families.rows[0].categories, 15);

  // chaque carte du jeu de test est rangée dans une catégorie
  const orphans = await sql(
    `select count(*)::int as n from public.protocol_cards c
     left join public.protocol_card_families f using (family_key)
     where c.active and f.family_key is null`
  );
  assert.equal(orphans[0].n, 0);
});

test("les avis sont privés : chacun ne voit que les siens", async () => {
  const { a, b } = await createCouple();
  const [{ id }] = await sql("select id from public.protocol_cards limit 1");
  const ratings = (user) =>
    asUser(user, "select card_id, rating from public.protocol_card_ratings");

  assert.equal(
    await rpc(a, "set_card_rating", {
      p_card_source: "official",
      p_card_id: id,
      p_rating: "fire",
    }),
    "fire"
  );

  assert.deepEqual((await ratings(a)).rows, [{ card_id: String(id), rating: "fire" }]);
  assert.deepEqual((await ratings(b)).rows, [], "l'autre ne voit pas l'avis");

  // retoucher l'avis actif le retire
  await rpc(a, "set_card_rating", {
    p_card_source: "official",
    p_card_id: id,
    p_rating: null,
  });
  assert.deepEqual((await ratings(a)).rows, []);

  await rejects(
    rpc(a, "set_card_rating", {
      p_card_source: "official",
      p_card_id: id,
      p_rating: "bof",
    }),
    /invalid rating/i
  );
});

test("le style de cartes est partagé par le couple", async () => {
  const { a, b } = await createCouple();

  assert.equal(await rpc(a, "get_protocol_card_style"), "both");
  await rpc(a, "set_protocol_card_style", { p_style: "kinky" });
  assert.equal(await rpc(b, "get_protocol_card_style"), "kinky");

  await rejects(
    rpc(a, "set_protocol_card_style", { p_style: "autre" }),
    /invalid card style/i
  );
});
