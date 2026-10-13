// Messages : réactions ❤️ / 🔥 / 👍🏼 posées par le destinataire.

import assert from "node:assert/strict";
import { after, test } from "node:test";

import { asUser, createCouple, pool, rejects, rpc, sql } from "./helpers.mjs";

after(() => pool.end());

async function newMessage({ a, b, coupleId }) {
  const [{ id }] = await sql(
    `insert into public.protocol_messages (body, sender_user_id, recipient_user_id, couple_id)
     values ('Bonsoir', $1, $2, $3) returning id`,
    [a.id, b.id, coupleId]
  );
  return id;
}

const reactionOf = async (user, id) =>
  (await asUser(user, "select reaction from public.protocol_messages where id = $1", [id]))
    .rows[0].reaction;

test("le destinataire réagit, change d'avis, retire sa réaction", async () => {
  const couple = await createCouple();
  const id = await newMessage(couple);

  await rpc(couple.b, "set_protocol_message_reaction", { p_message_id: id, p_reaction: "🔥" });
  assert.equal(await reactionOf(couple.a, id), "🔥", "l'expéditeur la voit");

  await rpc(couple.b, "set_protocol_message_reaction", { p_message_id: id, p_reaction: "❤️" });
  assert.equal(await reactionOf(couple.b, id), "❤️");

  await rpc(couple.b, "set_protocol_message_reaction", { p_message_id: id, p_reaction: null });
  assert.equal(await reactionOf(couple.a, id), null);
});

test("chacun sa réaction : l'expéditeur réagit sans écraser le destinataire", async () => {
  const couple = await createCouple();
  const id = await newMessage(couple);

  await rpc(couple.b, "set_protocol_message_reaction", { p_message_id: id, p_reaction: "🔥" });
  await rpc(couple.a, "set_protocol_message_reaction", { p_message_id: id, p_reaction: "❤️" });

  const { rows } = await asUser(
    couple.b,
    "select reaction, sender_reaction from public.protocol_messages where id = $1",
    [id]
  );
  assert.deepEqual(rows[0], { reaction: "🔥", sender_reaction: "❤️" });
});

test("on ne réagit ni au message d'un autre duo, ni avec n'importe quoi", async () => {
  const couple = await createCouple();
  const other = await createCouple();
  const id = await newMessage(couple);

  await rejects(
    rpc(other.b, "set_protocol_message_reaction", { p_message_id: id, p_reaction: "❤️" }),
    /Message not found/
  );
  await rejects(
    rpc(couple.b, "set_protocol_message_reaction", { p_message_id: id, p_reaction: "💩" }),
    /Invalid reaction/
  );

  // et pas d'écriture directe dans la table
  await rejects(
    asUser(couple.b, "update public.protocol_messages set reaction = '🔥' where id = $1", [id]),
    /permission denied/
  );
});

test("notifications discrètes : chacun règle la sienne, pas celle de l'autre", async () => {
  const { a, b } = await createCouple();

  await asUser(a, "update public.protocol_profiles set discreet_notifications = true where user_id = $1", [a.id]);
  // l'autre profil n'est pas modifiable (0 ligne touchée)
  const other = await asUser(a, "update public.protocol_profiles set discreet_notifications = true where user_id = $1", [b.id]);
  assert.equal(other.rowCount, 0);

  const rows = await sql(
    "select user_id, discreet_notifications from public.protocol_profiles where user_id in ($1, $2)",
    [a.id, b.id]
  );
  const byUser = Object.fromEntries(rows.map((row) => [row.user_id, row.discreet_notifications]));
  assert.deepEqual(byUser, { [a.id]: true, [b.id]: false });
});
