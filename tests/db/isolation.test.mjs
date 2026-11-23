// Étanchéité entre couples : un couple remplit la base (partie, cartes
// perso, avis, signalement, message, photo, réglages), un autre couple
// essaie de tout lire, directement et par les fonctions de l'app.

import assert from "node:assert/strict";
import { after, test } from "node:test";

import {
  asUser,
  createCouple,
  game,
  play,
  pool,
  rejects,
  rpc,
  sql,
  startTwoPhoneGame,
} from "./helpers.mjs";

after(() => pool.end());

// Remplit tout ce qu'un couple peut laisser dans la base.
async function fillCouple(couple, tag) {
  const { a, b, coupleId } = couple;

  const code = await startTwoPhoneGame(couple);

  const [{ id: customId }] = await sql(
    `insert into public.protocol_custom_cards (couple_id, created_by, type, title, prompt, intensity)
     values ($1, $2, 'action', $3, $4, 2) returning id`,
    [coupleId, a.id, `Carte ${tag}`, `Consigne ${tag}`]
  );

  const [{ id: officialId }] = await sql("select id from public.protocol_cards limit 1");
  await rpc(a, "set_card_rating", { p_card_source: "official", p_card_id: officialId, p_rating: "fire" });
  await rpc(b, "set_card_rating", { p_card_source: "custom", p_card_id: customId, p_rating: "fire" });
  await rpc(a, "report_protocol_card", { p_card_source: "official", p_card_id: officialId, p_reason: "autre" });

  await sql(
    `insert into public.protocol_messages (body, sender_user_id, recipient_user_id, couple_id)
     values ($4, $1, $2, $3)`,
    [a.id, b.id, coupleId, `Message ${tag}`]
  );

  await rpc(a, "set_protocol_album_key", {
    p_salt: Buffer.from(`sel-du-couple-${tag}`).toString("base64"),
    p_check: Buffer.from(`temoin-du-couple-${tag}`).toString("base64"),
  });
  const photo = await rpc(a, "create_protocol_photo", {
    p_mime: "image/jpeg", p_byte_size: 1000, p_thumb_size: 100, p_width: 1, p_height: 1,
  });
  await rpc(a, "finish_protocol_photo", { p_photo_id: photo.id });

  return { code, customId, photoId: photo.id, gameId: (await game(code)).id };
}

// Toutes les tables de « public », lues en tant que joueur.
async function visibleRows(user) {
  const tables = await sql(
    `select table_name from information_schema.tables
     where table_schema = 'public' and table_type = 'BASE TABLE'`
  );
  const rows = {};

  for (const { table_name: table } of tables) {
    try {
      const result = await asUser(user, `select * from public.${table}`);
      rows[table] = result.rows;
    } catch (error) {
      assert.match(error.message, /permission denied/i, `${table} : ${error.message}`);
      rows[table] = null;
    }
  }

  return rows;
}

test("un autre couple ne voit rien, ni en lisant les tables ni par les fonctions", async () => {
  const mine = await createCouple();
  const secrets = await fillCouple(mine, "secret-A");
  const other = await createCouple();
  await fillCouple(other, "secret-B");

  const needles = [
    mine.a.id, mine.b.id, mine.coupleId, secrets.code, secrets.gameId,
    "Carte secret-A", "Consigne secret-A", "Message secret-A",
    Buffer.from("sel-du-couple-secret-A").toString("base64"),
    Buffer.from("temoin-du-couple-secret-A").toString("base64"), secrets.photoId,
  ].map(String);

  const leaks = (label, value) => {
    const text = JSON.stringify(value ?? null);
    const found = needles.filter((needle) => text.includes(needle));
    assert.deepEqual(found, [], `${label} laisse voir : ${found.join(", ")}`);
  };

  // 1. lecture directe de chaque table, par les deux membres de l'autre couple
  for (const user of [other.a, other.b]) {
    const rows = await visibleRows(user);
    for (const [table, value] of Object.entries(rows)) {
      leaks(`la table ${table}`, value);
    }
  }

  // 2. fonctions sans argument que l'app appelle : elles ne parlent que de son couple
  for (const fn of [
    "get_protocol_couple", "get_couple_favorites", "get_protocol_album_key",
    "get_protocol_album_usage", "get_protocol_recaps", "get_my_scheduled_messages",
    "get_my_signals", "get_inbox_counts", "get_partner_waiting_game",
    "get_protocol_couple_settings", "get_protocol_card_style", "get_photo_challenges",
  ]) {
    let value;
    try {
      value = await rpc(other.a, fn);
    } catch (error) {
      assert.doesNotMatch(error.message, /does not exist/i, `${fn} introuvable`);
      continue;
    }
    leaks(fn, value);
  }

  // 3. fonctions de partie appelées avec le code de la partie de l'autre couple
  for (const fn of [
    "get_protocol_game", "get_protocol_current_card", "get_scene_state", "get_card_choice",
    "get_active_rules", "get_protocol_envelope", "get_my_mission", "get_protocol_final_stats",
  ]) {
    await rejects(rpc(other.a, fn, { p_game_code: secrets.code }), /denied|not found|not allowed|authentication/i);
  }
  await rejects(rpc(other.a, "join_protocol_game", { p_game_code: secrets.code }), /.+/);
  await rejects(play(other.a, secrets.code, "done"), /denied|not found|not allowed/i);

  // 4. écrire chez l'autre : supprimer sa photo, viser sa carte perso
  await rejects(rpc(other.a, "delete_protocol_photo", { p_photo_id: secrets.photoId }), /not found/i);
  const before = await sql("select count(*)::int as n from public.protocol_photos where id = $1", [secrets.photoId]);
  assert.equal(before[0].n, 1, "la photo de l'autre couple est toujours là");

  const update = await asUser(
    other.a,
    "update public.protocol_custom_cards set title = 'piraté' where id = $1",
    [secrets.customId]
  );
  assert.equal(update.rowCount, 0, "la carte perso de l'autre couple ne se modifie pas");
});
