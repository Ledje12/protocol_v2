import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type"
};
function json(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      ...corsHeaders,
      "Content-Type": "application/json"
    }
  });
}
/* Commandes Lovense du couple (Lovense Remote fait le pont Bluetooth) :
   - test : 2 s à intensité 5 sur UN jouet, pour le reconnaître ;
   - vibrate : intensité 0 à 20 sur UN jouet (curseur des cartes),
     0 l'arrête ; coupure automatique si l'app ne renouvelle pas ;
   - ambiance : vague, pulsation ou crescendo sur UN jouet ;
   - renew : prolonge la commande en cours d'UN jouet, seulement si
     personne ne l'a arrêtée ou changée entre-temps ;
   - stop : coupe tous les jouets du couple (STOP de la partie).
   Toujours un jouet du couple, retrouvé sur le bon téléphone.
   L'état voulu de chaque jouet est gardé dans
   protocol_lovense_toy_state : les deux téléphones affichent le même
   curseur, et un arrêt n'est jamais relancé par l'autre téléphone. */
// sécurité : une commande non renouvelée s'arrête seule
const HOLD_SECONDS = 30;
// deux téléphones renouvellent : un seul envoi par période
const RENEW_MIN_SECONDS = 12;
// un état de connexion plus vieux n'est plus cru (jouet au tiroir)
const FRESH_HOURS = 24;
const AMBIANCES = {
  wave: { command: "Preset", name: "wave", apiVer: 1 },
  pulse: { command: "Preset", name: "pulse", apiVer: 1 },
  // boucle de 10 s : le renouvellement (20 s) tombe en fin de montée
  crescendo: {
    command: "Pattern",
    rule: "V:1;F:v;S:1000#",
    strength: "2;4;6;8;10;12;14;16;18;20",
    apiVer: 2
  }
};
const LOVENSE_COMMAND_URL = "https://api.lovense-api.com/api/lan/v2/command";
const isOnline = (toy)=>toy?.connected === true || String(toy?.status ?? "") === "1" || toy?.status === true;
const toysOf = (connection)=>Array.isArray(connection?.toys) ? connection.toys : connection?.toys && typeof connection.toys === "object" ? Object.values(connection.toys) : [];
const isFresh = (connection)=>{
  const at = Date.parse(connection?.updated_at || connection?.connected_at || "");
  return Number.isFinite(at) && Date.now() - at < FRESH_HOURS * 3600 * 1000;
};
async function sendCommand(commandBody) {
  const response = await fetch(LOVENSE_COMMAND_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json"
    },
    body: JSON.stringify(commandBody)
  });
  const data = await response.json().catch(()=>null);
  if (!response.ok || typeof data?.code === "number" && data.code >= 400) {
    console.error("LOVENSE COMMAND API ERROR:", {
      status: response.status,
      code: data?.code,
      message: data?.message || data?.type || null
    });
    return data?.message || data?.type || "Commande Lovense refusée.";
  }
  return null;
}
const stopCommand = {
  command: "Function",
  action: "Stop",
  timeSec: 0,
  apiVer: 1
};
// commande Lovense d'un état (intensité ou ambiance)
function commandOf(level, ambiance) {
  if (ambiance) {
    return {
      ...AMBIANCES[ambiance],
      timeSec: HOLD_SECONDS
    };
  }
  if (level > 0) {
    return {
      command: "Function",
      action: `Vibrate:${level}`,
      timeSec: HOLD_SECONDS,
      stopPrevious: 1,
      apiVer: 1
    };
  }
  return stopCommand;
}
// état public d'un jouet ; une commande non renouvelée est éteinte
function publicState(row) {
  if (!row) {
    return null;
  }
  const expired = Date.now() - Date.parse(row.renewed_at) > (HOLD_SECONDS + 5) * 1000;
  const live = !expired && (row.level > 0 || Boolean(row.ambiance));
  return {
    toy_id: row.toy_id,
    level: live ? row.level : 0,
    ambiance: live ? row.ambiance : null,
    updated_at: row.updated_at
  };
}
Deno.serve(async (req)=>{
  if (req.method === "OPTIONS") {
    return new Response("ok", {
      headers: corsHeaders
    });
  }
  if (req.method !== "POST") {
    return json({
      success: false,
      error: "Méthode non autorisée."
    }, 405);
  }
  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL");
    const anonKey = Deno.env.get("SUPABASE_ANON_KEY");
    const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
    const developerToken = Deno.env.get("LOVENSE_DEVELOPER_TOKEN");
    if (!supabaseUrl || !anonKey || !serviceRoleKey || !developerToken) {
      throw new Error("Configuration serveur manquante.");
    }
    /* =====================================================
       AUTH
       ===================================================== */ const authorization = req.headers.get("Authorization");
    if (!authorization) {
      return json({
        success: false,
        error: "Authentification requise."
      }, 401);
    }
    const userClient = createClient(supabaseUrl, anonKey, {
      global: {
        headers: {
          Authorization: authorization
        }
      },
      auth: {
        persistSession: false,
        autoRefreshToken: false
      }
    });
    const { data: { user }, error: userError } = await userClient.auth.getUser();
    if (userError || !user) {
      return json({
        success: false,
        error: "Session invalide."
      }, 401);
    }
    /* =====================================================
       ADMIN
       ===================================================== */ const admin = createClient(supabaseUrl, serviceRoleKey, {
      auth: {
        persistSession: false,
        autoRefreshToken: false
      }
    });
    /* =====================================================
       COUPLE
       ===================================================== */ const { data: membership, error: membershipError } = await admin.from("protocol_couple_members").select("couple_id").eq("user_id", user.id).maybeSingle();
    if (membershipError) {
      throw membershipError;
    }
    if (!membership?.couple_id) {
      return json({
        success: false,
        error: "Aucun couple associé à cet utilisateur."
      }, 403);
    }
    const coupleId = membership.couple_id;
    /* =====================================================
       ACTION
       ===================================================== */ const body = await req.json().catch(()=>({}));
    const action = String(body?.action || "").trim().toLowerCase();
    if (![
      "stop",
      "test",
      "vibrate",
      "ambiance",
      "renew"
    ].includes(action)) {
      return json({
        success: false,
        error: "Action Lovense invalide."
      }, 400);
    }
    /* =====================================================
       CONNEXIONS LOVENSE DU COUPLE
       ===================================================== */ const { data: connections, error: connectionError } = await admin.from("protocol_lovense_connections").select(`
            id,
            lovense_uid,
            toys,
            connected_at,
            updated_at
          `).eq("couple_id", coupleId).order("updated_at", {
      ascending: false
    }).limit(5);
    if (connectionError) {
      throw connectionError;
    }
    const linked = (connections || []).filter((connection)=>connection?.lovense_uid);
    /* L'état partagé ne doit jamais bloquer une commande : si la
       table manque encore (migration pas lancée), on fait sans. */ const saveState = async (toyId, level, ambiance)=>{
      const now = new Date().toISOString();
      const { data, error } = await admin.from("protocol_lovense_toy_state").upsert({
        couple_id: coupleId,
        toy_id: toyId,
        level,
        ambiance,
        updated_by: user.id,
        updated_at: now,
        renewed_at: now
      }, {
        onConflict: "couple_id,toy_id"
      }).select("toy_id, level, ambiance, updated_at, renewed_at").maybeSingle();
      if (error) {
        console.warn("LOVENSE STATE WARNING:", error.message);
        return null;
      }
      return publicState(data);
    };
    /* =====================================================
       STOP : tous les jouets, sur toutes les connexions,
       quel que soit l'état connu (un arrêt part toujours)
       ===================================================== */ if (action === "stop") {
      const { error: clearError } = await admin.from("protocol_lovense_toy_state").update({
        level: 0,
        ambiance: null,
        updated_by: user.id,
        updated_at: new Date().toISOString()
      }).eq("couple_id", coupleId);
      if (clearError) {
        console.warn("LOVENSE STATE WARNING:", clearError.message);
      }
      const failures = await Promise.all(linked.map((connection)=>sendCommand({
          token: developerToken,
          uid: connection.lovense_uid,
          ...stopCommand,
          stopPrevious: 1
        }).catch((error)=>String(error?.message || error))));
      const errors = failures.filter(Boolean);
      if (linked.length > 0 && errors.length === linked.length) {
        return json({
          success: false,
          error: errors[0]
        }, 502);
      }
      return json({
        success: true,
        action
      });
    }
    /* =====================================================
       UN SEUL JOUET : test, vibrate, ambiance, renew
       ===================================================== */ const usable = linked.filter((connection)=>connection.connected_at && isFresh(connection) && toysOf(connection).some(isOnline));
    const toyId = String(body?.toy_id || "").trim().slice(0, 120);
    if (action !== "test" && !toyId) {
      return json({
        success: false,
        error: "Jouet manquant."
      }, 400);
    }
    // un arrêt part même si l'état de connexion est périmé
    const stopping = action === "vibrate" && Math.round(Number(body?.level)) === 0;
    const pool = stopping ? linked : usable;
    if (pool.length === 0) {
      return json({
        success: false,
        error: "Aucun jouet Lovense disponible pour ce couple."
      }, 409);
    }
    let connection = pool[0];
    if (toyId) {
      connection = pool.find((candidate)=>toysOf(candidate).some((toy)=>String(toy?.id) === toyId && (stopping || isOnline(toy)))) || (stopping ? pool[0] : undefined);
      if (!connection) {
        return json({
          success: false,
          error: "Ce jouet n’est pas connecté."
        }, 404);
      }
    }
    const send = (command)=>sendCommand({
        token: developerToken,
        uid: connection.lovense_uid,
        ...toyId ? {
          toy: toyId
        } : {},
        ...command
      });
    // preuve de vie : Lovense a accepté une commande pour ce téléphone
    const touchConnection = async ()=>{
      await admin.from("protocol_lovense_connections").update({
        updated_at: new Date().toISOString()
      }).eq("id", connection.id);
    };
    /* =====================================================
       RENEW : prolonge sans rien décider
       ===================================================== */ if (action === "renew") {
      const { data: row, error: stateError } = await admin.from("protocol_lovense_toy_state").select("toy_id, level, ambiance, updated_at, renewed_at").eq("couple_id", coupleId).eq("toy_id", toyId).maybeSingle();
      if (stateError) {
        console.warn("LOVENSE STATE WARNING:", stateError.message);
        return json({
          success: true,
          action,
          state: null
        });
      }
      const state = publicState(row);
      const live = state && (state.level > 0 || state.ambiance);
      // arrêté ou changé depuis : on ne relance rien, l'app s'aligne
      if (!live || String(body?.updated_at || "") !== state.updated_at) {
        return json({
          success: true,
          action,
          renewed: false,
          state: state || {
            toy_id: toyId,
            level: 0,
            ambiance: null,
            updated_at: null
          }
        });
      }
      // l'autre téléphone vient de le faire
      if (Date.now() - Date.parse(row.renewed_at) < RENEW_MIN_SECONDS * 1000) {
        return json({
          success: true,
          action,
          renewed: false,
          state
        });
      }
      const failure = await send(commandOf(state.level, state.ambiance));
      if (failure) {
        return json({
          success: false,
          error: failure
        }, 502);
      }
      await admin.from("protocol_lovense_toy_state").update({
        renewed_at: new Date().toISOString()
      }).eq("couple_id", coupleId).eq("toy_id", toyId).eq("updated_at", row.updated_at);
      await touchConnection();
      return json({
        success: true,
        action,
        renewed: true,
        state
      });
    }
    let level = 0;
    let ambiance = null;
    let command;
    if (action === "vibrate") {
      level = Math.round(Number(body?.level));
      if (!Number.isFinite(level) || level < 0 || level > 20) {
        return json({
          success: false,
          error: "Intensité invalide."
        }, 400);
      }
      command = commandOf(level, null);
    } else if (action === "ambiance") {
      ambiance = String(body?.name || "");
      if (!Object.hasOwn(AMBIANCES, ambiance)) {
        return json({
          success: false,
          error: "Ambiance inconnue."
        }, 400);
      }
      command = commandOf(0, ambiance);
    } else {
      command = {
        command: "Function",
        action: "Vibrate:5",
        timeSec: 2,
        stopPrevious: 1,
        apiVer: 1
      };
    }
    // un arrêt s'enregistre d'abord : même si Lovense ne répond pas,
    // aucun téléphone ne relancera le jouet
    let state = null;
    if (stopping) {
      state = await saveState(toyId, 0, null);
    }
    const failure = await send(command);
    if (failure) {
      return json({
        success: false,
        error: failure,
        state
      }, 502);
    }
    if (action !== "test") {
      if (!stopping) {
        state = await saveState(toyId, level, ambiance);
      }
      await touchConnection();
    }
    return json({
      success: true,
      action,
      state
    });
  } catch (error) {
    console.error("LOVENSE COMMAND ERROR:", error);
    return json({
      success: false,
      error: "Erreur serveur Lovense."
    }, 500);
  }
});
