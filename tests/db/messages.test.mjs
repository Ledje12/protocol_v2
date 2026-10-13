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

test("message programmé : invisible pour l'autre, annulable, déposé une seule fois à l'heure", async () => {
  const { a, b, coupleId } = await createCouple();
  const inOneHour = new Date(Date.now() + 3600e3).toISOString();

  const scheduled = await rpc(a, "schedule_protocol_message", {
    p_body: "Ce soir, robe noire.",
    p_send_at: inOneHour,
  });
  const other = await rpc(a, "schedule_protocol_message", {
    p_body: "À annuler.",
    p_send_at: inOneHour,
  });

  assert.equal((await rpc(a, "get_my_scheduled_messages")).length, 2);
  assert.deepEqual(await rpc(b, "get_my_scheduled_messages"), [], "surprise : rien chez l'autre");
  await rejects(asUser(b, "select * from public.protocol_scheduled_messages"), /permission denied/);
  await rejects(rpc(b, "cancel_scheduled_message", { p_id: scheduled.id }), /not found/i);
  assert.equal(await rpc(a, "cancel_scheduled_message", { p_id: other.id }), true);

  // pas dans le passé, ni à plus de 7 jours
  await rejects(
    rpc(a, "schedule_protocol_message", { p_body: "x", p_send_at: new Date(Date.now() - 60e3).toISOString() }),
    /invalid send time/i
  );
  await rejects(
    rpc(a, "schedule_protocol_message", { p_body: "x", p_send_at: new Date(Date.now() + 8 * 86400e3).toISOString() }),
    /invalid send time/i
  );

  // pas encore l'heure : rien
  assert.equal((await sql("select * from public.protocol_deliver_scheduled_messages()")).length, 0);

  // l'heure est venue
  await sql("update public.protocol_scheduled_messages set send_at = now() - interval '1 second' where id = $1", [scheduled.id]);
  const delivered = await sql("select * from public.protocol_deliver_scheduled_messages()");
  assert.equal(delivered.length, 1);
  assert.equal(delivered[0].recipient_user_id, b.id);
  assert.equal(delivered[0].sender_name, "Alex");
  assert.equal((await sql("select * from public.protocol_deliver_scheduled_messages()")).length, 0, "une seule fois");

  const { rows } = await asUser(b, "select body, sender_user_id from public.protocol_messages where couple_id = $1", [coupleId]);
  assert.deepEqual(rows, [{ body: "Ce soir, robe noire.", sender_user_id: a.id }]);
  assert.deepEqual(await rpc(a, "get_my_scheduled_messages"), []);

  // le serveur seul dépose les messages
  await rejects(asUser(a, "select * from public.protocol_deliver_scheduled_messages()"), /permission denied/);
});
