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
function safeString(value, maxLength) {
  if (value === null || value === undefined) {
    return null;
  }
  const normalized = String(value).trim();
  if (!normalized) {
    return null;
  }
  return normalized.slice(0, maxLength);
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
    const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
    if (!supabaseUrl || !serviceRoleKey) {
      throw new Error("Configuration serveur manquante.");
    }
    const admin = createClient(supabaseUrl, serviceRoleKey, {
      auth: {
        persistSession: false,
        autoRefreshToken: false
      }
    });
    /* =====================================================
       CALLBACK LOVENSE
       ===================================================== */ const body = await req.json().catch(()=>null);
    if (!body || typeof body !== "object") {
      return json({
        success: false,
        error: "Payload invalide."
      }, 400);
    }
    const lovenseUid = safeString(body?.uid, 128);
    const userToken = safeString(body?.utoken, 128);
    if (!lovenseUid || !userToken) {
      return json({
        success: false,
        error: "Identifiants de callback manquants."
      }, 400);
    }
    /* =====================================================
       AUTHENTIFICATION DU CALLBACK

       On ne crée JAMAIS une ligne ici.

       Une ligne pending doit déjà avoir été créée
       par lovense-connect avec :
         - lovense_uid
         - utoken
         - user_id
         - couple_id

       Le callback ne peut que compléter cette ligne.
       ===================================================== */ const { data: pendingConnection, error: pendingError } = await admin.from("protocol_lovense_connections").select(`
            id,
            user_id,
            couple_id,
            lovense_uid,
            utoken
          `).eq("lovense_uid", lovenseUid).eq("utoken", userToken).maybeSingle();
    if (pendingError) {
      throw pendingError;
    }
    if (!pendingConnection) {
      console.warn("LOVENSE CALLBACK REJECTED:", {
        uid: lovenseUid
      });
      return json({
        success: false,
        error: "Callback Lovense non autorisé."
      }, 403);
    }
    /* =====================================================
       DONNEES LOVENSE
       ===================================================== */ const domain = safeString(body?.domain, 255);
    const httpPort = safeString(body?.httpPort, 16);
    const httpsPort = safeString(body?.httpsPort, 16);
    const wsPort = safeString(body?.wsPort, 16);
    const wssPort = safeString(body?.wssPort, 16);
    const platform = safeString(body?.platform, 80);
    const appVersion = safeString(body?.appVersion, 80);
    /* =====================================================
       TOYS

       On accepte uniquement un objet JSON raisonnable.
       ===================================================== */ let toys = {};
    if (body?.toys && typeof body.toys === "object" && !Array.isArray(body.toys)) {
      const serialized = JSON.stringify(body.toys);
      if (serialized.length > 200000) {
        return json({
          success: false,
          error: "Payload Lovense trop volumineux."
        }, 413);
      }
      toys = body.toys;
    }
    /* =====================================================
       MISE A JOUR DE LA CONNEXION EXISTANTE

       Pas d'upsert.
       Pas de user_id venant du callback.
       Pas de couple_id venant du callback.
       ===================================================== */ const now = new Date().toISOString();
    const { error: updateError } = await admin.from("protocol_lovense_connections").update({
      domain,
      http_port: httpPort,
      https_port: httpsPort,
      ws_port: wsPort,
      wss_port: wssPort,
      platform,
      app_version: appVersion,
      toys,
      connected_at: now,
      updated_at: now
    }).eq("id", pendingConnection.id);
    if (updateError) {
      throw updateError;
    }
    /* =====================================================
       LOG MINIMAL

       Pas de utoken.
       Pas de contenu détaillé des toys.
       ===================================================== */ console.log("LOVENSE CALLBACK ACCEPTED:", {
      connectionId: pendingConnection.id,
      userId: pendingConnection.user_id,
      coupleId: pendingConnection.couple_id,
      toyCount: Object.keys(toys).length
    });
    return json({
      success: true
    });
  } catch (error) {
    console.error("LOVENSE CALLBACK ERROR:", error);
    return json({
      success: false,
      error: "Erreur serveur Lovense."
    }, 500);
  }
});
