import { createClient } from "npm:@supabase/supabase-js@2";
import { buildPushPayload } from "npm:@block65/webcrypto-web-push@2.0.0";

/* Messages programmés : appelée chaque minute par pg_cron.
   Dépose dans la conversation les messages dont l'heure est
   venue (une seule fois chacun, côté base), puis prévient le
   destinataire comme un message normal.
   Sans JWT : elle n'envoie que ce qui est déjà dû, l'appeler plus
   souvent n'avance rien. */

Deno.serve(async () => {
  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL");
    const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
    const vapidPublicKey = Deno.env.get("VAPID_PUBLIC_KEY");
    const vapidPrivateKey = Deno.env.get("VAPID_PRIVATE_KEY");
    const vapidSubject = Deno.env.get("VAPID_SUBJECT");
    if (!supabaseUrl || !serviceRoleKey || !vapidPublicKey || !vapidPrivateKey || !vapidSubject) {
      throw new Error("Configuration serveur incomplète.");
    }
    const supabase = createClient(supabaseUrl, serviceRoleKey, {
      auth: { persistSession: false }
    });

    const { data: delivered, error: deliverError } = await supabase.rpc("protocol_deliver_scheduled_messages");
    if (deliverError) {
      throw deliverError;
    }

    const vapid = { subject: vapidSubject, publicKey: vapidPublicKey, privateKey: vapidPrivateKey };
    let pushed = 0;

    for (const item of delivered || []) {
      const { data: subscriptions } = await supabase.from("push_subscriptions").select("id, endpoint, p256dh, auth").eq("user_id", item.recipient_user_id).eq("active", true);
      if (!subscriptions?.length) {
        continue;
      }
      // notifications discrètes : rien de lisible sur l'écran verrouillé
      const { data: recipientPrefs } = await supabase.from("protocol_profiles").select("discreet_notifications").eq("user_id", item.recipient_user_id).maybeSingle();
      const discreet = recipientPrefs?.discreet_notifications === true;
      const message = {
        title: "PROTOCOL",
        body: discreet ? "Nouveau message." : `${item.sender_name || "Ton partenaire"} t’a laissé un message.`,
        url: `/messages?message=${item.message_id}`,
        tag: `protocol-message-${item.message_id}`
      };

      for (const subscription of subscriptions) {
        try {
          const payload = await buildPushPayload({
            data: JSON.stringify(message),
            options: { ttl: 86400 }
          }, {
            endpoint: subscription.endpoint,
            expirationTime: null,
            keys: { p256dh: subscription.p256dh, auth: subscription.auth }
          }, vapid);
          const response = await fetch(subscription.endpoint, payload);
          await response.text();
          if (response.status === 404 || response.status === 410) {
            await supabase.from("push_subscriptions").update({
              active: false,
              updated_at: new Date().toISOString()
            }).eq("id", subscription.id);
            continue;
          }
          if (response.ok) {
            pushed += 1;
          }
        } catch (pushError) {
          console.error("SCHEDULED PUSH ERROR:", pushError);
        }
      }
    }

    return Response.json({ success: true, delivered: delivered?.length || 0, pushed });
  } catch (error) {
    console.error("SEND SCHEDULED ERROR:", error);
    return Response.json({
      success: false,
      error: error instanceof Error ? error.message : String(error)
    }, { status: 500 });
  }
});
