// Lovense à deux jouets : une carte « required » ne sort que si son
// jouet (Lush, anneau Diamo, ou les deux) est connecté, quel que soit
// le téléphone qui le tient.

import assert from "node:assert/strict";
import { after, before, test } from "node:test";

import { asUser, createCouple, pool, sql } from "./helpers.mjs";

const cards = {};

before(async () => {
  for (const toy of ["lush", "ring", "both", "any"]) {
    const [card] = await sql(
      `insert into public.protocol_cards
         (type, title, prompt, intensity, active, library_version, library_key,
          lovense_mode, lovense_toy)
       values ('action', $1, 'Carte Lovense de test', 3, true, 'v1', $2,
               'required', $3)
       returning id`,
      [`Lovense ${toy}`, `test_lovense_${toy}`, toy === "any" ? null : toy]
    );
    cards[toy] = card.id;
  }

  const [plain] = await sql(
    `insert into public.protocol_cards
       (type, title, prompt, intensity, active, library_version, library_key)
     values ('action', 'Carte normale', 'Carte de test', 3, true, 'v1',
             'test_lovense_plain')
     returning id`
  );
  cards.plain = plain.id;
});

after(async () => {
  await sql("delete from public.protocol_cards where library_key like 'test_lovense_%'");
  await pool.end();
});

// format du SDK (tableau, connected) et format du QR (objet, status 1)
const sdkToys = (...names) =>
  JSON.stringify(names.map((name, i) => ({ id: `sdk${i}`, name, connected: true })));
const qrToys = (...names) =>
  JSON.stringify(
    Object.fromEntries(names.map((name, i) => [`qr${i}`, { id: `qr${i}`, name, status: 1 }]))
  );

async function connect(couple, user, toys) {
  await sql(
    `insert into public.protocol_lovense_connections
       (lovense_uid, toys, user_id, couple_id, connected_at)
     values (gen_random_uuid()::text, $1::jsonb, $2, $3, now())`,
    [toys, user.id, couple.coupleId]
  );
}

async function allowed(couple) {
  const result = {};
  for (const [toy, id] of Object.entries(cards)) {
    const [row] = await sql("select public.protocol_lovense_card_allowed($1, $2) as ok", [
      couple.coupleId,
      id,
    ]);
    result[toy] = row.ok;
  }
  return result;
}

test("aucun jouet : seules les cartes normales sortent", async () => {
  const couple = await createCouple();
  assert.deepEqual(await allowed(couple), {
    lush: false,
    ring: false,
    both: false,
    any: false,
    plain: true,
  });
});

test("Lush seul : aucune carte anneau ne sort", async () => {
  const couple = await createCouple();
  await connect(couple, couple.a, sdkToys("Lush 4"));
  assert.deepEqual(await allowed(couple), {
    lush: true,
    ring: false,
    both: false,
    any: true,
    plain: true,
  });
});

test("anneau seul (rappel du QR) : aucune carte Lush ne sort", async () => {
  const couple = await createCouple();
  await connect(couple, couple.b, qrToys("diamo"));
  assert.deepEqual(await allowed(couple), {
    lush: false,
    ring: true,
    both: false,
    any: true,
    plain: true,
  });
});

test("les deux jouets sur un seul téléphone : tout sort, duel compris", async () => {
  const couple = await createCouple();
  await connect(couple, couple.a, sdkToys("lush", "Diamo"));
  assert.deepEqual(await allowed(couple), {
    lush: true,
    ring: true,
    both: true,
    any: true,
    plain: true,
  });
});

test("un jouet chacun sur son téléphone : le duel sort aussi", async () => {
  const couple = await createCouple();
  await connect(couple, couple.a, sdkToys("Lush 4"));
  await connect(couple, couple.b, qrToys("diamo"));
  assert.equal((await allowed(couple)).both, true);
});

test("un jouet hors ligne ne compte pas", async () => {
  const couple = await createCouple();
  await connect(
    couple,
    couple.a,
    JSON.stringify([
      { id: "x", name: "Lush 4", connected: false },
      { id: "y", name: "Diamo", connected: true },
    ])
  );
  const result = await allowed(couple);
  assert.equal(result.lush, false);
  assert.equal(result.ring, true);
});

test("une carte Lovense ne peut plus être « optional »", async () => {
  await assert.rejects(
    sql(
      `insert into public.protocol_cards
         (type, title, prompt, intensity, active, library_version, library_key,
          lovense_mode, lovense_toy)
       values ('action', 'Optionnelle', 'Carte de test', 3, true, 'v1',
               'test_lovense_optional', 'optional', 'lush')`
    ),
    /protocol_cards_lovense_mode_check/
  );
});

test("jouet au tiroir : un état de plus de 24 h ne fait plus sortir les cartes", async () => {
  const couple = await createCouple();
  await connect(couple, couple.a, sdkToys("Lush", "Diamo"));

  assert.equal((await allowed(couple)).both, true);

  await sql(
    `update public.protocol_lovense_connections
        set updated_at = now() - interval '25 hours'
      where couple_id = $1`,
    [couple.coupleId]
  );

  assert.deepEqual(await allowed(couple), {
    lush: false, ring: false, both: false, any: false, plain: true,
  });
});

test("état partagé des jouets : lisible par le couple seulement, jamais modifiable depuis l'app", async () => {
  const couple = await createCouple();
  const strangers = await createCouple();

  await sql(
    `insert into public.protocol_lovense_toy_state (couple_id, toy_id, level, updated_by)
     values ($1, 'toy-1', 12, $2)`,
    [couple.coupleId, couple.a.id]
  );

  const read = (user) =>
    asUser(user, "select toy_id, level from public.protocol_lovense_toy_state");

  assert.deepEqual((await read(couple.a)).rows, [{ toy_id: "toy-1", level: 12 }]);
  assert.deepEqual((await read(couple.b)).rows, [{ toy_id: "toy-1", level: 12 }]);
  assert.deepEqual((await read(strangers.a)).rows, []);

  await assert.rejects(
    asUser(couple.a, "update public.protocol_lovense_toy_state set level = 20"),
    /permission denied/
  );
  await assert.rejects(
    asUser(
      couple.a,
      "insert into public.protocol_lovense_toy_state (couple_id, toy_id) values ($1, 'x')",
      [couple.coupleId]
    ),
    /permission denied/
  );
});
