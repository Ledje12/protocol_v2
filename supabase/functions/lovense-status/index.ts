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
       JOUETS DU COUPLE
       Toutes les connexions comptent : deux jouets sur un
       téléphone, ou un jouet chacun sur le sien. Type déduit du
       nom Lovense (Lush pour elle, Diamo pour lui).
       ===================================================== */ const { data: connections, error: connectionError } = await admin.from("protocol_lovense_connections").select(`
            id,
            user_id,
            lovense_uid,
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
    const toyType = (toy)=>{
      const label = [
        toy?.toyType,
        toy?.name,
        toy?.type
      ].filter(Boolean).join(" ").toLowerCase();
      if (label.includes("lush")) return "lush";
      if (label.includes("diamo")) return "ring";
      return "other";
    };
    const isOnline = (toy)=>toy?.connected === true || String(toy?.status ?? "") === "1" || toy?.status === true;
    const seen = new Set();
    const toys = [];
    for (const connection of connections || []){
      if (!connection?.lovense_uid) {
        continue;
      }
      const rawToys = Array.isArray(connection?.toys) ? connection.toys : connection?.toys && typeof connection.toys === "object" ? Object.values(connection.toys) : [];
      for (const toy of rawToys){
        const id = toy?.id ? String(toy.id) : null;
        if (!id || seen.has(id) || !isOnline(toy)) {
          continue;
        }
        seen.add(id);
        toys.push({
          id,
          name: toy?.nickname || toy?.nickName || toy?.name || toy?.toyName || "Jouet Lovense",
          type: toyType(toy),
          battery: Number.isFinite(Number(toy?.battery)) ? Number(toy.battery) : null,
          connected: true,
          // jouet relié depuis le téléphone de ce compte ou de l'autre
          mine: connection.user_id === user.id
        });
      }
    }
    const latest = (connections || []).find((connection)=>connection?.lovense_uid) || null;
    /* =====================================================
       RESPONSE
       ===================================================== */ return json({
      success: true,
      connected: toys.length > 0,
      toys,
      has: {
        lush: toys.some((toy)=>toy.type === "lush"),
        ring: toys.some((toy)=>toy.type === "ring")
      },
      platform: latest?.platform || null,
      appVersion: latest?.app_version || null,
      connectedAt: latest?.connected_at || null,
      updatedAt: latest?.updated_at || null
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
