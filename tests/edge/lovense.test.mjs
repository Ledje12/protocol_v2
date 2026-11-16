// Fonctions edge Lovense, rejouées sous Node avec un faux Supabase et
// un faux Lovense : ce que deux téléphones peuvent se faire l'un à
// l'autre (arrêt, relance, déconnexion) sans vrai jouet.

import assert from "node:assert/strict";
import { beforeEach, test } from "node:test";

import { ME, OTHER, as, call, db, lovense, reset, stateOf } from "./harness.mjs";

beforeEach(() => reset());

const sent = () => lovense.calls.map((c) => c.action || c.name || c.command);

test("curseur : la commande part et l'état est partagé", async () => {
  const res = await call("lovense-command", { action: "vibrate", toy_id: "me-lush", level: 12 });

  assert.equal(res.success, true);
  assert.equal(res.state.level, 12);
  assert.deepEqual(sent(), ["Vibrate:12"]);
  assert.equal(lovense.calls[0].toy, "me-lush");
  assert.equal(stateOf("me-lush").level, 12);
});

test("arrêt par l'autre : mon téléphone ne relance pas le jouet", async () => {
  const mine = await call("lovense-command", { action: "vibrate", toy_id: "me-lush", level: 12 });

  as(OTHER);
  await call("lovense-command", { action: "vibrate", toy_id: "me-lush", level: 0 });
  lovense.calls = [];

  as(ME);
  const renew = await call("lovense-command", {
    action: "renew", toy_id: "me-lush", updated_at: mine.state.updated_at,
  });

  assert.equal(renew.success, true);
  assert.equal(renew.renewed, false);
  assert.equal(renew.state.level, 0);
  assert.deepEqual(sent(), [], "aucune commande ne repart vers Lovense");
});

test("renouvellement : prolonge l'état connu, une seule fois pour deux téléphones", async () => {
  const set = await call("lovense-command", { action: "ambiance", toy_id: "me-lush", name: "wave" });
  const body = { action: "renew", toy_id: "me-lush", updated_at: set.state.updated_at };
  lovense.calls = [];

  // tout de suite : l'envoi initial date de moins de 12 s
  assert.equal((await call("lovense-command", body)).renewed, false);
  assert.deepEqual(sent(), []);

  stateOf("me-lush").renewed_at = new Date(Date.now() - 20000).toISOString();
  assert.equal((await call("lovense-command", body)).renewed, true);
  as(OTHER);
  assert.equal((await call("lovense-command", body)).renewed, false);
  assert.deepEqual(sent(), ["wave"]);
});

test("retour d'arrière-plan : une commande éteinte depuis longtemps ne repart pas", async () => {
  const set = await call("lovense-command", { action: "vibrate", toy_id: "me-lush", level: 12 });
  stateOf("me-lush").renewed_at = new Date(Date.now() - 10 * 60000).toISOString();
  lovense.calls = [];

  const renew = await call("lovense-command", {
    action: "renew", toy_id: "me-lush", updated_at: set.state.updated_at,
  });

  assert.equal(renew.state.level, 0);
  assert.deepEqual(sent(), []);
});

test("STOP : part vers tous les téléphones, même si l'état connu est périmé ou vide", async () => {
  reset({ mine: ["lush"], theirs: ["diamo"], ageHours: 72 });
  db.tables.protocol_lovense_connections[0].toys = [];
  db.tables.protocol_lovense_toy_state.push({
    couple_id: "couple-1", toy_id: "ot-diamo", level: 9, ambiance: null,
    updated_at: new Date().toISOString(), renewed_at: new Date().toISOString(),
  });

  const res = await call("lovense-command", { action: "stop" });

  assert.equal(res.success, true);
  assert.deepEqual(lovense.calls.map((c) => `${c.uid} ${c.action}`).sort(), [
    "uid-me Stop",
    "uid-other Stop",
  ]);
  assert.equal(stateOf("ot-diamo").level, 0);
});

