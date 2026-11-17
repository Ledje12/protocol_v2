// Charge une fonction edge sous Node : faux Deno, faux Lovense.
import { db } from "./fake-supabase.mjs";

export { db };

export const lovense = { calls: [], fail: false };

const handlers = {};
let loadingName = null;

globalThis.Deno = {
  env: { get: (name) => `test-${name}` },
  serve: (handler) => { handlers[loadingName] = handler; },
};

globalThis.fetch = async (url, init) => {
  const body = JSON.parse(init.body);
  lovense.calls.push({ url: String(url), ...body });
  if (lovense.fail) {
    // fail = true : app hors ligne (507) ; fail = 402 : jouet non connecté
    const code = typeof lovense.fail === "number" ? lovense.fail : 507;
    return new Response(JSON.stringify({ code, message: code === 507 ? "Lovense APP is offline" : "Toy Not Connected" }), { status: 200 });
  }
  return new Response(
    JSON.stringify({ code: 0, result: true, data: { qr: "https://qr.test/x.png", code: "ABC123", authToken: "t" } }),
    { status: 200 }
  );
};

export async function call(name, body = {}, method = "POST") {
  if (!handlers[name]) {
    loadingName = name;
    await import(new URL(`../../supabase/functions/${name}/index.ts`, import.meta.url).href);
  }
  const response = await handlers[name](
    new Request(`http://edge.test/${name}`, {
      method,
      headers: { Authorization: "Bearer test", "Content-Type": "application/json" },
      body: method === "POST" ? JSON.stringify(body) : undefined,
    })
  );
  return { status: response.status, ...(await response.json()) };
}

export const ME = "user-me";
export const OTHER = "user-other";
export const COUPLE = "couple-1";

// un couple, et les jouets de chacun (par défaut : tout sur mon téléphone)
export function reset({ mine = ["lush", "diamo"], theirs = [], ageHours = 0 } = {}) {
  const at = new Date(Date.now() - ageHours * 3600 * 1000).toISOString();
  const toys = (names, prefix) =>
    names.map((name) => ({ id: `${prefix}-${name}`, name, connected: true }));
  db.user = { id: ME };
  db.failTables = new Set();
  db.unique = { protocol_lovense_connections: ["couple_id", "user_id"] };
  db.tables = {
    protocol_couple_members: [
      { user_id: ME, couple_id: COUPLE },
      { user_id: OTHER, couple_id: COUPLE },
    ],
    protocol_profiles: [{ user_id: ME, display_name: "Prénom Réel" }],
    protocol_lovense_connections: [
      mine.length && { id: 1, user_id: ME, couple_id: COUPLE, lovense_uid: "uid-me", utoken: "tok-me", toys: toys(mine, "me"), connected_at: at, updated_at: at },
      theirs.length && { id: 2, user_id: OTHER, couple_id: COUPLE, lovense_uid: "uid-other", utoken: "tok-other", toys: toys(theirs, "ot"), connected_at: at, updated_at: at },
    ].filter(Boolean),
    protocol_lovense_toy_state: [],
  };
  lovense.calls = [];
  lovense.fail = false;
}

export const as = (id) => { db.user = { id }; };
export const stateOf = (toyId) =>
  db.tables.protocol_lovense_toy_state.find((row) => row.toy_id === toyId);
