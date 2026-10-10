// Journal des erreurs : l'app peut écrire, personne ne peut lire
// depuis l'app, et une boucle d'erreurs est plafonnée.

import assert from "node:assert/strict";
import { after, test } from "node:test";

import { asUser, createUser, pool, rejects, rpc, sql } from "./helpers.mjs";

after(() => pool.end());

const log = (user, message, extra = {}) =>
  rpc(user, "log_client_error", {
    p_source: "screen",
    p_message: message,
    p_stack: null,
    p_app_version: "test",
    p_user_agent: "node",
    p_context: { path: "/game/:code/play" },
    ...extra,
  });

test("une erreur est notée avec le compte, la page et la version", async () => {
  const user = await createUser("Alex", "male");

  assert.equal(await log(user, "CHOOSE TYPE ERROR: boom"), true);

  const [row] = await sql(
    "select * from public.protocol_client_errors where user_id = $1",
    [user.id]
  );
  assert.equal(row.message, "CHOOSE TYPE ERROR: boom");
  assert.equal(row.source, "screen");
  assert.equal(row.app_version, "test");
  assert.deepEqual(row.context, { path: "/game/:code/play" });
});

test("le journal est illisible et non modifiable depuis l'app", async () => {
  const user = await createUser("Bea", "female");
  await log(user, "secret");

  await rejects(
    asUser(user, "select * from public.protocol_client_errors"),
    /permission denied/i
  );
  await rejects(
    asUser(user, "delete from public.protocol_client_errors"),
    /permission denied/i
  );
});

test("textes tronqués, message vide ignoré, boucle plafonnée à 30 par heure", async () => {
  const user = await createUser("Alex", "male");

  assert.equal(await log(user, "   "), false);
  await log(user, "x".repeat(5000), { p_context: [1, 2] });

  const [row] = await sql(
    "select length(message) as n, context from public.protocol_client_errors where user_id = $1",
    [user.id]
  );
  assert.equal(row.n, 1000);
  assert.deepEqual(row.context, {}, "contexte invalide remplacé");

  for (let i = 0; i < 40; i += 1) {
    await log(user, `boucle ${i}`);
  }

  const [{ count }] = await sql(
    "select count(*)::int from public.protocol_client_errors where user_id = $1",
    [user.id]
  );
  assert.equal(count, 30);
});
