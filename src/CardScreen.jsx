import {
  useEffect,
  useRef,
  useState,
} from "react";

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

  return `${String(
    minutes
  ).padStart(
    2,
    "0"
  )}:${String(
    remainingSeconds
  ).padStart(
    2,
    "0"
  )}`;
}


export default function CardScreen({
  supabase,
  cardId,
  profile,
  couple,
  invitationId,
  challengeId,
  onBack,
}) {

  const [
    card,
    setCard,
  ] =
    useState(null);

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
    sending,
    setSending,
  ] =
    useState(false);

  const [
    sendMessage,
    setSendMessage,
  ] =
    useState("");

  const [
    trackedInvitationId,
    setTrackedInvitationId,
  ] =
    useState(
      invitationId || null
    );

  const [
    invitation,
    setInvitation,
  ] =
    useState(null);

  const [
    openedAt,
    setOpenedAt,
  ] =
    useState(null);


  const [
    lovenseConnected,
    setLovenseConnected,
  ] =
    useState(false);

  const [
    lovenseStatusLoading,
    setLovenseStatusLoading,
  ] =
    useState(true);

  const [
    lovenseRunning,
    setLovenseRunning,
  ] =
    useState(false);

  const [
    lovenseRemaining,
    setLovenseRemaining,
  ] =
    useState(0);

  const [
    lovenseBusy,
    setLovenseBusy,
  ] =
    useState(false);

  const [
    lovenseMessage,
    setLovenseMessage,
  ] =
    useState("");


  const lovenseStartedRef =
    useRef(false);

  const lovenseAutoTriggerRef =
    useRef(null);

  const lovenseEndsAtRef =
    useRef(0);


  const currentUserId =
    profile?.user_id ||
    null;


  const partner =
    couple?.partner ||
    null;


  /*
   * Sans invitation :
   * la carte est destinée au partenaire.
   *
   * Avec invitation reçue :
   * le destinataire est l'utilisateur courant.
   */
  const activePerson =
    invitation?.recipient_user_id ===
    currentUserId
      ? profile
      : partner;


  const senderPerson =
    invitation?.recipient_user_id ===
    currentUserId
      ? partner
      : profile;


  /*
   * Pas encore d'invitation :
   * on peut proposer la carte.
   *
   * Invitation existante :
   * seul son expéditeur est côté "proposition".
   */
  const canPropose =
    !trackedInvitationId ||
    invitation?.sender_user_id ===
      currentUserId;


  const isRecipient =
    Boolean(
      invitation &&
      invitation.recipient_user_id ===
        currentUserId
    );


  /* =========================================================
     SYNC INVITATION ID FROM URL
     ========================================================= */

  useEffect(() => {

    setTrackedInvitationId(
      invitationId ||
      null
    );

    setInvitation(
      null
    );

    setOpenedAt(
      null
    );

  }, [
    invitationId,
  ]);


  /* =========================================================
     LOAD INVITATION
     ========================================================= */

  useEffect(() => {

    let active =
      true;


    const loadInvitation =
      async () => {

        if (
          !trackedInvitationId
        ) {

          if (active) {
            setInvitation(
              null
            );
          }

          return;
        }


        try {

          const {
            data,
            error:
              rpcError,
          } =
            await supabase.rpc(
              "get_card_invitation_secure",
              {
                p_invitation_id:
                  String(
                    trackedInvitationId
                  ),
              }
            );


          if (
            rpcError
          ) {
            throw rpcError;
          }


          const row =
            Array.isArray(
              data
            )
              ? data[0]
              : data;


          if (
            !active
          ) {
            return;
          }


          setInvitation(
            row ||
            null
          );


          setOpenedAt(
            row?.opened_at ||
            null
          );


        } catch (err) {

          console.error(
            "INVITATION LOAD ERROR:",
            err
          );

        }

      };


    loadInvitation();


    return () => {
      active =
        false;
    };

  }, [
    supabase,
    trackedInvitationId,
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
            activePerson?.sex &&
            data.target_sex !==
              activePerson.sex
          ) {
            throw new Error(
              "Cette carte n'est pas compatible avec ce destinataire."
            );
          }


          const displayPrompt =
            String(
              data.prompt ||
              ""
            )
              .replaceAll(
                "{{active}}",
                activePerson
                  ?.display_name ||
                  "ton partenaire"
              )
              .replaceAll(
                "{{partner}}",
                senderPerson
                  ?.display_name ||
                  "ton partenaire"
              );


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
    activePerson?.user_id,
    activePerson?.sex,
    activePerson?.display_name,
    senderPerson?.display_name,
  ]);


  /* =========================================================
     LOVENSE STATUS
     ========================================================= */

  useEffect(() => {

    if (
      !card?.lovense_mode
    ) {
      setLovenseConnected(
        false
      );

      setLovenseStatusLoading(
        false
      );

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
                  body: {},
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
        !isRecipient ||
        activePerson?.sex !==
          "female"
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
                  action:
                    "play",

                  card_id:
                    card.id,
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

        const duration =
          Math.max(
            2,
            Number(
              data?.duration
            ) || 2
          );


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

        if (
          !silent
        ) {
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


        if (
          !silent
        ) {
          setLovenseMessage(
            err?.message ||
              "Impossible d’arrêter la vibration."
          );
        }


      } finally {

        if (
          !silent
        ) {
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
      activePerson?.sex !==
        "female" ||
      !card.lovense_mode ||
      card.lovense_action !==
        "vibrate" ||
      lovenseStatusLoading ||
      !lovenseConnected
    ) {
      return;
    }


    const triggerKey =
      `${card.id}-${trackedInvitationId}-${activePerson?.user_id || "unknown"}`;


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
    activePerson?.user_id,
    activePerson?.sex,
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
                  lovenseEndsAtRef
                    .current -
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
        !lovenseStartedRef
          .current
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
              "mark_card_invitation_opened_secure",
              {
                p_invitation_id:
                  String(
                    trackedInvitationId
                  ),
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
              data ||
              null
            );

            setInvitation(
              (
                previous
              ) =>
                previous
                  ? {
                      ...previous,

                      opened_at:
                        data ||
                        previous
                          .opened_at,
                    }
                  : previous
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
              "get_card_invitation_status_secure",
              {
                p_invitation_id:
                  String(
                    trackedInvitationId
                  ),
              }
            );


          if (
            rpcError
          ) {
            throw rpcError;
          }


          if (
            active &&
            data
          ) {
            setOpenedAt(
              data
            );

            setInvitation(
              (
                previous
              ) =>
                previous
                  ? {
                      ...previous,

                      opened_at:
                        data,
                    }
                  : previous
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
                    challengeId ||
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
              "Impossible d’envoyer cette carte."
          );
        }


        const newInvitationId =
          data.invitation_id;


        if (
          newInvitationId
        ) {

          const normalizedInvitationId =
            String(
              newInvitationId
            );


          setTrackedInvitationId(
            normalizedInvitationId
          );


          setInvitation({
            id:
              normalizedInvitationId,

            card_id:
              card.id,

            sender_user_id:
              currentUserId,

            recipient_user_id:
              partner?.user_id ||
              null,

            couple_id:
              couple?.id ||
              couple?.couple_id ||
              null,

            opened_at:
              null,
          });


          const challengeQuery =
            challengeId
              ? `&challenge=${challengeId}`
              : "";


          const newUrl =
            `/card/${card.id}?invite=${normalizedInvitationId}${challengeQuery}`;


          window.history
            .replaceState(
              {},
              "",
              newUrl
            );

        }


        setSendMessage(
          activePerson
            ?.display_name
            ? `Carte envoyée à ${activePerson.display_name}.`
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
              lovenseStartedRef
                .current
            ) {

              lovenseStartedRef.current =
                false;

              supabase
                .functions
                .invoke(
                  "lovense-command",
                  {
                    body: {
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
              activePerson
                ?.display_name ||
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
          activePerson?.sex ===
            "female" &&
          card.lovense_mode &&
          lovenseConnected && (

            <div
              style={{
                marginTop:
                  "24px",

                padding:
                  "16px",

                border:
                  "1px solid rgba(255,255,255,0.09)",

                borderRadius:
                  "18px",

                background:
                  "rgba(255,255,255,0.035)",
              }}
            >

              <div
                style={{
                  display:
                    "flex",

                  alignItems:
                    "center",

                  justifyContent:
                    "space-between",

                  gap:
                    "16px",

                  marginBottom:
                    "14px",
                }}
              >

                <div>

                  <span
                    style={{
                      display:
                        "block",

                      fontSize:
                        "0.72rem",

                      letterSpacing:
                        "0.14em",

                      opacity:
                        0.6,
                    }}
                  >
                    {
                      lovenseRunning
                        ? "VIBRATION ACTIVE"
                        : "LOVENSE"
                    }
                  </span>


                  {card.lovense_pattern && (

                    <span
                      style={{
                        display:
                          "block",

                        marginTop:
                          "4px",

                        fontSize:
                          "0.65rem",

                        opacity:
                          0.45,

                        letterSpacing:
                          "0.08em",

                        textTransform:
                          "uppercase",
                      }}
                    >
                      {
                        card
                          .lovense_pattern
                          .replaceAll(
                            "_",
                            " "
                          )
                      }
                    </span>

                  )}

                </div>


                <strong
                  style={{
                    fontVariantNumeric:
                      "tabular-nums",
                  }}
                >
                  {
                    formatLovenseTime(
                      lovenseRemaining
                    )
                  }
                </strong>

              </div>


              <div
                style={{
                  display:
                    "grid",

                  gridTemplateColumns:
                    "1fr 1fr",

                  gap:
                    "10px",
                }}
              >

                <button
                  type="button"
                  className="secondary"
                  onClick={() =>
                    stopLovense(
                      false
                    )
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
                  {
                    lovenseBusy
                      ? "Envoi…"
                      : "Rejouer"
                  }
                </button>

              </div>


              {lovenseMessage && (

                <p
                  style={{
                    margin:
                      "12px 0 0",

                    fontSize:
                      "0.82rem",

                    opacity:
                      0.7,
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
                  activePerson
                    ?.display_name
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
                      activePerson
                        ?.display_name ||
                      "mon partenaire"
                    }`
              }
            </button>

          </>
        ) : (

          <p className="card-send-message">

            {
              senderPerson
                ?.display_name
                ? `Proposé par ${senderPerson.display_name}.`
                : "Proposé par ton partenaire."
            }

          </p>

        )}

      </section>

    </main>
  );
}