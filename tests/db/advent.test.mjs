// Calendrier de l'Avent : une case par jour, scellée côté serveur
// jusqu'à son jour, suivie par couple (ouverte, relevée).

import assert from "node:assert/strict";
import { after, before, test } from "node:test";

import { createCouple, pool, rejects, rpc, sql } from "./helpers.mjs";

// le « jour de l'Avent » dépend de la date : on le fixe pour le test
const setToday = (day) =>
  sql(`create or replace function public.protocol_advent_today()
       returns smallint language sql stable set search_path to ''
       as $$ select ${Number(day)}::smallint $$`);

let original;

before(async () => {
  [{ def: original }] = await sql(
    "select pg_get_functiondef('public.protocol_advent_today()'::regprocedure) as def"
  );

  await sql("delete from public.protocol_advent_days");
  await sql(`insert into public.protocol_advent_days (day, title, prompt)
             select d, 'Case ' || d, 'Défi synthétique ' || d
             from generate_series(1, 24) d`);
});

after(async () => {
  await sql(original);
  await sql("delete from public.protocol_advent_days");
  await pool.end();
});

test("avant décembre : toutes les cases scellées, texte jamais envoyé", async () => {
  await setToday(0);
  const { a } = await createCouple();

  const advent = await rpc(a, "get_protocol_advent");
  assert.equal(advent.days.length, 24);
  assert.ok(advent.days.every((d) => !d.unlocked && d.prompt === null && d.title === null));

  await rejects(rpc(a, "set_protocol_advent", { p_day: 1 }), /Not yet/);
});

test("le 3 décembre : cases 1 à 3 ouvertes, la 4 reste scellée", async () => {
  await setToday(3);
  const { a, b } = await createCouple();

  const advent = await rpc(a, "get_protocol_advent");
  assert.deepEqual(
    advent.days.filter((d) => d.unlocked).map((d) => d.day),
    [1, 2, 3]
  );
  assert.equal(advent.days[2].prompt, "Défi synthétique 3");
  assert.equal(advent.days[3].prompt, null);

  await rejects(rpc(a, "set_protocol_advent", { p_day: 4 }), /Not yet/);

  // ouverte par l'un, relevée : l'autre le voit
  await rpc(a, "set_protocol_advent", { p_day: 1 });
  await rpc(a, "set_protocol_advent", { p_day: 1, p_done: true });
  const seen = await rpc(b, "get_protocol_advent");
  assert.equal(seen.days[0].opened, true);
  assert.equal(seen.days[0].opened_by, a.id);
  assert.equal(seen.days[0].done, true);

  // un jour passé se rattrape, et « relevé » s'annule
  await rpc(b, "set_protocol_advent", { p_day: 2, p_done: true });
  await rpc(b, "set_protocol_advent", { p_day: 2, p_done: false });
  const again = await rpc(a, "get_protocol_advent");
  assert.equal(again.days[1].opened, true);
  assert.equal(again.days[1].done, false);
});

test("un autre couple ne voit pas notre progression", async () => {
  await setToday(5);
  const one = await createCouple();
  const two = await createCouple();

  await rpc(one.a, "set_protocol_advent", { p_day: 5, p_done: true });
  const other = await rpc(two.a, "get_protocol_advent");
  assert.equal(other.days[4].opened, false);
  assert.equal(other.days[4].done, false);
});

test("aperçu : réservé aux admins", async () => {
  await setToday(0);
  const { a } = await createCouple();

  const plain = await rpc(a, "get_protocol_advent", { p_preview: true });
  assert.equal(plain.preview, false);
  assert.ok(plain.days.every((d) => !d.unlocked));

  await sql("insert into public.protocol_admins (user_id) values ($1)", [a.id]);
  const preview = await rpc(a, "get_protocol_advent", { p_preview: true });
  assert.equal(preview.preview, true);
  assert.ok(preview.days.every((d) => d.unlocked && d.prompt));

  // l'aperçu ne fait que lire : ouvrir avant le jour reste refusé
  await rejects(rpc(a, "set_protocol_advent", { p_day: 24 }), /Not yet/);
});
