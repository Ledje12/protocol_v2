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
const CUSTOM_PATTERNS = {
  pulse_slow: {
    intervalMs: 1000,
    strength: "5;12;5;12;5;12"
  },
  pulse_fast: {
    intervalMs: 400,
    strength: "5;14;5;14;5;14;5;14"
  },
  wave: {
    intervalMs: 700,
    strength: "4;6;8;10;12;14;12;10;8;6"
  },
  tease: {
    intervalMs: 800,
    strength: "3;3;5;4;7;3;9;4;11"
  },
  build_up: {
    intervalMs: 900,
    strength: "3;4;5;6;7;8;9;10;11;12;13;14;15"
  },
  rollercoaster: {
    intervalMs: 700,
    strength: "5;10;15;8;18;6;13;20;8"
  }
};
const PRESET_PATTERNS = new Set([
  "pulse",
  "wave",
  "fireworks",
  "earthquake"
]);
const MANUAL_CONTROLS = {
  tease: {
    soft: {
      intensity: 4
    },
    medium: {
      intensity: 8
    },
    pulse: {
      pattern: "pulse_slow"
    }
  },
  play: {
    soft: {
      intensity: 5
    },
    medium: {
      intensity: 10
    },
    strong: {
      intensity: 15
    },
    wave: {
      pattern: "wave"
    }
  },
  intense: {
    medium: {
      intensity: 10
    },
    strong: {
      intensity: 16
    },
    max: {
      intensity: 20
    },
    fireworks: {
      pattern: "fireworks"
    }
  },
  control: {
    level_3: {
      intensity: 3
    },
    level_7: {
      intensity: 7
    },
    level_12: {
      intensity: 12
    },
    level_17: {
      intensity: 17
    },
    level_20: {
      intensity: 20
    }
  }
};
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
    /* =====================================================
      CONNEXION ACTIVE AVEC JOUET ONLINE

      Même règle de sélection que lovense-status.
      ===================================================== */ let connection = null;
    let availableToys = [];
    for (const candidate of connections || []){
      if (!candidate?.lovense_uid) {
        continue;
      }
      const rawToys = Array.isArray(candidate?.toys) ? candidate.toys : candidate?.toys && typeof candidate.toys === "object" ? Object.values(candidate.toys) : [];
      const onlineToys = rawToys.filter((toy)=>toy && typeof toy === "object" && toy.connected !== false);
      if (onlineToys.length > 0) {
        connection = candidate;
        availableToys = onlineToys;
        break;
      }
    }
    if (!connection?.lovense_uid) {
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
      "play",
      "stop",
      "test"
    ].includes(action)) {
      return json({
        success: false,
        error: "Action Lovense invalide."
      }, 400);
    }
    /* =====================================================
       PARAMETRES AUTORITAIRES

       Aucun intensity / duration / pattern
       venant du navigateur n'est utilisé.
       ===================================================== */ let intensity = 5;
    let duration = 2;
    let requestedPattern = "";
    /* =====================================================
       PLAY = CARTE DB
       ===================================================== */ if (action === "play") {
      const cardId = Number(body?.card_id);
      if (!Number.isInteger(cardId) || cardId <= 0) {
        return json({
          success: false,
          error: "Carte Lovense invalide."
        }, 400);
      }
      const { data: card, error: cardError } = await admin.from("protocol_cards").select(`
              id,
              lovense_mode,
              lovense_action,
              lovense_intensity,
              lovense_duration_sec,
              lovense_pattern,
              lovense_controls_profile
            `).eq("id", cardId).eq("library_version", "v1").eq("active", true).maybeSingle();
      if (cardError) {
        throw cardError;
      }
      if (!card) {
        return json({
          success: false,
          error: "Carte introuvable."
        }, 404);
      }
      if (![
        "optional",
        "required"
      ].includes(String(card.lovense_mode || ""))) {
        return json({
          success: false,
          error: "Cette carte n’utilise pas Lovense."
        }, 400);
      }
      intensity = Math.max(0, Math.min(20, Math.round(Number(card.lovense_intensity) || 5)));
      duration = Math.max(2, Math.min(600, Math.round(Number(card.lovense_duration_sec) || 2)));
      requestedPattern = String(card.lovense_pattern || "").trim().toLowerCase();
      const requestedControl = String(body?.control || "").trim().toLowerCase();
      if (requestedControl) {
        const controlsProfile = String(card.lovense_controls_profile || "").trim().toLowerCase();
        const profileControls = MANUAL_CONTROLS[controlsProfile];
        const manualControl = profileControls?.[requestedControl];
        if (!manualControl) {
          return json({
            success: false,
            error: "Commande Lovense non autorisée pour cette carte."
          }, 400);
        }
        if (typeof manualControl.intensity === "number") {
          intensity = manualControl.intensity;
          requestedPattern = "";
        }
        if (manualControl.pattern) {
          requestedPattern = manualControl.pattern;
        }
      }
    }
    /* =====================================================
       TEST

       Valeurs fixes côté serveur.
       Impossible de transformer le bouton test
       en vibration 20 pendant dix minutes.
       ===================================================== */ if (action === "test") {
      intensity = 5;
      duration = 2;
      requestedPattern = "";
    }
    /* =====================================================
       COMMAND BODY
       ===================================================== */ let commandBody;
    if (action === "stop") {
      commandBody = {
        token: developerToken,
        uid: connection.lovense_uid,
        command: "Function",
        action: "Stop",
        timeSec: 0,
        stopPrevious: 1,
        apiVer: 1
      };
    } else if (requestedPattern && CUSTOM_PATTERNS[requestedPattern]) {
      const pattern = CUSTOM_PATTERNS[requestedPattern];
      commandBody = {
        token: developerToken,
        uid: connection.lovense_uid,
        command: "Pattern",
        rule: `V:1;F:v;S:${pattern.intervalMs}#`,
        strength: pattern.strength,
        timeSec: duration,
        apiVer: 2
      };
    } else if (requestedPattern && PRESET_PATTERNS.has(requestedPattern)) {
      commandBody = {
        token: developerToken,
        uid: connection.lovense_uid,
        command: "Preset",
        name: requestedPattern,
        timeSec: duration,
        apiVer: 1
      };
    } else {
      commandBody = {
        token: developerToken,
        uid: connection.lovense_uid,
        command: "Function",
        action: `Vibrate:${intensity}`,
        timeSec: duration,
        stopPrevious: 1,
        apiVer: 1
      };
    }
    /* =====================================================
       LOVENSE API
       ===================================================== */ const response = await fetch("https://api.lovense-api.com/api/lan/v2/command", {
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
      return json({
        success: false,
        error: data?.message || data?.type || "Commande Lovense refusée."
      }, 502);
    }
    /* =====================================================
       RESPONSE MINIMALE
       ===================================================== */ return json({
      success: true,
      action,
      intensity: action === "stop" ? null : intensity,
      duration: action === "stop" ? 0 : duration,
      pattern: requestedPattern || null
    });
  } catch (error) {
    console.error("LOVENSE COMMAND ERROR:", error);
    return json({
      success: false,
      error: "Erreur serveur Lovense."
    }, 500);
  }
});
