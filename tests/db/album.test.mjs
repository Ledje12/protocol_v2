// Album photo : la base ne connaît que des tailles et des chemins
// (les fichiers sont chiffrés sur le téléphone) ; seul le duo peut
// lire, envoyer ou supprimer ses photos.

import assert from "node:assert/strict";
import { after, test } from "node:test";

import { asUser, createCouple, pool, rejects, rpc, sql } from "./helpers.mjs";

after(() => pool.end());

const SALT = "c2VsLWRlLXRlc3QtMTIzNA==";
const CHECK = "dGVtb2luLWNoaWZmcmUtZGUtdGVzdA==";

const newPhoto = (user, size = 1000) =>
  rpc(user, "create_protocol_photo", {
    p_mime: "image/jpeg",
    p_byte_size: size,
    p_thumb_size: 100,
    p_width: 3024,
    p_height: 4032,
  });

const putFile = (user, path) =>
  asUser(
    user,
    "insert into storage.objects (bucket_id, name) values ('protocol-photos', $1)",
    [path]
  );

test("phrase secrète : posée une seule fois par duo, jamais en clair", async () => {
  const { a, b } = await createCouple();

  assert.equal(await rpc(a, "get_protocol_album_key"), null);
  assert.equal(await rpc(a, "set_protocol_album_key", { p_salt: SALT, p_check: CHECK }), true);
  assert.deepEqual(await rpc(b, "get_protocol_album_key"), { salt: SALT, check: CHECK });

  // changer de phrase rendrait les photos illisibles : refusé
  await rejects(
    rpc(b, "set_protocol_album_key", { p_salt: SALT + "x", p_check: CHECK + "x" }),
    /already set/i
  );
});

test("envoyer : réserver, déposer les fichiers dans le dossier du duo, terminer", async () => {
  const { a, b, coupleId } = await createCouple();
  const photo = await newPhoto(a);

  assert.equal(photo.original_path, `${coupleId}/${photo.id}/original`);
  await putFile(a, photo.original_path);
  await putFile(a, photo.thumb_path);

  // pas encore visible tant que l'envoi n'est pas terminé
  const list = (user) => asUser(user, "select id from public.protocol_photos");
  assert.equal((await list(b)).rows.length, 0);

  await rpc(a, "finish_protocol_photo", { p_photo_id: photo.id });
  assert.deepEqual((await list(b)).rows, [{ id: photo.id }]);

  const usage = await rpc(b, "get_protocol_album_usage");
  assert.equal(Number(usage.used), 1100);
  assert.equal(usage.count, 1);

  // l'autre membre peut lire les fichiers
  const files = await asUser(b, "select name from storage.objects where bucket_id = 'protocol-photos'");
  assert.equal(files.rows.length, 2);
});

test("un autre duo ne voit ni les photos ni les fichiers, et ne peut rien déposer chez vous", async () => {
  const mine = await createCouple();
  const other = await createCouple();
  const photo = await newPhoto(mine.a);
  await putFile(mine.a, photo.original_path);
  await rpc(mine.a, "finish_protocol_photo", { p_photo_id: photo.id });

  assert.equal((await asUser(other.a, "select id from public.protocol_photos")).rows.length, 0);
  assert.equal(
    (await asUser(other.a, "select name from storage.objects where bucket_id = 'protocol-photos'")).rows.length,
    0
  );
  await rejects(putFile(other.a, `${mine.coupleId}/intrus/original`), /row-level security/i);
  await rejects(rpc(other.a, "delete_protocol_photo", { p_photo_id: photo.id }), /not found/i);

  await rpc(mine.a, "set_protocol_album_key", { p_salt: SALT, p_check: CHECK });
  assert.equal(await rpc(other.a, "get_protocol_album_key"), null, "chaque duo a sa phrase");
});

test("supprimer retire la photo pour les deux et la détache du message", async () => {
  const { a, b, coupleId } = await createCouple();
  const photo = await newPhoto(a);
  await rpc(a, "finish_protocol_photo", { p_photo_id: photo.id });

  const [{ id: messageId }] = await sql(
    `insert into public.protocol_messages (body, sender_user_id, recipient_user_id, couple_id, photo_id)
     values ('', $1, $2, $3, $4) returning id`,
    [a.id, b.id, coupleId, photo.id]
  );

  assert.equal(await rpc(b, "delete_protocol_photo", { p_photo_id: photo.id }), true);
  assert.equal((await asUser(a, "select id from public.protocol_photos")).rows.length, 0);

  const [message] = await sql("select photo_id from public.protocol_messages where id = $1", [messageId]);
  assert.equal(message.photo_id, null);
});

test("garde-fous : taille d'une photo et place totale du duo", async () => {
  const { a } = await createCouple();

  await rejects(newPhoto(a, 31 * 1024 * 1024), /invalid photo size/i);

  // remplir jusqu'au plafond (photos fictives, sans fichiers)
  for (let i = 0; i < 31; i += 1) {
    const photo = await newPhoto(a, 30 * 1024 * 1024);
    await rpc(a, "finish_protocol_photo", { p_photo_id: photo.id });
  }
  await rejects(newPhoto(a, 30 * 1024 * 1024), /album full/i);
});
