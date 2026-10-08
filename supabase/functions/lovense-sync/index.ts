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
function safeString(value, maxLength = 200) {
  if (value === null || value === undefined) {
    return null;
  }
  const text = String(value).trim().slice(0, maxLength);
  return text || null;
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
    if (!supabaseUrl || !anonKey || !serviceRoleKey) {
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
        error: "Aucun couple associé."
      }, 403);
    }
    /* =====================================================
       CONNEXION COURANTE
       ===================================================== */ const { data: connection, error: connectionError } = await admin.from("protocol_lovense_connections").select(`
            id,
            lovense_uid
          `).eq("user_id", user.id).eq("couple_id", membership.couple_id).maybeSingle();
    if (connectionError) {
      throw connectionError;
    }
    if (!connection?.id) {
      return json({
        success: false,
        error: "Connexion Lovense introuvable."
      }, 404);
    }
    /* =====================================================
       BODY
       ===================================================== */ const body = await req.json().catch(()=>({}));
    const connected = body?.connected === true;
    const rawToys = Array.isArray(body?.toys) ? body.toys : body?.toys && typeof body.toys === "object" ? Object.values(body.toys) : [];
    /* =====================================================
       NORMALISATION TOYS
       ===================================================== */ const normalizedToys = rawToys.slice(0, 20).map((toy)=>({
        id: safeString(toy?.id, 120),
        name: safeString(toy?.name, 120),
        toyType: safeString(toy?.toyType, 120),
        nickname: safeString(toy?.nickname, 120),
        battery: Number.isFinite(Number(toy?.battery)) ? Math.max(0, Math.min(100, Number(toy.battery))) : null,
        connected: toy?.connected === true
      })).filter((toy)=>toy.id);
    /*
     * On ne marque connecté que si :
     *
     * - le SDK dit que l'app est connectée
     * - au moins un jouet est réellement online
     */ const hasOnlineToy = normalizedToys.some((toy)=>toy.connected === true);
    const effectiveConnected = connected && hasOnlineToy;
    const now = new Date().toISOString();
    /* =====================================================
       UPDATE
       ===================================================== */ const { error: updateError } = await admin.from("protocol_lovense_connections").update({
      toys: normalizedToys,
      connected_at: effectiveConnected ? now : null,
      updated_at: now,
      platform: safeString(body?.deviceInfo?.platform, 80),
      app_version: safeString(body?.deviceInfo?.appVersion, 80),
      domain: safeString(body?.deviceInfo?.domain, 200),
      https_port: safeString(body?.deviceInfo?.httpsPort, 20)
    }).eq("id", connection.id);
    if (updateError) {
      throw updateError;
    }
    /* =====================================================
       RESPONSE
       ===================================================== */ return json({
      success: true,
      connected: effectiveConnected,
      toyCount: normalizedToys.filter((toy)=>toy.connected).length
    });
  } catch (error) {
    console.error("LOVENSE SYNC ERROR:", error);
    return json({
      success: false,
      error: "Erreur serveur Lovense."
    }, 500);
  }
});
