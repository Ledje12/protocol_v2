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
  if (req.method !== "GET" && req.method !== "POST") {
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
       CONNEXION ACTIVE DU COUPLE

       Important :
       status = appareil disponible pour le duo,
       pas uniquement pour le compte qui l'a associé.
       ===================================================== */ const { data: connections, error: connectionError } = await admin.from("protocol_lovense_connections").select(`
            id,
            user_id,
            toys,
            platform,
            app_version,
            connected_at,
            updated_at
          `).eq("couple_id", membership.couple_id).not("connected_at", "is", null).order("updated_at", {
      ascending: false
    }).limit(5);
    if (connectionError) {
      throw connectionError;
    }
    /* =====================================================
       TROUVER UNE CONNEXION AVEC UN JOUET ONLINE
       ===================================================== */ let activeConnection = null;
    let activeToys = [];
    for (const connection of connections || []){
      const rawToys = Array.isArray(connection?.toys) ? connection.toys : connection?.toys && typeof connection.toys === "object" ? Object.values(connection.toys) : [];
      const toys = rawToys.map((toy)=>({
          id: toy?.id || null,
          name: toy?.name || toy?.toyName || null,
          toyType: toy?.toyType || null,
          battery: Number.isFinite(Number(toy?.battery)) ? Number(toy.battery) : null,
          connected: toy?.connected !== false
        })).filter((toy)=>Boolean(toy.id || toy.name));
      const onlineToys = toys.filter((toy)=>toy.connected);
      if (onlineToys.length > 0) {
        activeConnection = connection;
        activeToys = onlineToys;
        break;
      }
    }
    /* =====================================================
       RESPONSE
       ===================================================== */ if (!activeConnection) {
      return json({
        success: true,
        connected: false,
        toys: [],
        platform: null,
        appVersion: null,
        connectedAt: null,
        updatedAt: null
      });
    }
    return json({
      success: true,
      connected: true,
      toys: activeToys,
      platform: activeConnection.platform || null,
      appVersion: activeConnection.app_version || null,
      connectedAt: activeConnection.connected_at || null,
      updatedAt: activeConnection.updated_at || null
    });
  } catch (error) {
    console.error("LOVENSE STATUS ERROR:", error);
    return json({
      success: false,
      connected: false,
      error: "Erreur statut Lovense."
    }, 500);
  }
});
