// « À distance » : journée de défis photo, à tour de rôle.

import assert from "node:assert/strict";
import { after, test } from "node:test";

import { asUser, createCouple, pool, rejects, rpc, sql } from "./helpers.mjs";

after(() => pool.end());

const day = (user) => rpc(user, "get_photo_day");

async function sentPhoto(user) {
  const photo = await rpc(user, "create_protocol_photo", {
    p_mime: "image/jpeg",
    p_byte_size: 1000,
    p_thumb_size: 100,
    p_width: 3,
    p_height: 4,
  });
  await rpc(user, "finish_protocol_photo", { p_photo_id: photo.id });
  return photo.id;
}

const levelOf = async (dayId, turn) =>
  (
    await sql(
      `select c.intensity, c.target_sex from public.protocol_photo_day_turns t
       join public.protocol_photo_challenges c on c.id = t.challenge_id
       where t.day_id = $1 and t.turn_no = $2`,
      [dayId, turn]
    )
  )[0];

test("lancer, accepter : celui qui lance relève le premier défi, gardé secret pour l'autre", async () => {
  const { a, b } = await createCouple();

  const invited = await rpc(a, "start_photo_day");
  assert.equal(invited.status, "invited");
  assert.equal(invited.started_by_me, true);
  assert.equal((await day(b)).started_by_me, false);
  await rejects(rpc(a, "start_photo_day"), /already running/i);
  await rejects(rpc(a, "respond_photo_day", { p_day_id: invited.id, p_accept: true }), /not found/i);

  await rpc(b, "respond_photo_day", { p_day_id: invited.id, p_accept: true });

  const mine = await day(a);
  const theirs = await day(b);
  assert.equal(mine.status, "active");
  assert.equal(mine.my_turn, true);
  assert.equal(mine.turn_no, 1);
  assert.equal(mine.level, 1);
  assert.ok(mine.challenge.title);
  assert.equal(theirs.my_turn, false);
  assert.equal(theirs.challenge, null, "le défi reste secret pour l'autre");

  await rejects(asUser(b, "select * from public.protocol_photo_challenges"), /permission denied/i);
});

test("une journée complète : 12 défis alternés, niveaux 1 à 4, photo ou passe", async () => {
  const { a, b } = await createCouple();
  const { id } = await rpc(a, "start_photo_day");
  await rpc(b, "respond_photo_day", { p_day_id: id, p_accept: true });

  // pas le tour de b
  await rejects(rpc(b, "skip_photo_turn", { p_day_id: id }), /not your/i);

  const levels = [];

  for (let turn = 1; turn <= 12; turn += 1) {
    const user = turn % 2 === 1 ? a : b;
    const sex = user === a ? "male" : "female";
    const state = await day(user);
    assert.equal(state.my_turn, true, `tour ${turn}`);

    const challenge = await levelOf(id, turn);
    levels.push(challenge.intensity);
    assert.ok(challenge.target_sex === null || challenge.target_sex === sex);

    if (turn % 3 === 0) {
      await rpc(user, "skip_photo_turn", { p_day_id: id });
    } else {
      await rpc(user, "complete_photo_turn", { p_day_id: id, p_photo_id: await sentPhoto(user) });
    }
  }

  assert.deepEqual(levels, [1, 1, 1, 2, 2, 2, 3, 3, 3, 4, 4, 4]);

  const end = await day(a);
  assert.equal(end.status, "finished");
  assert.equal(end.done, 8);
  assert.equal(end.challenge, null);

  const [{ distinct }] = await sql(
    "select count(distinct challenge_id)::int as distinct from public.protocol_photo_day_turns where day_id = $1",
    [id]
  );
  assert.equal(distinct, 12, "jamais deux fois le même défi");

  // une nouvelle journée peut commencer
  assert.equal((await rpc(b, "start_photo_day")).status, "invited");
});

test("refuser, arrêter, et une photo d'un autre ne compte pas", async () => {
  const { a, b } = await createCouple();
  const first = await rpc(a, "start_photo_day");
  assert.equal((await rpc(b, "respond_photo_day", { p_day_id: first.id, p_accept: false })).status, "declined");

  const second = await rpc(b, "start_photo_day");
  await rpc(a, "respond_photo_day", { p_day_id: second.id, p_accept: true });

  // la photo doit être celle du joueur dont c'est le tour
  const photoOfA = await sentPhoto(a);
  await rejects(rpc(b, "complete_photo_turn", { p_day_id: second.id, p_photo_id: photoOfA }), /photo not found/i);

  assert.equal((await rpc(a, "stop_photo_day", { p_day_id: second.id })).status, "stopped");
  await rejects(rpc(b, "skip_photo_turn", { p_day_id: second.id }), /not your/i);

  const other = await createCouple();
  assert.equal(await day(other.a), null, "un autre duo ne voit rien");
});
