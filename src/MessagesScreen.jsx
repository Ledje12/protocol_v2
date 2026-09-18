import {
  useEffect,
  useState,
} from "react";

import "./messages.css";


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
  ownerKey,
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


  useEffect(() => {

    let active =
      true;


    const loadMessages =
      async () => {

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
                  body,
                  reply_to_id,
                  reaction,
                  created_at,
                  read_at
                `
              )
              .or(
                `sender.eq.${ownerKey},recipient.eq.${ownerKey}`
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
    ownerKey,
  ]);


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


      const recipient =
        ownerKey === "jerome"
          ? "audrey"
          : "jerome";


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
            insertError,
        } =
          await supabase
            .from(
              "protocol_messages"
            )
            .insert({
              sender:
                ownerKey,

              recipient,

              body:
                trimmed,
            })
            .select(
              `
                id,
                sender,
                recipient,
                body,
                reply_to_id,
                reaction,
                created_at,
                read_at
              `
            )
            .single();


        if (
          insertError
        ) {
          throw insertError;
        }


        setMessages(
          (
            current
          ) => [
            ...current,
            data,
          ]
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
          !error &&
          messages.length >
            0 && (

          <div className="messages-thread">

            {messages.map(
              (
                message
              ) => {

                const isMine =
                  message.sender ===
                  ownerKey;


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
                          isMine
                            ? "Moi"
                            : message.sender ===
                              "jerome"
                              ? "Jérôme"
                              : "Audrey"
                        }
                      </span>

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
              !draft.trim()
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