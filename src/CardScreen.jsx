import {
  useEffect,
  useRef,
  useState,
} from "react";

import {
  getPerson,
  getPartner,
  personalizeCardPrompt,
} from "./cardPersonalization.js";

import "./card.css";


function getTypeLabel(
  type
) {
  switch (type) {
    case "action":
      return "ACTION";

    case "truth":
      return "VÉRITÉ";

    case "duel":
      return "DUEL";

    case "scene":
      return "SCÈNE";

    default:
      return String(
        type || "CARTE"
      ).toUpperCase();
  }
}


function formatOpenedTime(
  value
) {
  if (!value) {
    return "";
  }

  try {
    return new Intl.DateTimeFormat(
      "fr-BE",
      {
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

function formatLovenseTime(
  seconds
) {
  const safeSeconds =
    Math.max(
      0,
      Number(seconds) || 0
    );

  const minutes =
    Math.floor(
      safeSeconds / 60
    );

  const remainingSeconds =
    safeSeconds % 60;

  return `${String(minutes).padStart(
    2,
    "0"
  )}:${String(
    remainingSeconds
  ).padStart(2, "0")}`;
}

function getInvitationStorageKey(
  cardId,
  activeKey
) {
  if (
    !cardId ||
    !activeKey
  ) {
    return null;
  }

  return `protocol-card-invite-${cardId}-${activeKey}`;
}

export default function CardScreen({
  supabase,
  cardId,
  ownerKey,
  activeKey,
  profile,
  couple,
  invitationId,
  challengeId,
  onBack,
}) {

  const [card, setCard] =
    useState(null);

  const [loading, setLoading] =
    useState(true);

  const [error, setError] =
    useState("");

  const [
    sending,
    setSending,
  ] = useState(false);

  const [
    sendMessage,
    setSendMessage,
  ] = useState("");

  const [
    trackedInvitationId,
    setTrackedInvitationId,
  ] = useState(() => {

    if (invitationId) {
      return invitationId;
    }

    const storageKey =
      getInvitationStorageKey(
        cardId,
        activeKey
      );

    if (!storageKey) {
      return null;
    }

    return localStorage.getItem(
      storageKey
    );
  });

  const [
    openedAt,
    setOpenedAt,
  ] = useState(null);


  const [
    lovenseConnected,
    setLovenseConnected,
  ] = useState(false);

  const [
    lovenseStatusLoading,
    setLovenseStatusLoading,
  ] = useState(true);

  const [
    lovenseRunning,
    setLovenseRunning,
  ] = useState(false);

  const [
    lovenseRemaining,
    setLovenseRemaining,
  ] = useState(0);

  const [
    lovenseBusy,
    setLovenseBusy,
  ] = useState(false);

  const [
    lovenseMessage,
    setLovenseMessage,
  ] = useState("");


  const lovenseStartedRef =
    useRef(false);

  const lovenseAutoTriggerRef =
    useRef(null);

  const lovenseEndsAtRef =
    useRef(0);


  const activePerson =
    getPerson(
      activeKey
    );

  const senderPerson =
    getPartner(
      activeKey
    );


  const canPropose =
    ownerKey !== activeKey;

  const isRecipient =
    ownerKey === activeKey;

  /* =========================================================
   SYNC INVITATION FROM URL / LOCAL STORAGE
   ========================================================= */

  useEffect(() => {

    const storageKey =
      getInvitationStorageKey(
        cardId,
        activeKey
      );

    if (!storageKey) {
      return;
    }


    if (invitationId) {

      localStorage.setItem(
        storageKey,
        invitationId
      );

      setTrackedInvitationId(
        invitationId
      );

      return;
    }


    const storedInvitationId =
      localStorage.getItem(
        storageKey
      );


    if (storedInvitationId) {
      setTrackedInvitationId(
        storedInvitationId
      );
    }

  }, [
    invitationId,
    cardId,
    activeKey,
  ]);


  /* =========================================================
     LOAD CARD
     ========================================================= */

  useEffect(() => {

    let mounted =
      true;


    const loadCard =
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
                "protocol_cards"
              )
              .select("*")
              .eq(
                "id",
                cardId
              )
              .eq(
                "library_version",
                "v1"
              )
              .eq(
                "active",
                true
              )
              .single();


          if (
            queryError
          ) {
            throw queryError;
          }


          if (
            !mounted
          ) {
            return;
          }


          if (
            data.target_sex &&
            activePerson &&
            data.target_sex !==
              activePerson.sex
          ) {
            throw new Error(
              "Cette carte n'est pas compatible avec ce destinataire."
            );
          }


          const displayPrompt =
            activeKey
              ? personalizeCardPrompt(
                  data.prompt,
                  activeKey
                )
              : data.prompt;


          setCard({
            ...data,

            displayPrompt,
          });


        } catch (err) {

          console.error(
            "CARD LOAD ERROR:",
            err
          );


          if (
            mounted
          ) {
            setError(
              err?.message ||
              "Impossible de charger cette carte."
            );
          }


        } finally {

          if (
            mounted
          ) {
            setLoading(
              false
            );
          }

        }

      };


    loadCard();


    return () => {
      mounted =
        false;
    };

  }, [
    supabase,
    cardId,
    activeKey,
    activePerson?.sex,
  ]);

    /* =========================================================
     LOVENSE STATUS
     ========================================================= */

  useEffect(() => {

    if (
      !card?.lovense_mode
    ) {
      setLovenseConnected(false);
      setLovenseStatusLoading(false);
      return;
    }


    let active =
      true;


    const checkLovenseStatus =
      async () => {

        try {

          setLovenseStatusLoading(
            true
          );


          const {
            data,
            error:
              functionError,
          } =
            await supabase
              .functions
              .invoke(
                "lovense-status",
                {
                  body: {
                    host:
                      "jerome",
                  },
                }
              );


          if (
            functionError
          ) {
            throw functionError;
          }


          if (
            !data?.success
          ) {
            throw new Error(
              data?.error ||
              "Impossible de vérifier Lovense."
            );
          }


          if (
            active
          ) {
            setLovenseConnected(
              Boolean(
                data.connected
              )
            );
          }


        } catch (err) {

          console.error(
            "CARD LOVENSE STATUS ERROR:",
            err
          );


          if (
            active
          ) {
            setLovenseConnected(
              false
            );
          }


        } finally {

          if (
            active
          ) {
            setLovenseStatusLoading(
              false
            );
          }

        }

      };


    checkLovenseStatus();


    const handleVisibilityChange =
      () => {

        if (
          document.visibilityState ===
          "visible"
        ) {
          checkLovenseStatus();
        }

      };


    document.addEventListener(
      "visibilitychange",
      handleVisibilityChange
    );


    return () => {

      active =
        false;

      document.removeEventListener(
        "visibilitychange",
        handleVisibilityChange
      );

    };

  }, [
    supabase,
    card?.id,
    card?.lovense_mode,
  ]);


  /* =========================================================
     LOVENSE COMMANDS
     ========================================================= */

  const playLovense =
    async () => {

      if (
        !card ||
        !card.lovense_mode ||
        card.lovense_action !==
          "vibrate" ||
        !lovenseConnected ||
        activeKey !== "audrey"
      ) {
        return;
      }


      try {

        setLovenseBusy(
          true
        );

        setLovenseMessage(
          ""
        );


        const duration =
          Math.max(
            2,
            Number(
              card.lovense_duration_sec
            ) || 2
          );


        const intensity =
          Math.max(
            0,
            Math.min(
              20,
              Number(
                card.lovense_intensity
              ) || 5
            )
          );


        const {
          data,
          error:
            functionError,
        } =
          await supabase
            .functions
            .invoke(
              "lovense-command",
              {
                body: {
                  host:
                    "jerome",

                  intensity,

                  duration,

                  pattern:
                    card.lovense_pattern ||
                    null,
                },
              }
            );


        if (
          functionError
        ) {
          throw functionError;
        }


        if (
          !data?.success
        ) {
          throw new Error(
            data?.error ||
            "La vibration n’a pas pu démarrer."
          );
        }


        lovenseStartedRef.current =
          true;

        lovenseEndsAtRef.current =
          Date.now() +
          duration * 1000;


        setLovenseRemaining(
          duration
        );

        setLovenseRunning(
          true
        );


      } catch (err) {

        console.error(
          "CARD LOVENSE PLAY ERROR:",
          err
        );


        setLovenseMessage(
          err?.message ||
          "Impossible de démarrer la vibration."
        );


      } finally {

        setLovenseBusy(
          false
        );

      }

    };


  const stopLovense =
    async (
      silent = false
    ) => {

      try {

        if (!silent) {
          setLovenseBusy(
            true
          );
        }


        await supabase
          .functions
          .invoke(
            "lovense-command",
            {
              body: {
                host:
                  "jerome",

                action:
                  "stop",
              },
            }
          );


        lovenseStartedRef.current =
          false;

        lovenseEndsAtRef.current =
          0;


        setLovenseRunning(
          false
        );

        setLovenseRemaining(
          0
        );


      } catch (err) {

        console.error(
          "CARD LOVENSE STOP ERROR:",
          err
        );


        if (!silent) {
          setLovenseMessage(
            err?.message ||
            "Impossible d’arrêter la vibration."
          );
        }


      } finally {

        if (!silent) {
          setLovenseBusy(
            false
          );
        }

      }

    };


  /* =========================================================
     LOVENSE AUTO START
     ========================================================= */

  useEffect(() => {

    if (
      !card ||
      !trackedInvitationId ||
      !isRecipient ||
      activeKey !== "audrey" ||
      !card.lovense_mode ||
      card.lovense_action !==
        "vibrate" ||
      lovenseStatusLoading ||
      !lovenseConnected
    ) {
      return;
    }


    const triggerKey =
      `${card.id}-${trackedInvitationId}-${activeKey}`;


    if (
      lovenseAutoTriggerRef.current ===
      triggerKey
    ) {
      return;
    }


    lovenseAutoTriggerRef.current =
      triggerKey;


    playLovense();

  }, [
    card?.id,
    card?.lovense_mode,
    card?.lovense_action,
    trackedInvitationId,
    isRecipient,
    activeKey,
    lovenseConnected,
    lovenseStatusLoading,
  ]);


  /* =========================================================
     LOVENSE TIMER
     ========================================================= */

  useEffect(() => {

    if (
      !lovenseRunning
    ) {
      return;
    }


    const interval =
      window.setInterval(
        () => {

          const remaining =
            Math.max(
              0,
              Math.ceil(
                (
                  lovenseEndsAtRef.current -
                  Date.now()
                ) /
                1000
              )
            );


          setLovenseRemaining(
            remaining
          );


          if (
            remaining <= 0
          ) {

            setLovenseRunning(
              false
            );

            lovenseStartedRef.current =
              false;

            window.clearInterval(
              interval
            );

          }

        },
        250
      );


    return () => {

      window.clearInterval(
        interval
      );

    };

  }, [
    lovenseRunning,
  ]);


  /* =========================================================
     STOP LOVENSE WHEN LEAVING CARD
     ========================================================= */

  useEffect(() => {

    return () => {

      if (
        !lovenseStartedRef.current
      ) {
        return;
      }


      lovenseStartedRef.current =
        false;


      supabase
        .functions
        .invoke(
          "lovense-command",
          {
            body: {
              host:
                "jerome",

              action:
                "stop",
            },
          }
        )
        .catch(
          () => {}
        );

    };

  }, [
    supabase,
    cardId,
  ]);

  /* =========================================================
     RECIPIENT OPENS INVITATION
     ========================================================= */

  useEffect(() => {

    if (
      !isRecipient ||
      !trackedInvitationId
    ) {
      return;
    }


    let active =
      true;


    const markOpened =
      async () => {

        try {

          const {
            data,
            error:
              rpcError,
          } =
            await supabase.rpc(
              "mark_card_invitation_opened",
              {
                p_invitation_id:
                  trackedInvitationId,

                p_recipient_key:
                  ownerKey,
              }
            );


          if (
            rpcError
          ) {
            throw rpcError;
          }


          if (
            active
          ) {
            setOpenedAt(
              data || null
            );
          }


        } catch (err) {

          console.error(
            "MARK INVITATION OPENED ERROR:",
            err
          );

        }

      };


    markOpened();


    return () => {
      active =
        false;
    };

  }, [
    supabase,
    trackedInvitationId,
    ownerKey,
    isRecipient,
  ]);


  /* =========================================================
     SENDER WATCHES OPEN STATUS
     ========================================================= */

  useEffect(() => {

    if (
      !canPropose ||
      !trackedInvitationId
    ) {
      return;
    }


    let active =
      true;


    const checkStatus =
      async () => {

        try {

          const {
            data,
            error:
              rpcError,
          } =
            await supabase.rpc(
              "get_card_invitation_status",
              {
                p_invitation_id:
                  trackedInvitationId,

                p_sender_key:
                  ownerKey,
              }
            );


          if (
            rpcError
          ) {
            throw rpcError;
          }


          if (
            !active
          ) {
            return;
          }


          const invitation =
            Array.isArray(
              data
            )
              ? data[0]
              : data;


          if (
            invitation?.opened_at
          ) {
            setOpenedAt(
              invitation.opened_at
            );
          }


        } catch (err) {

          console.error(
            "INVITATION STATUS ERROR:",
            err
          );

        }

      };


    checkStatus();


    const interval =
      window.setInterval(
        checkStatus,
        2000
      );


    return () => {

      active =
        false;

      window.clearInterval(
        interval
      );

    };

  }, [
    supabase,
    trackedInvitationId,
    ownerKey,
    canPropose,
  ]);


  /* =========================================================
     SEND CARD
     ========================================================= */

  const sendCard =
    async () => {

      if (
        !card ||
        sending ||
        !canPropose
      ) {
        return;
      }


      try {

        setSending(
          true
        );

        setSendMessage(
          ""
        );

        setOpenedAt(
          null
        );


        const {
          data,
          error:
            functionError,
        } =
          await supabase
            .functions
            .invoke(
              "send-invitation",
              {
                body: {
                  card_id:
                    card.id,

                  challenge_id:
                    challengeId || null,
                },
              }
            );


        if (
          functionError
        ) {
          throw functionError;
        }


        if (
          !data?.success
        ) {
          throw new Error(
            data?.error ||
            "Impossible d’envoyer cette carte."
          );
        }


        const newInvitationId =
          data.invitation_id;


        if (
          newInvitationId
        ) {

          setTrackedInvitationId(
            newInvitationId
          );


          const storageKey =
            getInvitationStorageKey(
              card.id,
              activeKey
            );


          if (storageKey) {
            localStorage.setItem(
              storageKey,
              newInvitationId
            );
          }


          const challengeQuery =
            challengeId
              ? `&challenge=${challengeId}`
              : "";

          const newUrl =
            `/card/${card.id}?for=${activeKey}&invite=${newInvitationId}${challengeQuery}`;


          window.history.replaceState(
            {},
            "",
            newUrl
          );

        }


        setSendMessage(
          activePerson?.name
            ? `Carte envoyée à ${activePerson.name}.`
            : "Carte envoyée."
        );


      } catch (err) {

        console.error(
          "SEND CARD ERROR:",
          err
        );


        setSendMessage(
          err?.message ||
          "Impossible d’envoyer cette carte."
        );


      } finally {

        setSending(
          false
        );

      }

    };


  /* =========================================================
     DISPLAY
     ========================================================= */

  if (
    loading
  ) {
    return (
      <main className="card-page card-center">
        <p>
          Chargement…
        </p>
      </main>
    );
  }


  if (
    error ||
    !card
  ) {
    return (
      <main className="card-page card-center">

        <p className="error">
          {error ||
            "Carte introuvable."}
        </p>

        <button
          type="button"
          className="secondary"
          onClick={
            onBack
          }
        >
          Retour
        </button>

      </main>
    );
  }

  if (
    card.lovense_mode ===
      "required" &&
    lovenseStatusLoading
  ) {
    return (
      <main className="card-page card-center">

        <p>
          Vérification du jouet…
        </p>

      </main>
    );
  }


  if (
    card.lovense_mode ===
      "required" &&
    !lovenseConnected
  ) {
    return (
      <main className="card-page card-center">

        <p className="error">
          Cette carte nécessite un jouet Lovense connecté.
        </p>

        <button
          type="button"
          className="secondary"
          onClick={
            onBack
          }
        >
          Retour
        </button>

      </main>
    );
  }


  return (
    <main className="card-page">

      <header className="card-topbar">

        <button
          type="button"
          className="card-back"
          onClick={() => {

            if (
              lovenseStartedRef.current
            ) {

              lovenseStartedRef.current =
                false;

              supabase
                .functions
                .invoke(
                  "lovense-command",
                  {
                    body: {
                      host:
                        "jerome",

                      action:
                        "stop",
                    },
                  }
                )
                .catch(
                  () => {}
                );

            }

            onBack();

          }}
          aria-label="Retour"
        >
          ←
        </button>


        <div className="card-topbar-text">

          <span className="card-logo">
            PROTOCOL
          </span>

          <span className="card-recipient">
            Pour{" "}
            {
              activePerson?.name ||
              "ton partenaire"
            }
          </span>

        </div>

      </header>


      <section className="card-content">

        <div className="card-meta-top">

          <span className="card-type">
            {
              getTypeLabel(
                card.type
              )
            }
          </span>

          <span className="card-number">
            #{card.id}
          </span>

        </div>


        <h1 className="card-title">
          {card.title}
        </h1>


        <p className="card-prompt">
          {
            card.displayPrompt
          }
        </p>


        {
          isRecipient &&
          activeKey === "audrey" &&
          card.lovense_mode &&
          lovenseConnected && (

            <div
              style={{
                marginTop: "24px",
                padding: "16px",
                border:
                  "1px solid rgba(255,255,255,0.09)",
                borderRadius: "18px",
                background:
                  "rgba(255,255,255,0.035)",
              }}
            >

              <div
                style={{
                  display: "flex",
                  alignItems: "center",
                  justifyContent:
                    "space-between",
                  gap: "16px",
                  marginBottom: "14px",
                }}
              >

                <div>
                  <span
                    style={{
                      display: "block",
                      fontSize: "0.72rem",
                      letterSpacing: "0.14em",
                      opacity: 0.6,
                    }}
                  >
                    {lovenseRunning
                      ? "VIBRATION ACTIVE"
                      : "LOVENSE"}
                  </span>

                  {card.lovense_pattern && (
                    <span
                      style={{
                        display: "block",
                        marginTop: "4px",
                        fontSize: "0.65rem",
                        opacity: 0.45,
                        letterSpacing: "0.08em",
                        textTransform: "uppercase",
                      }}
                    >
                      {card.lovense_pattern.replaceAll(
                        "_",
                        " "
                      )}
                    </span>
                  )}
                </div>


                <strong
                  style={{
                    fontVariantNumeric:
                      "tabular-nums",
                  }}
                >
                  {formatLovenseTime(
                    lovenseRemaining
                  )}
                </strong>

              </div>


              <div
                style={{
                  display: "grid",
                  gridTemplateColumns:
                    "1fr 1fr",
                  gap: "10px",
                }}
              >

                <button
                  type="button"
                  className="secondary"
                  onClick={() =>
                    stopLovense(false)
                  }
                  disabled={
                    lovenseBusy ||
                    !lovenseRunning
                  }
                >
                  Arrêter
                </button>


                <button
                  type="button"
                  className="secondary"
                  onClick={
                    playLovense
                  }
                  disabled={
                    lovenseBusy
                  }
                >
                  {lovenseBusy
                    ? "Envoi…"
                    : "Rejouer"}
                </button>

              </div>


              {lovenseMessage && (

                <p
                  style={{
                    margin:
                      "12px 0 0",
                    fontSize:
                      "0.82rem",
                    opacity: 0.7,
                  }}
                >
                  {
                    lovenseMessage
                  }
                </p>

              )}

            </div>

          )
        }


        {canPropose ? (
          <>

            {openedAt ? (

              <p className="card-send-message">
                ✓ Vue par{" "}
                {
                  activePerson?.name
                }

                {formatOpenedTime(
                  openedAt
                ) && (
                  <>
                    {" · "}
                    {
                      formatOpenedTime(
                        openedAt
                      )
                    }
                  </>
                )}
              </p>

            ) : sendMessage ? (

              <p className="card-send-message">
                {
                  sendMessage
                }
              </p>

            ) : null}


            <button
              type="button"
              className="card-propose"
              onClick={
                sendCard
              }
              disabled={
                sending
              }
            >
              {
                sending
                  ? "Envoi…"
                  : `Proposer à ${
                      activePerson?.name ||
                      "mon partenaire"
                    }`
              }
            </button>

          </>
        ) : (

          <p className="card-send-message">

            {senderPerson?.name
              ? `Proposé par ${senderPerson.name}.`
              : "Proposé par ton partenaire."}

          </p>

        )}

      </section>

    </main>
  );
}