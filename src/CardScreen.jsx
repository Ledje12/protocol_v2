import {
  useEffect,
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
  invitationId,
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
              "send-card-invitation",
              {
                body: {
                  sender:
                    ownerKey,

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


          const newUrl =
            `/card/${card.id}?for=${activeKey}&invite=${newInvitationId}`;


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


  return (
    <main className="card-page">

      <header className="card-topbar">

        <button
          type="button"
          className="card-back"
          onClick={
            onBack
          }
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