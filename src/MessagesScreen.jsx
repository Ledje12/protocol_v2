import {
  useEffect,
  useRef,
  useState,
} from "react";
import { createPortal } from "react-dom";

import { formatRelativeTime } from "./formatTime.js";
import { markMessagesSeen } from "./unread.js";
import { BackIcon } from "./ScreenHeader.jsx";
import {
  AlbumGrid,
  AlbumKeySheet,
  PhotoThumb,
  PhotoViewer,
} from "./PhotoAlbum.jsx";
import { getSavedAlbumKey, uploadPhoto } from "./photoAlbum.js";
import { PhotoDayBanner } from "./PhotoDay.jsx";
import { ScheduleSheet, ScheduledList, useScheduledMessages } from "./ScheduledMessages.jsx";
import CameraIcon from "./CameraIcon.jsx";

// PROTOCOL private messaging

const MESSAGE_COLUMNS =
  "id, sender_user_id, recipient_user_id, couple_id, body, reply_to_id, reaction, created_at, read_at";

// réactions possibles, en appui long sur un message reçu
const REACTIONS = ["❤️", "🔥", "👍🏼"];

const PHOTO_COLUMNS =
  "photo_id, photo:protocol_photos (id, couple_id, created_at, mime, width, height)";

// du plus complet au plus simple : si une migration n'est pas
// encore appliquée, on retombe sur les colonnes qui existent
const SELECTS = [
  `${MESSAGE_COLUMNS}, sender_reaction, ${PHOTO_COLUMNS}`,
  `${MESSAGE_COLUMNS}, ${PHOTO_COLUMNS}`,
  MESSAGE_COLUMNS,
];
let selectLevel = 0;


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

  // saisie en cours (sur téléphone : clavier ouvert)
  const [
    typing,
    setTyping,
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

  /* Album chiffré : clé gardée sur ce téléphone, onglet, envoi */
  const [tab, setTab] = useState("chat");
  const [albumKey, setAlbumKey] = useState(null);
  const [keySheet, setKeySheet] = useState(false);
  const [viewer, setViewer] = useState(null);
  const [uploading, setUploading] = useState(false);
  const [albumVersion, setAlbumVersion] = useState(0);
  const fileInputRef = useRef(null);

  /* Appui long : réagir ou répondre. Glisser vers la droite : répondre. */
  const [picker, setPicker] = useState(null);
  const [replyTo, setReplyTo] = useState(null);
  const draftRef = useRef(null);
  const pressRef = useRef({ timer: null, x: 0, y: 0, done: false, swipe: 0, bubble: null });

  const SWIPE_REPLY = 56;

  const startReply = (message) => {
    setPicker(null);
    setReplyTo(message);
    draftRef.current?.focus();
  };

  const cancelPress = () => {
    window.clearTimeout(pressRef.current.timer);
    pressRef.current.timer = null;
  };

  // fin du geste : la bulle revient en place ; assez glissée = répondre
  const endPress = (message) => {
    cancelPress();
    const { bubble, swipe } = pressRef.current;

    if (bubble && swipe) {
      bubble.style.transition = "transform 180ms ease";
      bubble.style.transform = "";
      pressRef.current.swipe = 0;

      if (swipe >= SWIPE_REPLY) {
        pressRef.current.done = true; // pas d'ouverture de photo en plus
        startReply(message);
      }
    }
  };

  const pressHandlers = (message) => ({
    onPointerDown: (event) => {
      cancelPress();
      const bubble = event.currentTarget;
      bubble.style.transition = "";
      pressRef.current = {
        x: event.clientX,
        y: event.clientY,
        done: false,
        swipe: 0,
        bubble,
        timer: window.setTimeout(() => {
          pressRef.current.done = true;
          navigator.vibrate?.(10);
          setPicker({ id: message.id, rect: bubble.getBoundingClientRect() });
        }, 450),
      };
    },
    onPointerMove: (event) => {
      const press = pressRef.current;
      if (!press.bubble) {
        return;
      }

      const dx = event.clientX - press.x;
      const dy = event.clientY - press.y;

      // le doigt glisse : c'est un défilement ou un glissé, pas un appui
      if (Math.abs(dx) > 10 || Math.abs(dy) > 10) {
        cancelPress();
      }

      // glissé vers la droite, plutôt horizontal : la bulle suit
      if (dx > 10 && Math.abs(dy) < 30 && !press.done) {
        const swipe = Math.min(dx - 10, 80);
        if (press.swipe < SWIPE_REPLY && swipe >= SWIPE_REPLY) {
          navigator.vibrate?.(8);
        }
        press.swipe = swipe;
        press.bubble.style.transform = `translateX(${swipe}px)`;
      }
    },
    onPointerUp: () => endPress(message),
    onPointerCancel: () => endPress(message),
    // un doigt reste attaché à la bulle même si la page bouge
    // (clavier qui se ferme) ; seule la souris « sort » de la bulle
    onPointerLeave: (event) => {
      if (event.pointerType === "mouse") {
        endPress(message);
      }
    },
    // le menu du téléphone (copier, enregistrer l'image…) ne s'ouvre pas
    onContextMenu: (event) => event.preventDefault(),
    // l'appui long n'ouvre pas la photo en plus
    onClickCapture: (event) => {
      if (pressRef.current.done) {
        event.preventDefault();
        event.stopPropagation();
        pressRef.current.done = false;
      }
    },
  });

  // la réaction de chacun a sa colonne
  const myReactionField = (message) =>
    message.sender_user_id === currentUserId ? "sender_reaction" : "reaction";

  const react = async (message, reaction) => {
    const field = myReactionField(message);
    const next = message[field] === reaction ? null : reaction;
    const setReaction = (value) =>
      setMessages((current) =>
        current.map((item) =>
          item.id === message.id ? { ...item, [field]: value } : item
        )
      );

    setPicker(null);
    setReaction(next);

    const { error: rpcError } = await supabase.rpc(
      "set_protocol_message_reaction",
      { p_message_id: message.id, p_reaction: next }
    );

    if (rpcError) {
      console.error("MESSAGE REACTION ERROR:", rpcError);
      setReaction(message[field]);
      setError("La réaction n’est pas passée. Réessaie dans un instant.");
    }
  };

  useEffect(() => {
    let active = true;

    getSavedAlbumKey(coupleId).then((key) => {
      if (active && key) {
        setAlbumKey(key);
      }
    });

    return () => {
      active = false;
    };
  }, [coupleId]);

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

      // la zone visible change (clavier) : on garde le dernier
      // message en vue
      const thread =
        threadRef.current;

      if (thread) {
        thread.scrollTop =
          thread.scrollHeight;
      }
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

          const query = (columns) =>
            supabase
              .from("protocol_messages")
              .select(columns)
              .eq("couple_id", coupleId)
              .order("created_at", { ascending: true });

          let {
            data,
            error: queryError,
          } = await query(SELECTS[selectLevel]);

          while (queryError && selectLevel < SELECTS.length - 1) {
            selectLevel += 1;
            ({ data, error: queryError } = await query(SELECTS[selectLevel]));
          }

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
                message.reaction === next[index].reaction &&
                message.sender_reaction === next[index].sender_reaction &&
                message.read_at === next[index].read_at &&
                message.photo_id === next[index].photo_id
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
  }, [messages.length, typing]);

  /* =========================================================
     SEND MESSAGE
     ========================================================= */

  /* Messages programmés (les miens, en attente) */
  const [scheduled, reloadScheduled] = useScheduledMessages(supabase);
  const [scheduleSheet, setScheduleSheet] = useState(null);

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
                reply_to_id: replyTo?.id || null,
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
        setReplyTo(null);
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
     SEND PHOTO (chiffrée sur le téléphone, puis message)
     ========================================================= */

  const pickPhoto = () => {
    if (!albumKey) {
      setKeySheet(true);
      return;
    }

    fileInputRef.current?.click();
  };

  // envoie un message (texte et/ou photo) ; l'erreur remonte
  const postMessage =
    async (payload, photo = null) => {
      const {
        data,
        error: functionError,
      } = await supabase
        .functions
        .invoke(
          "send-message",
          { body: payload }
        );

      if (functionError || !data?.success || !data?.message) {
        throw functionError || new Error(data?.error || "send-message");
      }

      setMessages((current) =>
        current.some((message) => message.id === data.message.id)
          ? current
          : [...current, photo ? { ...data.message, photo } : data.message]
      );

      return data.message;
    };

  const postPhoto =
    async (file, caption = "", replyToId = null) => {
      const photo =
        await uploadPhoto(
          supabase,
          albumKey,
          file
        );

      setAlbumVersion((version) => version + 1);
      await postMessage({ photo_id: photo.id, body: caption, reply_to_id: replyToId }, photo);
      return photo;
    };

  const sendPhoto =
    async (file) => {
      if (!file || !albumKey || uploading) {
        return;
      }

      try {
        setUploading(true);
        setError("");
        await postPhoto(file, "", replyTo?.id || null);
        setReplyTo(null);
      } catch (err) {
        console.error(
          "PHOTO SEND ERROR:",
          err
        );

        setError(
          /album full/i.test(err?.message || "")
            ? "L’album est plein : supprime quelques photos pour en envoyer d’autres."
            : "La photo n’est pas partie. Réessaie dans un instant."
        );
      } finally {
        setUploading(false);
      }
    };

  // « Vu » / « Envoyé » sous mon dernier message
  const lastMineId = [...messages]
    .reverse()
    .find((message) => message.sender_user_id === currentUserId)?.id;

  /* =========================================================
     RENDER
     ========================================================= */

  return (
    <main
      className={
        typing
          ? "messages-page is-typing"
          : "messages-page"
      }
    >
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

        <div
          className="settings-segmented messages-tabs"
          role="tablist"
          aria-label="Messages ou album"
        >
          {[
            ["chat", "Conversation"],
            ["album", "Album"],
          ].map(([value, label]) => (
            <button
              key={value}
              type="button"
              role="tab"
              aria-selected={tab === value}
              className={tab === value ? "is-active" : undefined}
              onClick={() => setTab(value)}
            >
              {label}
            </button>
          ))}
        </div>

        {tab === "chat" && (
          <PhotoDayBanner
            supabase={supabase}
            partnerName={partnerName}
            albumKey={albumKey}
            onNeedAlbumKey={() => setKeySheet(true)}
            sendText={(body) => postMessage({ body })}
            sendPhoto={postPhoto}
          />
        )}

        {tab === "album" && (
          <AlbumGrid
            supabase={supabase}
            albumKey={albumKey}
            refreshKey={albumVersion}
            onOpen={setViewer}
            onLocked={() => setKeySheet(true)}
          />
        )}

        {tab === "chat" && loading && (
          <p className="messages-status">
            Chargement…
          </p>
        )}

        {error && (
          <p className="messages-error">
            {error}
          </p>
        )}

        {tab === "chat" &&
          !loading &&
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

        {tab === "chat" &&
          !loading &&
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

                    const reactions = [
                      message.reaction,
                      message.sender_reaction,
                    ].filter(Boolean);

                    return (
                      <div
                        key={message.id}
                        data-message-id={message.id}
                        className={[
                          "message-row",
                          isMine ? "is-mine" : "is-theirs",
                          reactions.length > 0 && "has-reaction",
                        ]
                          .filter(Boolean)
                          .join(" ")}
                      >
                        <article
                          className={[
                            "message-bubble",
                            isMine ? "is-mine" : "is-theirs",
                            picker?.id === message.id && "is-pressed",
                          ]
                            .filter(Boolean)
                            .join(" ")}
                          {...pressHandlers(message)}
                        >
                          {message.reply_to_id && (
                            <ReplyQuote
                              original={messages.find((item) => item.id === message.reply_to_id)}
                              currentUserId={currentUserId}
                              partnerName={partnerName}
                            />
                          )}

                          {message.photo && (
                            <PhotoThumb
                              supabase={supabase}
                              albumKey={albumKey}
                              photo={message.photo}
                              onOpen={setViewer}
                              onLocked={() => setKeySheet(true)}
                              className="message-photo"
                            />
                          )}

                          {!message.photo && !message.body && (
                            <p className="message-body message-photo-gone">
                              Photo supprimée
                            </p>
                          )}

                          {message.body && (
                            <p className="message-body">
                              {message.body}
                            </p>
                          )}

                          <div className="message-meta">
                            <span>
                              {formatRelativeTime(
                                message.created_at,
                                { style: "clock" }
                              )}
                            </span>

                            {message.id === lastMineId && (
                              <span className={message.read_at ? "message-seen is-seen" : "message-seen"}>
                                {message.read_at ? "Vu" : "Envoyé"}
                              </span>
                            )}
                          </div>

                          {reactions.length > 0 && (
                            <span
                              className="message-reaction"
                              aria-label={`Réactions : ${reactions.join(" ")}`}
                            >
                              {reactions.join("")}
                            </span>
                          )}
                        </article>
                      </div>
                    );
                  }
                )}

              </div>
            </div>
          )}

        {tab === "chat" && (
        <div className="messages-composer-wrap">
          {scheduled?.length > 0 && (
            <button
              type="button"
              className="messages-scheduled-bar"
              onMouseDown={(event) => event.preventDefault()}
              onClick={() => setScheduleSheet("list")}
            >
              <ClockIcon size={16} />
              <span>
                {scheduled.length === 1
                  ? "1 message programmé"
                  : `${scheduled.length} messages programmés`}
              </span>
              <span aria-hidden="true">→</span>
            </button>
          )}

          {replyTo && (
            <div className="messages-reply-bar">
              <div className="messages-reply-bar-text">
                <span>
                  Réponse à {replyTo.sender_user_id === currentUserId ? "toi" : partnerName}
                </span>
                <p>{snippet(replyTo)}</p>
              </div>
              <button
                type="button"
                onMouseDown={(event) => event.preventDefault()}
                onClick={() => setReplyTo(null)}
                aria-label="Annuler la réponse"
              >
                ×
              </button>
            </div>
          )}
          <div className="messages-composer">
            <button
              type="button"
              className="messages-photo"
              onMouseDown={(event) => event.preventDefault()}
              // texte en cours : programmer l'envoi ; sinon : photo
              onClick={
                draft.trim() && scheduled !== null
                  ? () => setScheduleSheet("new")
                  : pickPhoto
              }
              disabled={uploading || !currentUserId || !coupleId}
              aria-label={
                draft.trim() && scheduled !== null
                  ? "Programmer l’envoi"
                  : "Envoyer une photo chiffrée"
              }
            >
              {uploading ? "…" : draft.trim() && scheduled !== null ? <ClockIcon /> : <CameraIcon />}
            </button>

            <input
              ref={fileInputRef}
              type="file"
              accept="image/*"
              hidden
              onChange={(event) => {
                const [file] = event.target.files || [];
                event.target.value = "";
                sendPhoto(file);
              }}
            />

            <textarea
              ref={draftRef}
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
              onFocus={() =>
                setTyping(true)
              }
              onBlur={() =>
                setTyping(false)
              }
              placeholder="Écris-lui…"
              rows={1}
              maxLength={1200}
            />

            <button
              type="button"
              className="messages-send"
              // le bouton ne prend pas le focus : le clavier reste
              // ouvert après l'envoi
              onMouseDown={(
                event
              ) =>
                event.preventDefault()
              }
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
        )}
      </section>

      {picker && (
        <ReactionPicker
          rect={picker.rect}
          current={(() => {
            const message = messages.find((item) => item.id === picker.id);
            return message?.[myReactionField(message)];
          })()}
          onReply={() => {
            const message = messages.find((item) => item.id === picker.id);
            if (message) {
              startReply(message);
            }
          }}
          onPick={(reaction) => {
            const message = messages.find((item) => item.id === picker.id);
            if (message) {
              react(message, reaction);
            }
          }}
          onClose={() => setPicker(null)}
        />
      )}

      {scheduleSheet === "new" && (
        <ScheduleSheet
          supabase={supabase}
          body={draft.trim()}
          partnerName={partnerName}
          onScheduled={() => {
            setDraft("");
            setReplyTo(null);
            setScheduleSheet(null);
            reloadScheduled();
          }}
          onClose={() => setScheduleSheet(null)}
        />
      )}

      {scheduleSheet === "list" && (
        <ScheduledList
          supabase={supabase}
          items={scheduled || []}
          onChanged={reloadScheduled}
          onClose={() => setScheduleSheet(null)}
        />
      )}

      {keySheet && (
        <AlbumKeySheet
          supabase={supabase}
          coupleId={coupleId}
          partnerName={partnerName}
          onUnlocked={(key) => {
            setAlbumKey(key);
            setKeySheet(false);
          }}
          onClose={() => setKeySheet(false)}
        />
      )}

      {viewer && albumKey && (
        <PhotoViewer
          supabase={supabase}
          albumKey={albumKey}
          photo={viewer}
          onClose={() => setViewer(null)}
          onDeleted={(photo) => {
            setMessages((current) =>
              current.map((message) =>
                message.photo_id === photo.id
                  ? { ...message, photo_id: null, photo: null }
                  : message
              )
            );
            setAlbumVersion((version) => version + 1);
          }}
        />
      )}
    </main>
  );
}

