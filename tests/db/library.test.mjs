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

test("la vue des cartes jouables n'est pas lisible via l'API", async () => {
  const { a } = await createCouple();

  // seules les fonctions du jeu s'en servent ; directement : refusé
  await rejects(
    asUser(a, "select count(*) from public.protocol_playable_cards"),
    /permission denied/
  );

  const client = await pool.connect();

  try {
    await client.query("begin");
    await client.query("set local role anon");
    await rejects(
      client.query("select count(*) from public.protocol_playable_cards"),
      /permission denied/
    );
  } finally {
    await client.query("rollback").catch(() => {});
    client.release();
  }
});

test("nos favoris : seulement les cartes notées 🔥 par les deux", async () => {
  const { a, b } = await createCouple();
  const other = await createCouple();
  const [x, y, z] = await sql("select id from public.protocol_cards order by id limit 3");
  const rate = (user, card, rating) =>
    rpc(user, "set_card_rating", { p_card_source: "official", p_card_id: card.id, p_rating: rating });

  await rate(a, x, "fire");
  await rate(b, x, "fire"); // 🔥 + 🔥 : favori
  await rate(a, y, "fire");
  await rate(b, y, "like"); // 🔥 + 👍 : non
  await rate(a, z, "fire"); // un seul avis : non
  await rate(other.a, z, "fire"); // l'autre duo ne compte pas

  const favorites = await rpc(a, "get_couple_favorites");
  assert.deepEqual(favorites, [{ card_source: "official", card_id: String(x.id) }]);
  assert.deepEqual(await rpc(b, "get_couple_favorites"), favorites, "les mêmes pour les deux");
  assert.deepEqual(await rpc(other.a, "get_couple_favorites"), []);
});

test("modifier une carte : consigne et intensité, comptes autorisés seulement", async () => {
  const { a, b } = await createCouple();
  const [card] = await sql("select id, title from public.protocol_cards order by id limit 1");
  const edit = (user, prompt, intensity) =>
    rpc(user, "update_protocol_card", { p_card_id: card.id, p_prompt: prompt, p_intensity: intensity });

  assert.equal(await rpc(a, "protocol_is_admin"), false);
  await rejects(edit(a, "Nouvelle consigne.", 3), /not allowed/i);

  await sql("insert into public.protocol_admins (user_id) values ($1)", [a.id]);
  assert.equal(await rpc(a, "protocol_is_admin"), true);
  assert.equal(await rpc(b, "protocol_is_admin"), false, "l'autre n'a pas le droit");
  await rejects(edit(b, "Nouvelle consigne.", 3), /not allowed/i);

  const saved = await edit(a, "  Nouvelle consigne pour {{partner}}.  ", 4);
  assert.deepEqual(saved, { id: Number(card.id), prompt: "Nouvelle consigne pour {{partner}}.", intensity: 4 });
  const [after] = await sql("select title, prompt, intensity from public.protocol_cards where id = $1", [card.id]);
  assert.equal(after.title, card.title, "le titre ne change pas");
  assert.equal(after.intensity, 4);

  await rejects(edit(a, "   ", 3), /invalid prompt/i);
  await rejects(edit(a, "Consigne.", 6), /invalid intensity/i);

  // la table n'est pas modifiable directement, ni la liste lisible
  await rejects(asUser(a, "select * from public.protocol_admins"), /permission denied/);
  const direct = await asUser(b, "update public.protocol_cards set prompt = 'x' where id = $1", [card.id]);
  assert.equal(direct.rowCount, 0);
});
