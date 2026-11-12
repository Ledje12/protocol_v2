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
/* Protocol ne pilote plus les jouets en jeu (Lovense Remote s'en
   charge). Il reste deux commandes :
   - test : 2 s à intensité 5 sur UN jouet (le bon téléphone, le bon
     jouet), pour savoir lequel est lequel dans les réglages ;
   - stop : coupe tous les jouets du couple (STOP de la partie). */
const LOVENSE_COMMAND_URL = "https://api.lovense-api.com/api/lan/v2/command";
const isOnline = (toy)=>toy?.connected === true || String(toy?.status ?? "") === "1" || toy?.status === true;
const toysOf = (connection)=>Array.isArray(connection?.toys) ? connection.toys : connection?.toys && typeof connection.toys === "object" ? Object.values(connection.toys) : [];
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
    /* =====================================================
       CONNEXION LOVENSE DU COUPLE
       ===================================================== */ const { data: connections, error: connectionError } = await admin.from("protocol_lovense_connections").select(`
            id,
            lovense_uid,
            toys,
            connected_at,
            updated_at
          `).eq("couple_id", membership.couple_id).not("connected_at", "is", null).order("updated_at", {
      ascending: false
    }).limit(5);
    if (connectionError) {
      throw connectionError;
    }
    const usable = (connections || []).filter((connection)=>connection?.lovense_uid && toysOf(connection).some(isOnline));
    if (usable.length === 0) {
      return json({
        success: false,
        error: "Aucun jouet Lovense disponible pour ce couple."
      }, 409);
    }
    /* =====================================================
       ACTION
       ===================================================== */ const body = await req.json().catch(()=>({}));
    const action = String(body?.action || "").trim().toLowerCase();
    if (![
      "stop",
      "test"
    ].includes(action)) {
      return json({
        success: false,
        error: "Action Lovense invalide."
      }, 400);
    }
    /* =====================================================
       STOP : tous les jouets, sur toutes les connexions
       ===================================================== */ if (action === "stop") {
      const errors = [];
      for (const connection of usable){
        const failure = await sendCommand({
          token: developerToken,
          uid: connection.lovense_uid,
          command: "Function",
          action: "Stop",
          timeSec: 0,
          stopPrevious: 1,
          apiVer: 1
        });
        if (failure) {
          errors.push(failure);
        }
      }
      if (errors.length === usable.length) {
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
       TEST : un seul jouet, valeurs fixes côté serveur
       ===================================================== */ const toyId = String(body?.toy_id || "").trim();
    let connection = usable[0];
    if (toyId) {
      connection = usable.find((candidate)=>toysOf(candidate).some((toy)=>String(toy?.id) === toyId && isOnline(toy)));
      if (!connection) {
        return json({
          success: false,
          error: "Ce jouet n’est pas connecté."
        }, 404);
      }
    }
    const failure = await sendCommand({
      token: developerToken,
      uid: connection.lovense_uid,
      ...toyId ? {
        toy: toyId
      } : {},
      command: "Function",
      action: "Vibrate:5",
      timeSec: 2,
      stopPrevious: 1,
      apiVer: 1
    });
    if (failure) {
      return json({
        success: false,
        error: failure
      }, 502);
    }
    return json({
      success: true,
      action,
      intensity: 5,
      duration: 2
    });
  } catch (error) {
    console.error("LOVENSE COMMAND ERROR:", error);
    return json({
      success: false,
      error: "Erreur serveur Lovense."
    }, 500);
  }
});
