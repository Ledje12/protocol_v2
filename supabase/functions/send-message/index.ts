import { createClient } from "npm:@supabase/supabase-js@2";
import { buildPushPayload } from "npm:@block65/webcrypto-web-push@2.0.0";
const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type"
};
Deno.serve(async (req)=>{
  if (req.method === "OPTIONS") {
    return new Response("ok", {
      headers: corsHeaders
    });
  }
  try {
    /* =====================================================
         CONFIG
         ===================================================== */ const supabaseUrl = Deno.env.get("SUPABASE_URL");
    const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
    const vapidPublicKey = Deno.env.get("VAPID_PUBLIC_KEY");
    const vapidPrivateKey = Deno.env.get("VAPID_PRIVATE_KEY");
    const vapidSubject = Deno.env.get("VAPID_SUBJECT");
    if (!supabaseUrl || !serviceRoleKey || !vapidPublicKey || !vapidPrivateKey || !vapidSubject) {
      throw new Error("Configuration serveur incomplète.");
    }
    const supabase = createClient(supabaseUrl, serviceRoleKey, {
      auth: {
        persistSession: false
      }
    });
    /* =====================================================
         AUTH
         ===================================================== */ const authorization = req.headers.get("Authorization");
    if (!authorization || !authorization.startsWith("Bearer ")) {
      return Response.json({
        success: false,
        error: "Authentication required."
      }, {
        status: 401,
        headers: corsHeaders
      });
    }
    const token = authorization.slice(7);
    const { data: authData, error: authError } = await supabase.auth.getUser(token);
    const currentUser = authData?.user;
    if (authError || !currentUser) {
      return Response.json({
        success: false,
        error: "Session invalide."
      }, {
        status: 401,
        headers: corsHeaders
      });
    }
    /* =====================================================
         INPUT
         ===================================================== */ const body = await req.json();
    const messageBody = String(body?.body || "").trim();
    if (!messageBody) {
      throw new Error("Le message est vide.");
    }
    if (messageBody.length > 1200) {
      throw new Error("Le message est trop long.");
    }
    /* =====================================================
         COUPLE
         ===================================================== */ const { data: ownMembership, error: ownMembershipError } = await supabase.from("protocol_couple_members").select("couple_id").eq("user_id", currentUser.id).maybeSingle();
    if (ownMembershipError) {
      throw ownMembershipError;
    }
    if (!ownMembership?.couple_id) {
      throw new Error("Aucun partenaire associé à ce compte.");
    }
    const coupleId = ownMembership.couple_id;
    const { data: partnerMembership, error: partnerMembershipError } = await supabase.from("protocol_couple_members").select("user_id").eq("couple_id", coupleId).neq("user_id", currentUser.id).maybeSingle();
    if (partnerMembershipError) {
      throw partnerMembershipError;
    }
    if (!partnerMembership?.user_id) {
      throw new Error("Partenaire introuvable.");
    }
    const recipientUserId = partnerMembership.user_id;
    /* =====================================================
         PROFILE
         ===================================================== */ const { data: senderProfile, error: profileError } = await supabase.from("protocol_profiles").select("display_name").eq("user_id", currentUser.id).maybeSingle();
    if (profileError) {
      throw profileError;
    }
    const senderName = senderProfile?.display_name || "Ton partenaire";
    /* =====================================================
         CREATE MESSAGE
         ===================================================== */ const { data: createdMessage, error: messageError } = await supabase.from("protocol_messages").insert({
      sender_user_id: currentUser.id,
      recipient_user_id: recipientUserId,
      couple_id: coupleId,
      body: messageBody
    }).select(`
            id,
            sender_user_id,
            recipient_user_id,
            couple_id,
            body,
            reply_to_id,
            reaction,
            created_at,
            read_at
          `).single();
    if (messageError || !createdMessage) {
      console.error("MESSAGE CREATE ERROR:", messageError);
      throw new Error("Impossible d'enregistrer le message.");
    }
    /* =====================================================
         PUSH SUBSCRIPTIONS
         ===================================================== */ const { data: subscriptions, error: subscriptionError } = await supabase.from("push_subscriptions").select(`
            id,
            endpoint,
            p256dh,
            auth
          `).eq("user_id", recipientUserId).eq("active", true);
    if (subscriptionError) {
      console.error("SUBSCRIPTIONS ERROR:", subscriptionError);
    }
    /* =====================================================
         PUSH
         ===================================================== */ let sentCount = 0;
    const results = [];
    if (subscriptions && subscriptions.length > 0) {
      const vapid = {
        subject: vapidSubject,
        publicKey: vapidPublicKey,
        privateKey: vapidPrivateKey
      };
      const message = {
        title: "PROTOCOL",
        body: `${senderName} t’a laissé un message.`,
        url: `/messages?message=${createdMessage.id}`,
        tag: `protocol-message-${createdMessage.id}`
      };
      for (const subscription of subscriptions){
        try {
          const pushSubscription = {
            endpoint: subscription.endpoint,
            expirationTime: null,
            keys: {
              p256dh: subscription.p256dh,
              auth: subscription.auth
            }
          };
          const payload = await buildPushPayload({
            data: JSON.stringify(message),
            options: {
              ttl: 86400
            }
          }, pushSubscription, vapid);
          const response = await fetch(subscription.endpoint, payload);
          const responseText = await response.text();
          if (response.status === 404 || response.status === 410) {
            await supabase.from("push_subscriptions").update({
              active: false,
              updated_at: new Date().toISOString()
            }).eq("id", subscription.id);
            results.push({
              id: subscription.id,
              success: false,
              expired: true,
              status: response.status
            });
            continue;
          }
          if (!response.ok) {
            results.push({
              id: subscription.id,
              success: false,
              status: response.status,
              error: responseText
            });
            continue;
          }
          sentCount += 1;
          results.push({
            id: subscription.id,
            success: true,
            status: response.status
          });
        } catch (pushError) {
          console.error("MESSAGE PUSH ERROR:", pushError);
          results.push({
            id: subscription.id,
            success: false,
            error: pushError instanceof Error ? pushError.message : String(pushError)
          });
        }
      }
    }
    /* =====================================================
         RESULT
         ===================================================== */ return Response.json({
      success: true,
      message: createdMessage,
      push_sent: sentCount > 0,
      sent: sentCount,
      results
    }, {
      headers: corsHeaders
    });
  } catch (error) {
    console.error("SEND MESSAGE ERROR:", error);
    return Response.json({
      success: false,
      error: error instanceof Error ? error.message : String(error)
    }, {
      status: 500,
      headers: corsHeaders
    });
  }
});
