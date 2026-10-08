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
Deno.serve(async (req)=>{
  if (req.method === "OPTIONS") {
    return new Response("ok", {
      headers: corsHeaders
    });
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
       AUTHENTIFICATION SUPABASE
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
       CLIENT SERVEUR
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
       NOM D'AFFICHAGE
       ===================================================== */ const { data: profile } = await admin.from("protocol_profiles").select("display_name").eq("user_id", user.id).maybeSingle();
    const displayName = String(profile?.display_name || "PROTOCOL").trim().slice(0, 80);
    /* =====================================================
       IDENTIFIANTS LOVENSE OPAQUES

       Jamais de prénom, email ou user_id Supabase envoyé
       comme uid Lovense.
       ===================================================== */ const { data: existingConnection, error: existingConnectionError } = await admin.from("protocol_lovense_connections").select("lovense_uid").eq("user_id", user.id).eq("couple_id", coupleId).maybeSingle();
    if (existingConnectionError) {
      throw existingConnectionError;
    }
    const lovenseUid = existingConnection?.lovense_uid || crypto.randomUUID();
    const userToken = crypto.randomUUID();
    /* =====================================================
       GENERATION QR LOVENSE
       ===================================================== */ const lovenseResponse = await fetch("https://api.lovense-api.com/api/lan/getQrCode", {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        token: developerToken,
        uid: lovenseUid,
        uname: displayName,
        utoken: userToken,
        v: 2
      })
    });
    const lovenseData = await lovenseResponse.json().catch(()=>null);
    if (!lovenseResponse.ok || lovenseData?.code !== 0 || lovenseData?.result !== true) {
      console.error("LOVENSE CONNECT API ERROR:", {
        status: lovenseResponse.status,
        code: lovenseData?.code,
        message: lovenseData?.message
      });
      return json({
        success: false,
        error: lovenseData?.message || "Impossible de générer le QR Lovense."
      }, 502);
    }
    const qr = lovenseData?.data?.qr;
    const code = lovenseData?.data?.code;
    if (!qr) {
      throw new Error("Lovense n'a renvoyé aucun QR code.");
    }
    /* =====================================================
       CONNEXION EN ATTENTE

       Important :
       on enregistre utoken AVANT de renvoyer le QR
       au navigateur.

       Le callback pourra donc être authentifié.
       ===================================================== */ const now = new Date().toISOString();
    const { error: connectionError } = await admin.from("protocol_lovense_connections").upsert({
      user_id: user.id,
      couple_id: coupleId,
      lovense_uid: lovenseUid,
      utoken: userToken,
      domain: null,
      http_port: null,
      https_port: null,
      ws_port: null,
      wss_port: null,
      platform: null,
      app_version: null,
      toys: {},
      connected_at: null,
      updated_at: now
    }, {
      onConflict: "couple_id,user_id"
    });
    if (connectionError) {
      console.error("LOVENSE CONNECTION DB ERROR:", connectionError);
      return json({
        success: false,
        error: "Impossible de préparer la connexion Lovense."
      }, 500);
    }
    /* =====================================================
       RESPONSE

       Aucun utoken
       Aucun lovense_uid
       Aucun owner_key
       ===================================================== */ return json({
      success: true,
      qr,
      code: code || null
    });
  } catch (error) {
    console.error("LOVENSE CONNECT ERROR:", error);
    return json({
      success: false,
      error: error?.message || "Erreur serveur Lovense."
    }, 500);
  }
});
