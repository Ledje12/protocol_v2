import {
  useEffect,
  useRef,
  useState,
} from "react";

import "./messages.css";
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
import CameraIcon from "./CameraIcon.jsx";

// PROTOCOL private messaging

const MESSAGE_COLUMNS =
  "id, sender_user_id, recipient_user_id, couple_id, body, reply_to_id, reaction, created_at, read_at";

// passe à false si la migration de l'album n'est pas appliquée
let photoColumnsAvailable = true;


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
          } = await query(
            photoColumnsAvailable
              ? `${MESSAGE_COLUMNS}, photo_id, photo:protocol_photos (id, couple_id, created_at, mime, width, height)`
              : MESSAGE_COLUMNS
          );

          // album pas encore installé dans la base : messages seuls
          if (queryError && photoColumnsAvailable) {
            photoColumnsAvailable = false;
            ({ data, error: queryError } = await query(MESSAGE_COLUMNS));
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
    async (file, caption = "") => {
      const photo =
        await uploadPhoto(
          supabase,
          albumKey,
          file
        );

      setAlbumVersion((version) => version + 1);
      await postMessage({ photo_id: photo.id, body: caption }, photo);
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
        await postPhoto(file);
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
                          </div>
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
          <div className="messages-composer">
            <button
              type="button"
              className="messages-photo"
              onMouseDown={(event) => event.preventDefault()}
              onClick={pickPhoto}
              disabled={uploading || !currentUserId || !coupleId}
              aria-label="Envoyer une photo chiffrée"
            >
              {uploading ? "…" : <CameraIcon />}
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