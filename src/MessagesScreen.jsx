import {
  useEffect,
  useState,
} from "react";

import "./messages.css";

// PROTOCOL private messaging


function formatMessageTime(
  value
) {
  if (!value) {
    return "";
  }

  try {
    return new Intl.DateTimeFormat(
      "fr-BE",
      {
        day:
          "2-digit",

        month:
          "2-digit",

        hour:
          "2-digit",

        minute:
          "2-digit",
      }
    ).format(
      new Date(value)
    );
  } catch {
    return "";
  }
}


export default function MessagesScreen({
  supabase,
  profile,
  couple,
  onBack,
}) {

  const [
    messages,
    setMessages,
  ] =
    useState([]);

  const [
    loading,
    setLoading,
  ] =
    useState(true);

  const [
    error,
    setError,
  ] =
    useState("");

  const [
    draft,
    setDraft,
  ] =
    useState("");

  const [
    sending,
    setSending,
  ] =
    useState(false);


  const currentUserId =
    profile?.user_id ||
    null;


  const coupleId =
    couple?.id ||
    couple?.couple_id ||
    null;


  /* =========================================================
     LOAD MESSAGES
     ========================================================= */

  useEffect(() => {

    let active =
      true;


    const loadMessages =
      async () => {

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

          setLoading(
            true
          );

          setError(
            ""
          );


          const {
            data,
            error:
              queryError,
          } =
            await supabase
              .from(
                "protocol_messages"
              )
              .select(
                `
                  id,
                  sender,
                  recipient,
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
                  ascending:
                    true,
                }
              );


          if (
            queryError
          ) {
            throw queryError;
          }


          if (
            !active
          ) {
            return;
          }


          setMessages(
            data || []
          );

        } catch (
          err
        ) {

          console.error(
            "MESSAGES LOAD ERROR:",
            err
          );


          if (
            active
          ) {
            setError(
              err?.message ||
                "Impossible de charger les messages."
            );
          }

        } finally {

          if (
            active
          ) {
            setLoading(
              false
            );
          }

        }

      };


    loadMessages();


    return () => {
      active =
        false;
    };

  }, [
    supabase,
    currentUserId,
    coupleId,
  ]);


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

        setSending(
          true
        );

        setError(
          ""
        );


        const {
          data,
          error:
            functionError,
        } =
          await supabase
            .functions
            .invoke(
              "send-message",
              {
                body: {
                  body:
                    trimmed,
                },
              }
            );


        if (
          functionError
        ) {
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
          (
            current
          ) => {

            const alreadyExists =
              current.some(
                (message) =>
                  message.id ===
                  data.message.id
              );


            if (
              alreadyExists
            ) {
              return current;
            }


            return [
              ...current,
              data.message,
            ];

          }
        );


        setDraft(
          ""
        );

      } catch (
        err
      ) {

        console.error(
          "MESSAGE SEND ERROR:",
          err
        );


        setError(
          err?.message ||
            "Impossible d’envoyer le message."
        );

      } finally {

        setSending(
          false
        );

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

          onClick={
            onBack
          }

          aria-label="Retour"
        >
          ←
        </button>


        <div className="messages-heading">

          <span className="messages-logo">
            PROTOCOL
          </span>

          <span className="messages-subtitle">
            Entre nous
          </span>

        </div>

      </header>


      <section className="messages-content">

        <div className="messages-intro">

          <p className="messages-kicker">
            PRIVÉ
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
          messages.length ===
            0 && (

          <div className="messages-empty">

            <p>
              Rien ici pour
              l’instant.
            </p>

          </div>
        )}


        {!loading &&
          messages.length >
            0 && (

          <div className="messages-thread">

            {messages.map(
              (
                message
              ) => {

                const isMine =
                  message
                    .sender_user_id ===
                  currentUserId;


                return (
                  <article
                    key={
                      message.id
                    }

                    className={
                      isMine
                        ? "message-bubble is-mine"
                        : "message-bubble is-theirs"
                    }
                  >

                    <p className="message-body">
                      {
                        message.body
                      }
                    </p>


                    <div className="message-meta">

                      <span>
                        {
                          formatMessageTime(
                            message.created_at
                          )
                        }
                      </span>

                    </div>

                  </article>
                );

              }
            )}

          </div>
        )}


        <div className="messages-composer">

          <textarea
            value={
              draft
            }

            onChange={(
              event
            ) =>
              setDraft(
                event.target.value
              )
            }

            placeholder="Écris-lui…"

            rows={
              1
            }

            maxLength={
              1200
            }
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
            {
              sending
                ? "…"
                : "↑"
            }
          </button>

        </div>

      </section>

    </main>
  );
}