test("état de connexion périmé : pas de vibration, mais l'arrêt d'un jouet part quand même", async () => {
  reset({ ageHours: 30 });

  const start = await call("lovense-command", { action: "vibrate", toy_id: "me-lush", level: 8 });
  assert.equal(start.status, 409);
  assert.deepEqual(sent(), []);

  const stop = await call("lovense-command", { action: "vibrate", toy_id: "me-lush", level: 0 });
  assert.equal(stop.success, true);
  assert.deepEqual(sent(), ["Stop"]);
});

test("une commande acceptée rafraîchit la connexion (preuve de vie)", async () => {
  reset({ ageHours: 20 });
  const before = db.tables.protocol_lovense_connections[0].updated_at;

  await call("lovense-command", { action: "vibrate", toy_id: "me-lush", level: 3 });

  assert.ok(db.tables.protocol_lovense_connections[0].updated_at > before);
});

test("Lovense ne répond pas : erreur, et aucun état « en marche » enregistré", async () => {
  lovense.fail = true;

  const res = await call("lovense-command", { action: "vibrate", toy_id: "me-lush", level: 8 });

  assert.equal(res.success, false);
  assert.equal(res.status, 502);
  assert.equal(stateOf("me-lush"), undefined);
});

test("sans la table d'état (migration pas lancée) : les commandes passent quand même", async () => {
  db.failTables.add("protocol_lovense_toy_state");

  const start = await call("lovense-command", { action: "vibrate", toy_id: "me-lush", level: 8 });
  assert.equal(start.success, true);
  assert.equal(start.state, null);

  const stop = await call("lovense-command", { action: "stop" });
  assert.equal(stop.success, true);
  assert.deepEqual(sent(), ["Vibrate:8", "Stop"]);
});

test("jouet d'un autre couple ou inconnu : refusé", async () => {
  const res = await call("lovense-command", { action: "vibrate", toy_id: "ailleurs", level: 8 });

  assert.equal(res.status, 404);
  assert.deepEqual(sent(), []);
});

test("entrées invalides : intensité, ambiance, action", async () => {
  assert.equal((await call("lovense-command", { action: "vibrate", toy_id: "me-lush", level: 21 })).status, 400);
  assert.equal((await call("lovense-command", { action: "ambiance", toy_id: "me-lush", name: "constructor" })).status, 400);
  assert.equal((await call("lovense-command", { action: "boom" })).status, 400);
  assert.deepEqual(sent(), []);
});

test("statut : un état de plus de 24 h n'annonce plus de jouet", async () => {
  assert.deepEqual((await call("lovense-status")).has, { lush: true, ring: true });

  reset({ ageHours: 30 });
  const old = await call("lovense-status");

  assert.equal(old.connected, false);
  assert.equal(old.stale, true);
  assert.deepEqual(old.has, { lush: false, ring: false });
});

test("déconnexion : seulement les jouets de ce téléphone", async () => {
  reset({ mine: ["lush"], theirs: ["diamo"] });

  await call("lovense-disconnect");

  assert.deepEqual(db.tables.protocol_lovense_connections.map((c) => c.user_id), [OTHER]);
  assert.deepEqual((await call("lovense-status")).has, { lush: false, ring: true });
});

test("QR : aucun prénom chez Lovense, et la connexion en cours n'est pas coupée", async () => {
  const res = await call("lovense-connect");
  const row = db.tables.protocol_lovense_connections[0];

  assert.equal(res.success, true);
  assert.equal(lovense.calls[0].uname, "PROTOCOL");
  assert.equal(lovense.calls[0].utoken, "tok-me", "le rappel Lovense reste accepté");
  assert.equal(row.toys.length, 2);
  assert.ok(row.connected_at);
});

test("QR : première connexion, la ligne en attente est créée", async () => {
  reset({ mine: [] });

  await call("lovense-connect");
  const row = db.tables.protocol_lovense_connections[0];

  assert.equal(row.user_id, ME);
  assert.equal(row.utoken, lovense.calls[0].utoken);
  assert.equal(row.connected_at, null);
  assert.equal((await call("lovense-connect", {}, "GET")).status, 405);
});
