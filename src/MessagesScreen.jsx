import {
  useEffect,
  useRef,
  useState,
} from "react";

import "./messages.css";
import { formatRelativeTime } from "./formatTime.js";
import { markMessagesSeen } from "./unread.js";
import { BackIcon } from "./ScreenHeader.jsx";

// PROTOCOL private messaging


export default function MessagesScreen({
  supabase,
  profile,
  couple,
  onBack,
}) {
  const [
    messages,
    setMessages,
  ] = useState([]);

  const [
    loading,
    setLoading,
  ] = useState(true);

  const [
    error,
    setError,
  ] = useState("");

  const [
    draft,
    setDraft,
  ] = useState("");

  const [
    sending,
    setSending,
  ] = useState(false);

  const currentUserId =
    profile?.user_id || null;

  const coupleId =
    couple?.id ||
    couple?.couple_id ||
    null;

  const partnerName =
    couple?.partner
      ?.display_name || "ton partenaire";

  const threadRef =
    useRef(null);

  useEffect(() => {
    const viewport =
      window.visualViewport;

    if (!viewport) {
      return;
    }

    const updateViewport = () => {
      document.documentElement.style.setProperty(
        "--messages-viewport-height",
        `${viewport.height}px`
      );

      document.documentElement.style.setProperty(
        "--messages-viewport-top",
        `${viewport.offsetTop}px`
      );
    };

    updateViewport();

    viewport.addEventListener(
      "resize",
      updateViewport
    );

    viewport.addEventListener(
      "scroll",
      updateViewport
    );

    return () => {
      viewport.removeEventListener(
        "resize",
        updateViewport
      );

      viewport.removeEventListener(
        "scroll",
        updateViewport
      );

      document.documentElement.style.removeProperty(
        "--messages-viewport-height"
      );

      document.documentElement.style.removeProperty(
        "--messages-viewport-top"
      );
    };
  }, []);

  /* =========================================================
     LOAD MESSAGES
     ========================================================= */

  useEffect(() => {
    let active = true;

    /* silent : actualisation en arrière-plan, sans état de
       chargement (l'écran reste en place, seuls les nouveaux
       messages apparaissent) */
    const loadMessages =
      async ({ silent = false } = {}) => {
        if (
          !currentUserId ||
          !coupleId
        ) {
          if (active) {
            setMessages([]);
            setLoading(false);
          }

          return;
        }

        try {
          if (!silent) {
            setLoading(true);
            setError("");
          }

          const {
            data,
            error: queryError,
          } = await supabase
            .from(
              "protocol_messages"
            )
            .select(
              `
                id,
                sender_user_id,
                recipient_user_id,
                couple_id,
                body,
                reply_to_id,
                reaction,
                created_at,
                read_at
              `
            )
            .eq(
              "couple_id",
              coupleId
            )
            .order(
              "created_at",
              {
                ascending: true,
              }
            );

          if (queryError) {
            throw queryError;
          }

          if (!active) {
            return;
          }

          const next = data || [];

          // ne remplace la liste que si elle a changé (évite de
          // relancer le défilement automatique toutes les 4 s)
          setMessages((previous) =>
            previous.length === next.length &&
            previous.every(
              (message, index) =>
                message.id === next[index].id &&
                message.reaction === next[index].reaction
            )
              ? previous
              : next
          );

          // ouverture de l'écran = messages reçus vus
          if (
            !silent ||
            next.some(
              (message) =>
                message.recipient_user_id === currentUserId &&
                !message.read_at
            )
          ) {
            markMessagesSeen(supabase);
          }
        } catch (err) {
          console.error(
            "MESSAGES LOAD ERROR:",
            err
          );

          // une actualisation en arrière-plan ratée reste silencieuse
          if (active && !silent) {
            /* message humain : l'erreur technique reste en console */
            setError(
              "Impossible de charger les messages. Vérifie ta connexion puis réessaie."
            );
          }
        } finally {
          if (active) {
            setLoading(false);
          }
        }
      };

    loadMessages();

    /* messages en direct : actualisation toutes les 4 s tant que
       l'écran est ouvert et visible, et au retour dans l'app */
    const timer =
      window.setInterval(() => {
        if (document.visibilityState === "visible") {
          loadMessages({ silent: true });
        }
      }, 4000);

    const onVisible = () => {
      if (document.visibilityState === "visible") {
        loadMessages({ silent: true });
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
    currentUserId,
    coupleId,
  ]);

  /* =========================================================
     AUTO SCROLL
     ========================================================= */

  useEffect(() => {
    const thread =
      threadRef.current;

    if (!thread) {
      return;
    }

    const frame =
      window.requestAnimationFrame(
        () => {
          thread.scrollTop =
            thread.scrollHeight;
        }
      );

    return () => {
      window.cancelAnimationFrame(
        frame
      );
    };
  }, [messages.length]);

  /* =========================================================
     SEND MESSAGE
     ========================================================= */

  const sendMessage =
    async () => {
      const trimmed =
        draft.trim();

      if (
        !trimmed ||
        sending
      ) {
        return;
      }

      if (
        !currentUserId ||
        !coupleId
      ) {
        setError(
          "Ton compte partenaire n’est pas disponible."
        );

        return;
      }

      try {
        setSending(true);
        setError("");

        const {
          data,
          error: functionError,
        } = await supabase
          .functions
          .invoke(
            "send-message",
            {
              body: {
                body: trimmed,
              },
            }
          );

        if (functionError) {
          throw functionError;
        }

        if (
          !data?.success ||
          !data?.message
        ) {
          throw new Error(
            data?.error ||
              "Impossible d’envoyer le message."
          );
        }

        setMessages(
          (current) => {
            const alreadyExists =
              current.some(
                (message) =>
                  message.id ===
                  data.message.id
              );

            if (alreadyExists) {
              return current;
            }

            return [
              ...current,
              data.message,
            ];
          }
        );

        setDraft("");
      } catch (err) {
        console.error(
          "MESSAGE SEND ERROR:",
          err
        );

        setError(
          "Le message n’est pas parti. Réessaie dans un instant."
        );
      } finally {
        setSending(false);
      }
    };

  /* =========================================================
     RENDER
     ========================================================= */

  return (
    <main className="messages-page">
      <header className="messages-topbar">
        <button
          type="button"
          className="messages-back"
          onClick={onBack}
          aria-label="Retour"
        >
          <BackIcon />
        </button>

        <div className="messages-heading">
          <span className="messages-logo">
            PROTOCOL
          </span>

          <span className="messages-subtitle">
            Avec {partnerName}
          </span>
        </div>
      </header>

      <section className="messages-content">
        <div className="messages-intro">
          <p className="messages-kicker">
            MESSAGES
          </p>

          <h1>
            Entre nous.
          </h1>

          <p className="messages-intro-text">
            Ce qui se dit ici
            reste ici.
          </p>
        </div>

        {loading && (
          <p className="messages-status">
            Chargement…
          </p>
        )}

        {error && (
          <p className="messages-error">
            {error}
          </p>
        )}

        {!loading &&
          !error &&
          messages.length === 0 && (
            <div className="messages-empty">
              <span className="messages-empty-mark">
                <span className="protocol-diamond" aria-hidden="true" />
              </span>

              <strong>
                Rien ici pour
                l’instant.
              </strong>

              <p>
                Le premier mot
                donne souvent
                le ton.
              </p>
            </div>
          )}

        {!loading &&
          messages.length > 0 && (
            <div className="messages-thread-shell">
              <div
                ref={threadRef}
                className="messages-thread"
              >
                {messages.map(
                  (message) => {
                    const isMine =
                      message.sender_user_id ===
                      currentUserId;

                    return (
                      <div
                        key={message.id}
                        className={
                          isMine
                            ? "message-row is-mine"
                            : "message-row is-theirs"
                        }
                      >
                        <article
                          className={
                            isMine
                              ? "message-bubble is-mine"
                              : "message-bubble is-theirs"
                          }
                        >
                          <p className="message-body">
                            {message.body}
                          </p>

                          <div className="message-meta">
                            <span>
                              {formatRelativeTime(
                                message.created_at,
                                { style: "clock" }
                              )}
                            </span>
                          </div>
                        </article>
                      </div>
                    );
                  }
                )}

              </div>
            </div>
          )}

        <div className="messages-composer-wrap">
          <div className="messages-composer">
            <textarea
              value={draft}
              onChange={(
                event
              ) =>
                setDraft(
                  event.target.value
                )
              }
              onKeyDown={(
                event
              ) => {
                if (
                  event.key ===
                    "Enter" &&
                  !event.shiftKey
                ) {
                  event.preventDefault();
                  sendMessage();
                }
              }}
              placeholder="Écris-lui…"
              rows={1}
              maxLength={1200}
            />

            <button
              type="button"
              className="messages-send"
              onClick={
                sendMessage
              }
              disabled={
                sending ||
                !draft.trim() ||
                !currentUserId ||
                !coupleId
              }
              aria-label="Envoyer"
            >
              {sending
                ? "…"
                : "↑"}
            </button>
          </div>
        </div>
      </section>
    </main>
  );
}