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
       UID LOVENSE PERSISTANT ET OPAQUE

       On réutilise celui déjà associé à l'utilisateur.

       S'il n'existe pas encore, on crée une ligne pending.
       ===================================================== */ let { data: connection, error: connectionError } = await admin.from("protocol_lovense_connections").select(`
            id,
            lovense_uid
          `).eq("user_id", user.id).eq("couple_id", membership.couple_id).maybeSingle();
    if (connectionError) {
      throw connectionError;
    }
    if (!connection) {
      const lovenseUid = crypto.randomUUID();
      const { data: createdConnection, error: createError } = await admin.from("protocol_lovense_connections").insert({
        user_id: user.id,
        couple_id: membership.couple_id,
        lovense_uid: lovenseUid,
        utoken: null,
        toys: {},
        connected_at: null,
        updated_at: new Date().toISOString()
      }).select(`
              id,
              lovense_uid
            `).single();
      if (createError) {
        throw createError;
      }
      connection = createdConnection;
    }
    if (!connection?.lovense_uid) {
      throw new Error("Identifiant Lovense indisponible.");
    }
    /* =====================================================
       TOKEN SDK LOVENSE

       Le developer token reste exclusivement serveur.
       ===================================================== */ const lovenseResponse = await fetch("https://api.lovense-api.com/api/basicApi/getToken", {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        token: developerToken,
        uid: connection.lovense_uid,
        /*
             * On évite volontairement prénom,
             * email ou autre donnée personnelle.
             */ uname: "PROTOCOL"
      })
    });
    const lovenseData = await lovenseResponse.json().catch(()=>null);
    const authToken = lovenseData?.data?.authToken;
    if (!lovenseResponse.ok || lovenseData?.code !== 0 || !authToken) {
      console.error("LOVENSE AUTH API ERROR:", {
        status: lovenseResponse.status,
        code: lovenseData?.code,
        message: lovenseData?.message || null
      });
      return json({
        success: false,
        error: lovenseData?.message || "Impossible d'obtenir le token Lovense."
      }, 502);
    }
    /* =====================================================
       RESPONSE SDK

       uid n'est pas secret.
       authToken est nécessaire au SDK navigateur.

       On ne renvoie :
         - aucun developer token
         - aucun user_id Supabase
         - aucun couple_id
         - aucun utoken
       ===================================================== */ return json({
      success: true,
      uid: connection.lovense_uid,
      authToken,
      platform: "PROTOCOL"
    });
  } catch (error) {
    console.error("LOVENSE AUTH ERROR:", error);
    return json({
      success: false,
      error: "Erreur serveur Lovense."
    }, 500);
  }
});
