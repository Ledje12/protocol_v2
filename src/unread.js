import {
  useEffect,
  useState,
} from "react";

/*
 * Compteurs « non lus » de l'accueil.
 *
 * Messages : reçus, sans read_at. L'écran Messages les marque
 * lus via la fonction SQL mark_protocol_messages_read (migration
 * 20261008_mark_messages_read.sql). Tant qu'elle n'est pas
 * déployée, une date « vu le » gardée sur l'appareil prend le
 * relais, pour que le badge disparaisse quand même.
 *
 * Invitations : reçues et pas encore ouvertes (opened_at vide,
 * déjà rempli à l'ouverture de la carte).
 */

const MESSAGES_SEEN_KEY =
  "protocol-messages-seen-at";

function getMessagesSeenAt() {
  try {
    return (
      localStorage.getItem(
        MESSAGES_SEEN_KEY
      ) || "1970-01-01T00:00:00Z"
    );
  } catch {
    return "1970-01-01T00:00:00Z";
  }
}

export async function markMessagesSeen(
  supabase
) {
  try {
    localStorage.setItem(
      MESSAGES_SEEN_KEY,
      new Date().toISOString()
    );
  } catch {
    // stockage indisponible : la fonction SQL suffit
  }

  try {
    await supabase.rpc(
      "mark_protocol_messages_read"
    );
  } catch {
    // fonction pas encore déployée : le repli local suffit
  }
}

async function countUnread(
  supabase,
  userId
) {
  const [
    messages,
    invitations,
  ] = await Promise.all([
    supabase
      .from("protocol_messages")
      .select("id", {
        count: "exact",
        head: true,
      })
      .eq(
        "recipient_user_id",
        userId
      )
      .is("read_at", null)
      .gt(
        "created_at",
        getMessagesSeenAt()
      ),

    supabase
      .from("card_invitations")
      .select("id", {
        count: "exact",
        head: true,
      })
      .eq(
        "recipient_user_id",
        userId
      )
      .is("opened_at", null),
  ]);

  return {
    messages:
      messages.error
        ? 0
        : messages.count || 0,
    invitations:
      invitations.error
        ? 0
        : invitations.count || 0,
  };
}

export function useUnreadCounts(
  supabase,
  userId
) {
  const [counts, setCounts] =
    useState({
      messages: 0,
      invitations: 0,
    });

  useEffect(() => {
    if (!userId) {
      return undefined;
    }

    let active = true;

    const refresh =
      async () => {
        try {
          const next =
            await countUnread(
              supabase,
              userId
            );

          if (active) {
            setCounts(next);
          }
        } catch (err) {
          console.warn(
            "UNREAD COUNT ERROR:",
            err
          );
        }
      };

    refresh();

    const timer =
      window.setInterval(
        refresh,
        30000
      );

    const onVisible = () => {
      if (
        document.visibilityState ===
        "visible"
      ) {
        refresh();
      }
    };

    document.addEventListener(
      "visibilitychange",
      onVisible
    );

    return () => {
      active = false;

      window.clearInterval(timer);

      document.removeEventListener(
        "visibilitychange",
        onVisible
      );
    };
  }, [
    supabase,
    userId,
  ]);

  return counts;
}
