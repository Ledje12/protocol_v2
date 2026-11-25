// « Une idée, un souci ? » : les messages des joueurs arrivent dans
// protocol_feedback, par une fonction ; l'app ne peut pas les lire.

import assert from "node:assert/strict";
import { after, test } from "node:test";

import {
  asUser,
  createCouple,
  createUser,
  pool,
  rejects,
  rpc,
  sql,
  startTwoPhoneGame,
} from "./helpers.mjs";

after(() => pool.end());

const send = (user, args) =>
  rpc(user, "submit_protocol_feedback", {
    p_kind: "idea",
    p_body: "Une idée",
    p_game_id: null,
    p_app_version: "2.0",
    ...args,
  });

const mine = (user) =>
  sql("select * from public.protocol_feedback where user_id = $1 order by id", [user.id]);

test("un message arrive avec le prénom et la version", async () => {
  const user = await createUser("Nora", "female");

  await send(user, { p_kind: "card", p_body: "  Une carte avec les téléphones échangés  " });

  const [row] = await mine(user);
  assert.equal(row.display_name, "Nora");
  assert.equal(row.kind, "card");
  assert.equal(row.body, "Une carte avec les téléphones échangés");
  assert.equal(row.app_version, "2.0");
  assert.equal(row.game_id, null);
});

test("message vide ou type inconnu : refusé", async () => {
  const user = await createUser("Theo", "male");

  await rejects(send(user, { p_body: "   " }), /Message vide/);
  await rejects(send(user, { p_kind: "spam" }), /Type de message inconnu/);
  assert.equal((await mine(user)).length, 0);
});

test("la partie n'est retenue que si l'auteur y joue", async () => {
  const couple = await createCouple();
  const code = await startTwoPhoneGame(couple);
  const [{ id: gameId }] = await sql("select id from public.games where code = $1", [code]);
  const outsider = await createUser("Zoe", "female");

  await send(couple.a, { p_game_id: gameId });
  await send(outsider, { p_game_id: gameId });

  assert.equal((await mine(couple.a))[0].game_id, gameId);
  assert.equal((await mine(outsider))[0].game_id, null);
});

test("pas plus de 20 messages par jour", async () => {
  const user = await createUser("Lou", "female");

  for (let i = 0; i < 20; i += 1) {
    await send(user, { p_body: `Message ${i}` });
  }

  await rejects(send(user), /réessaie demain/);
});

test("l'app ne lit pas les messages", async () => {
  const user = await createUser("Max", "male");
  await send(user);

  // RLS sans policy (et, en prod, aucun grant) : rien ne remonte
  const read = await asUser(user, "select * from public.protocol_feedback")
    .then((result) => result.rows)
    .catch(() => []);
  assert.equal(read.length, 0);
});
