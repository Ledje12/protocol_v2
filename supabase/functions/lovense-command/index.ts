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
   - stop : coupe tous les jouets du couple (STOP de la partie).
   Toujours un jouet du couple, retrouvé sur le bon téléphone. */
// sécurité : une commande non renouvelée s'arrête seule
const HOLD_SECONDS = 30;
const AMBIANCES = {
  wave: { command: "Preset", name: "wave", apiVer: 1 },
  pulse: { command: "Preset", name: "pulse", apiVer: 1 },
  crescendo: {
    command: "Pattern",
    rule: "V:1;F:v;S:800#",
    strength: "2;4;6;8;10;12;14;16;18;20;20;20",
    apiVer: 2
  }
};
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
      "test",
      "vibrate",
      "ambiance"
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
       UN SEUL JOUET : test, vibrate, ambiance
       ===================================================== */ const toyId = String(body?.toy_id || "").trim();
    if (action !== "test" && !toyId) {
      return json({
        success: false,
        error: "Jouet manquant."
      }, 400);
    }
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
    let command;
    if (action === "vibrate") {
      const level = Math.round(Number(body?.level));
      if (!Number.isFinite(level) || level < 0 || level > 20) {
        return json({
          success: false,
          error: "Intensité invalide."
        }, 400);
      }
      command = level === 0 ? {
        command: "Function",
        action: "Stop",
        timeSec: 0,
        apiVer: 1
      } : {
        command: "Function",
        action: `Vibrate:${level}`,
        timeSec: HOLD_SECONDS,
        stopPrevious: 1,
        apiVer: 1
      };
    } else if (action === "ambiance") {
      const ambiance = AMBIANCES[String(body?.name || "")];
      if (!ambiance) {
        return json({
          success: false,
          error: "Ambiance inconnue."
        }, 400);
      }
      command = {
        ...ambiance,
        timeSec: HOLD_SECONDS
      };
    } else {
      command = {
        command: "Function",
        action: "Vibrate:5",
        timeSec: 2,
        stopPrevious: 1,
        apiVer: 1
      };
    }
    const failure = await sendCommand({
      token: developerToken,
      uid: connection.lovense_uid,
      ...toyId ? {
        toy: toyId
      } : {},
      ...command
    });
    if (failure) {
      return json({
        success: false,
        error: failure
      }, 502);
    }
    return json({
      success: true,
      action
    });
  } catch (error) {
    console.error("LOVENSE COMMAND ERROR:", error);
    return json({
      success: false,
      error: "Erreur serveur Lovense."
    }, 500);
  }
});