/* Les trois réactions, au-dessus du message (en dessous s'il est
   tout en haut de l'écran) ; toucher ailleurs referme. */
function ReactionPicker({ rect, current, onPick, onReply, onClose }) {
  const above = rect.top > 90;
  const style = {
    top: above ? rect.top - 58 : rect.bottom + 10,
    left: Math.max(12, Math.min(rect.left, window.innerWidth - 12 - 226)),
  };

  return createPortal(
    <div className="reaction-backdrop" onPointerDown={onClose}>
      <div
        className="reaction-picker"
        style={style}
        role="menu"
        aria-label="Réagir au message"
        onPointerDown={(event) => event.stopPropagation()}
      >
        {REACTIONS.map((reaction) => (
          <button
            key={reaction}
            type="button"
            role="menuitemradio"
            aria-checked={current === reaction}
            className={current === reaction ? "is-active" : undefined}
            onClick={() => onPick(reaction)}
          >
            {reaction}
          </button>
        ))}

        <button
          type="button"
          role="menuitem"
          className="reaction-picker-reply"
          onClick={onReply}
          aria-label="Répondre"
        >
          ↩
        </button>
      </div>
    </div>,
    document.body
  );
}

// aperçu d'un message (citation, barre de réponse)
function snippet(message) {
  if (!message) {
    return "Message supprimé";
  }

  if (message.body) {
    return message.body.length > 90 ? `${message.body.slice(0, 90)}…` : message.body;
  }

  return message.photo_id ? "📷 Photo" : "Photo supprimée";
}

/* Le message auquel on répond, en tête de la bulle ; le toucher
   ramène au message d'origine. */
function ReplyQuote({ original, currentUserId, partnerName }) {
  const goTo = (event) => {
    event.stopPropagation();
    const row = original && document.querySelector(`[data-message-id="${original.id}"]`);

    if (row) {
      row.scrollIntoView({ behavior: "smooth", block: "center" });
      row.classList.remove("is-flash");
      void row.offsetWidth;
      row.classList.add("is-flash");
    }
  };

  return (
    <button type="button" className="message-quote" onClick={goTo}>
      <span>
        {!original
          ? "Réponse"
          : original.sender_user_id === currentUserId
            ? "Toi"
            : partnerName}
      </span>
      <p>{snippet(original)}</p>
    </button>
  );
}

function ClockIcon({ size = 22 }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.6"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <circle cx="12" cy="13" r="8" />
      <path d="M12 9v4l2.5 2" />
      <path d="M9.5 2.5h5" />
    </svg>
  );
}
