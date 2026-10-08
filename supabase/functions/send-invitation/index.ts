import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { buildPushPayload } from "https://esm.sh/@block65/webcrypto-web-push@2.0.0";
const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type"
};
const SIGNALS = {
  secret: {
    body: (senderName)=>`${senderName} a un secret à partager avec toi…`
  },
  challenge: {
    body: (senderName)=>`${senderName} te laisse lui choisir un défi.`
  },
  tonight: {
    body: (senderName)=>`${senderName} propose PROTOCOL ce soir.`
  }
};
function isSignalKey(value) {
  return typeof value === "string" && value in SIGNALS;
}
Deno.serve(async (req)=>{
  /* =====================================================
       CORS
       ===================================================== */ if (req.method === "OPTIONS") {
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
      return new Response(JSON.stringify({
        success: false,
        error: "Authentication required."
      }), {
        status: 401,
        headers: {
          ...corsHeaders,
          "Content-Type": "application/json"
        }
      });
    }
    const token = authorization.slice(7);
    const { data: authData, error: authError } = await supabase.auth.getUser(token);
    const currentUser = authData?.user;
    if (authError || !currentUser) {
      return new Response(JSON.stringify({
        success: false,
        error: "Session invalide."
      }), {
        status: 401,
        headers: {
          ...corsHeaders,
          "Content-Type": "application/json"
        }
      });
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
         PROFILES
         ===================================================== */ const { data: profiles, error: profilesError } = await supabase.from("protocol_profiles").select(`
            user_id,
            display_name,
            sex
          `).in("user_id", [
      currentUser.id,
      recipientUserId
    ]);
    if (profilesError) {
      throw profilesError;
    }
    const senderProfile = profiles?.find((profile)=>profile.user_id === currentUser.id);
    const recipientProfile = profiles?.find((profile)=>profile.user_id === recipientUserId);
    if (!senderProfile || !recipientProfile) {
      throw new Error("Profil partenaire incomplet.");
    }
    const senderName = senderProfile.display_name || "Ton partenaire";
    /* =====================================================
         REQUEST
         ===================================================== */ const body = await req.json();
    const rawCardId = body?.card_id;
    const rawCardSource = body?.card_source;
    const cardSource = rawCardSource === "custom" ? "custom" : "official";
    const cardId = rawCardId !== undefined && rawCardId !== null ? Number(rawCardId) : null;
    const signal = body?.signal;
    const rawChallengeId = body?.challenge_id;
    const challengeId = rawChallengeId !== undefined && rawChallengeId !== null && rawChallengeId !== "" ? Number(rawChallengeId) : null;
    const requestKey = typeof body?.request_key === "string" ? body.request_key.trim() : "";
    const isCardInvitation = Number.isInteger(cardId);
    if (isCardInvitation && !requestKey) {
      return new Response(JSON.stringify({
        success: false,
        error: "Clé d'idempotence manquante."
      }), {
        status: 400,
        headers: {
          ...corsHeaders,
          "Content-Type": "application/json"
        }
      });
    }
    const isSignalInvitation = isSignalKey(signal);
    if (!isCardInvitation && !isSignalInvitation) {
      return new Response(JSON.stringify({
        success: false,
        error: "card_id ou signal est requis."
      }), {
        status: 400,
        headers: {
          ...corsHeaders,
          "Content-Type": "application/json"
        }
      });
    }
    /* =====================================================
         CREATE SIGNAL
         ===================================================== */ let createdSignalId = null;
    // tous les signes sont enregistrés : ils restent visibles dans l'app
    // (Invitations) même si la notification n'arrive pas
    if (isSignalInvitation) {
      const { data: createdSignal, error: signalCreateError } = await supabase.from("protocol_signals").insert({
        type: signal,
        sender_user_id: currentUser.id,
        recipient_user_id: recipientUserId,
        couple_id: coupleId,
        status: "pending"
      }).select("id").single();
      if (signalCreateError || !createdSignal) {
        console.error("SIGNAL CREATE ERROR:", signalCreateError);
        throw new Error("Impossible de créer le signal.");
      }
      createdSignalId = createdSignal.id;
    }
    /* =====================================================
         CHALLENGE EXISTANT
         ===================================================== */ let challenge = null;
    if (challengeId !== null) {
      if (!Number.isInteger(challengeId)) {
        return new Response(JSON.stringify({
          success: false,
          error: "challenge_id invalide."
        }), {
          status: 400,
          headers: {
            ...corsHeaders,
            "Content-Type": "application/json"
          }
        });
      }
      const { data: challengeRow, error: challengeError } = await supabase.from("protocol_signals").select(`
              id,
              type,
              sender_user_id,
              recipient_user_id,
              couple_id,
              status
            `).eq("id", challengeId).eq("type", "challenge").single();
      if (challengeError || !challengeRow) {
        return new Response(JSON.stringify({
          success: false,
          error: "Demande de défi introuvable."
        }), {
          status: 404,
          headers: {
            ...corsHeaders,
            "Content-Type": "application/json"
          }
        });
      }
      if (challengeRow.status !== "pending" || challengeRow.recipient_user_id !== currentUser.id || challengeRow.sender_user_id !== recipientUserId || challengeRow.couple_id !== coupleId) {
        return new Response(JSON.stringify({
          success: false,
          error: "Cette demande de défi n'est plus valide."
        }), {
          status: 400,
          headers: {
            ...corsHeaders,
            "Content-Type": "application/json"
          }
        });
      }
      challenge = challengeRow;
    }
    /* =====================================================
         CARD MODE
         ===================================================== */ let card = null;
    let invitation = null;
    if (isCardInvitation && cardId !== null) {
      let loadedCard = null;
      if (cardSource === "custom") {
        const { data: customCard, error: customCardError } = await supabase.from("protocol_custom_cards").select(`
                id,
                title,
                target_sex,
                active,
                couple_id,
                deleted_at
              `).eq("id", cardId).eq("couple_id", coupleId).is("deleted_at", null).single();
        if (customCardError || !customCard) {
          return new Response(JSON.stringify({
            success: false,
            error: "Carte personnalisée introuvable."
          }), {
            status: 404,
            headers: {
              ...corsHeaders,
              "Content-Type": "application/json"
            }
          });
        }
        loadedCard = customCard;
      } else {
        const { data: officialCard, error: officialCardError } = await supabase.from("protocol_cards").select(`
                id,
                title,
                target_sex,
                active,
                library_version
              `).eq("id", cardId).eq("active", true).eq("library_version", "v1").single();
        if (officialCardError || !officialCard) {
          return new Response(JSON.stringify({
            success: false,
            error: "Carte introuvable."
          }), {
            status: 404,
            headers: {
              ...corsHeaders,
              "Content-Type": "application/json"
            }
          });
        }
        loadedCard = officialCard;
      }
      card = loadedCard;
      if (card.target_sex && card.target_sex !== recipientProfile.sex) {
        return new Response(JSON.stringify({
          success: false,
          error: "Cette carte n'est pas destinée à ce partenaire."
        }), {
          status: 400,
          headers: {
            ...corsHeaders,
            "Content-Type": "application/json"
          }
        });
      }
      const { data: createdInvitation, error: invitationError } = await supabase.from("card_invitations").insert({
        request_key: requestKey,
        card_source: cardSource,
        card_id: cardSource === "official" ? card.id : null,
        custom_card_id: cardSource === "custom" ? card.id : null,
        sender_user_id: currentUser.id,
        recipient_user_id: recipientUserId,
        couple_id: coupleId
      }).select(`
              id,
              sent_at
            `).maybeSingle();
      if (invitationError?.code === "23505") {
        const { data: existingInvitation, error: existingInvitationError } = await supabase.from("card_invitations").select(`
                id,
                card_source,
                card_id,
                custom_card_id,
                sender_user_id,
                recipient_user_id,
                couple_id,
                sent_at
              `).eq("request_key", requestKey).maybeSingle();
        if (existingInvitationError || !existingInvitation) {
          console.error("INVITATION IDEMPOTENCY LOAD ERROR:", existingInvitationError);
          throw new Error("Impossible de récupérer l'invitation existante.");
        }
        if ((existingInvitation.card_source || "official") !== cardSource || cardSource === "official" && Number(existingInvitation.card_id) !== Number(card.id) || cardSource === "custom" && Number(existingInvitation.custom_card_id) !== Number(card.id) || existingInvitation.sender_user_id !== currentUser.id || existingInvitation.recipient_user_id !== recipientUserId || existingInvitation.couple_id !== coupleId) {
          return new Response(JSON.stringify({
            success: false,
            error: "Clé d'envoi déjà utilisée pour une autre invitation."
          }), {
            status: 409,
            headers: {
              ...corsHeaders,
              "Content-Type": "application/json"
            }
          });
        }
        invitation = {
          id: existingInvitation.id,
          sent_at: existingInvitation.sent_at
        };
        return new Response(JSON.stringify({
          success: true,
          type: "card",
          card_id: card.id,
          invitation_id: existingInvitation.id,
          challenge_id: challenge?.id || null,
          recipient_user_id: recipientUserId,
          couple_id: coupleId,
          sent_at: existingInvitation.sent_at,
          sent: 0,
          push_sent: false,
          duplicate_request: true
        }), {
          status: 200,
          headers: {
            ...corsHeaders,
            "Content-Type": "application/json"
          }
        });
      } else if (invitationError || !createdInvitation) {
        console.error("INVITATION CREATE ERROR:", invitationError);
        throw new Error("Impossible de créer l'invitation.");
      } else {
        invitation = createdInvitation;
      }
    }
    /* =====================================================
         PUSH SUBSCRIPTIONS
         ===================================================== */ const { data: subscriptions, error: subscriptionsError } = await supabase.from("push_subscriptions").select(`
            id,
            endpoint,
            p256dh,
            auth
          `).eq("user_id", recipientUserId).eq("active", true);
    if (subscriptionsError) {
      throw subscriptionsError;
    }
    if (!subscriptions || subscriptions.length === 0) {
      if (isCardInvitation && invitation) {
        return new Response(JSON.stringify({
          success: true,
          type: "card",
          card_id: card.id,
          invitation_id: invitation.id,
          challenge_id: challenge?.id || null,
          sent_at: invitation.sent_at,
          sent: 0,
          push_sent: false,
          warning: "Invitation créée, mais aucun appareil actif pour la notification push."
        }), {
          status: 200,
          headers: {
            ...corsHeaders,
            "Content-Type": "application/json"
          }
        });
      }
      if (isSignalInvitation && createdSignalId) {
        return new Response(JSON.stringify({
          success: true,
          type: "signal",
          signal,
          signal_id: createdSignalId,
          sent: 0,
          push_sent: false,
          warning: "Signe enregistré, mais aucun appareil actif pour la notification push."
        }), {
          status: 200,
          headers: {
            ...corsHeaders,
            "Content-Type": "application/json"
          }
        });
      }
      return new Response(JSON.stringify({
        success: false,
        error: "Aucun appareil actif pour le destinataire."
      }), {
        status: 404,
        headers: {
          ...corsHeaders,
          "Content-Type": "application/json"
        }
      });
    }
    /* =====================================================
         PUSH MESSAGE
         ===================================================== */ let pushBody;
    let pushUrl;
    let pushTag;
    if (isSignalInvitation) {
      pushBody = SIGNALS[signal].body(senderName);
      if (signal === "challenge" && createdSignalId) {
        pushUrl = `/library?challenge=${createdSignalId}`;
      } else {
        // la notification ouvre la boîte de réception, où le signe est visible
        pushUrl = "/invitations";
      }
      pushTag = `protocol-signal-${currentUser.id}-${signal}`;
    } else {
      pushBody = `${senderName} te propose un défi… 🔥`;
      pushUrl = `/card/${card.id}?invite=${invitation.id}`;
      pushTag = `protocol-card-${invitation.id}`;
    }
    /* =====================================================
         VAPID
         ===================================================== */ const vapid = {
      subject: vapidSubject,
      publicKey: vapidPublicKey,
      privateKey: vapidPrivateKey
    };
    /* =====================================================
         SEND PUSH
         ===================================================== */ let sentCount = 0;
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
        const message = {
          data: {
            title: "PROTOCOL",
            body: pushBody,
            url: pushUrl,
            tag: pushTag,
            signal: isSignalInvitation ? signal : null
          },
          options: {
            ttl: 86400
          }
        };
        const pushPayload = await buildPushPayload(message, pushSubscription, vapid);
        const response = await fetch(subscription.endpoint, pushPayload);
        if (response.ok) {
          sentCount += 1;
          continue;
        }
        if (response.status === 404 || response.status === 410) {
          await supabase.from("push_subscriptions").update({
            active: false,
            updated_at: new Date().toISOString()
          }).eq("id", subscription.id);
        }
        console.error("PUSH SEND ERROR:", response.status, await response.text());
      } catch (err) {
        console.error("PUSH ERROR:", err);
      }
    }
    /* =====================================================
         COMPLETE CHALLENGE
         ===================================================== */ if (challenge && card && cardSource === "official" && sentCount > 0) {
      const { error: challengeUpdateError } = await supabase.from("protocol_signals").update({
        status: "completed",
        card_id: card.id,
        completed_at: new Date().toISOString()
      }).eq("id", challenge.id).eq("status", "pending");
      if (challengeUpdateError) {
        console.error("CHALLENGE COMPLETE ERROR:", challengeUpdateError);
      }
    }
    /* =====================================================
         RESULT
         ===================================================== */ if (sentCount === 0) {
      if (isCardInvitation && invitation) {
        return new Response(JSON.stringify({
          success: true,
          type: "card",
          card_id: card.id,
          invitation_id: invitation.id,
          challenge_id: challenge?.id || null,
          sent_at: invitation.sent_at,
          sent: 0,
          push_sent: false,
          warning: "Invitation créée, mais la notification push n'a pas pu être envoyée."
        }), {
          status: 200,
          headers: {
            ...corsHeaders,
            "Content-Type": "application/json"
          }
        });
      }
      return new Response(JSON.stringify({
        success: false,
        error: "La notification n'a pas pu être envoyée."
      }), {
        status: 500,
        headers: {
          ...corsHeaders,
          "Content-Type": "application/json"
        }
      });
    }
    if (isSignalInvitation) {
      return new Response(JSON.stringify({
        success: true,
        type: "signal",
        signal,
        signal_id: createdSignalId,
        recipient_user_id: recipientUserId,
        couple_id: coupleId,
        sent: sentCount
      }), {
        status: 200,
        headers: {
          ...corsHeaders,
          "Content-Type": "application/json"
        }
      });
    }
    return new Response(JSON.stringify({
      success: true,
      type: "card",
      card_id: card.id,
      invitation_id: invitation.id,
      challenge_id: challenge?.id || null,
      recipient_user_id: recipientUserId,
      couple_id: coupleId,
      sent_at: invitation.sent_at,
      sent: sentCount
    }), {
      status: 200,
      headers: {
        ...corsHeaders,
        "Content-Type": "application/json"
      }
    });
  } catch (err) {
    console.error("SEND INVITATION ERROR:", err);
    return new Response(JSON.stringify({
      success: false,
      error: err instanceof Error ? err.message : "Erreur serveur."
    }), {
      status: 500,
      headers: {
        ...corsHeaders,
        "Content-Type": "application/json"
      }
    });
  }
});
