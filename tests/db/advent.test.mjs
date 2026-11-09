// Calendrier de l'Avent : une case par jour, scellée côté serveur
// jusqu'à son jour, suivie par couple (ouverte, relevée).

import assert from "node:assert/strict";
import { after, before, test } from "node:test";

import { asUser, createCouple, pool, rejects, rpc, sql } from "./helpers.mjs";

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
  await sql(`insert into public.protocol_advent_days
               (day, title, prompt, soft_title, soft_prompt, black_title, black_prompt)
             select d, 'Case ' || d, 'Défi synthétique ' || d,
                    'Douce ' || d, 'Version douce ' || d,
                    case when d in (3, 9) then 'Noire ' || d end,
                    case when d in (3, 9) then 'Version noire ' || d end
             from generate_series(1, 24) d`);
  await sql(`insert into storage.objects (bucket_id, name)
             select 'protocol-advent', 'jour-' || lpad(d::text, 2, '0') || '.webp'
             from generate_series(1, 24) d
             on conflict do nothing`);
});

after(async () => {
  await sql(original);
  await sql("delete from public.protocol_advent_days");
  await sql("delete from storage.objects where bucket_id = 'protocol-advent'");
  await pool.end();
});

test("avant décembre : toutes les cases scellées, texte jamais envoyé", async () => {
  await setToday(0);
  const { a } = await createCouple();

  const advent = await rpc(a, "get_protocol_advent");
  assert.equal(advent.days.length, 24);
  assert.ok(
    advent.days.every(
      (d) => !d.unlocked && d.prompt === null && d.title === null && d.soft_prompt === null
    )
  );

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
  assert.equal(advent.days[2].soft_prompt, "Version douce 3");
  assert.equal(advent.days[3].prompt, null);
  assert.equal(advent.days[3].soft_prompt, null);

  await rejects(rpc(a, "set_protocol_advent", { p_day: 4 }), /Not yet/);

  // ouverte par l'un, relevée : l'autre le voit
  await rpc(a, "set_protocol_advent", { p_day: 1 });
  await rpc(a, "set_protocol_advent", { p_day: 1, p_done: true });
  const seen = await rpc(b, "get_protocol_advent");
  assert.equal(seen.days[0].opened, true);
  assert.equal(seen.days[0].opened_by, a.id);
  assert.equal(seen.days[0].done, true);
  assert.equal(seen.days[0].done_variant, "bold");

  // version douce relevée : c'est elle qui est retenue
  await rpc(b, "set_protocol_advent", { p_day: 3, p_done: true, p_variant: "soft" });
  const soft = await rpc(a, "get_protocol_advent");
  assert.equal(soft.days[2].done_variant, "soft");
  await rejects(
    rpc(a, "set_protocol_advent", { p_day: 3, p_done: true, p_variant: "autre" }),
    /Invalid variant/
  );

  // un jour passé se rattrape, et « relevé » s'annule
  await rpc(b, "set_protocol_advent", { p_day: 2, p_done: true });
  await rpc(b, "set_protocol_advent", { p_day: 2, p_done: false });
  const again = await rpc(a, "get_protocol_advent");
  assert.equal(again.days[1].opened, true);
  assert.equal(again.days[1].done, false);
  assert.equal(again.days[1].done_variant, null);
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

test("carte noire : annoncée sur la case, texte scellé jusqu'au jour", async () => {
  await setToday(3);
  const { a } = await createCouple();

  const advent = await rpc(a, "get_protocol_advent");
  assert.equal(advent.days[2].black_prompt, "Version noire 3");
  assert.equal(advent.days[8].has_black, true);
  assert.equal(advent.days[8].black_prompt, null);
  assert.equal(advent.days[4].has_black, false);

  await rpc(a, "set_protocol_advent", { p_day: 3, p_done: true, p_variant: "black" });
  const done = await rpc(a, "get_protocol_advent");
  assert.equal(done.days[2].done_variant, "black");
});

test("illustrations : lisibles seulement à partir de leur jour", async () => {
  await setToday(3);
  const { a } = await createCouple();
  const visible = async (user) =>
    (
      await asUser(
        user,
        "select name from storage.objects where bucket_id = 'protocol-advent' order by name"
      )
    ).rows.map((row) => row.name);

  assert.deepEqual(await visible(a), ["jour-01.webp", "jour-02.webp", "jour-03.webp"]);

  await sql("insert into public.protocol_admins (user_id) values ($1)", [a.id]);
  assert.equal((await visible(a)).length, 24);
});

test("case 0 : l'invitation s'ouvre avant le 1er décembre", async () => {
  await setToday(0);
  await sql(`insert into public.protocol_advent_days (day, title, prompt)
             values (0, 'Invitation', 'Les règles du jeu')
             on conflict (day) do nothing`);
  const { a, b } = await createCouple();

  const advent = await rpc(a, "get_protocol_advent");
  const invitation = advent.days.find((d) => d.day === 0);
  assert.equal(invitation.unlocked, true);
  assert.equal(invitation.prompt, "Les règles du jeu");
  assert.ok(advent.days.filter((d) => d.day > 0).every((d) => !d.unlocked));

  await rpc(a, "set_protocol_advent", { p_day: 0, p_done: true });
  const seen = await rpc(b, "get_protocol_advent");
  assert.equal(seen.days.find((d) => d.day === 0).done, true);

  await sql("insert into storage.objects (bucket_id, name) values ('protocol-advent', 'jour-00.webp') on conflict do nothing");
  const images = (
    await asUser(a, "select name from storage.objects where bucket_id = 'protocol-advent'")
  ).rows.map((row) => row.name);
  assert.deepEqual(images, ["jour-00.webp"]);

  await sql("delete from public.protocol_advent_days where day = 0");
});
