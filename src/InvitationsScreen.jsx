import {
  useEffect,
  useState,
} from "react";

import "./invitations.css";
import { formatRelativeTime } from "./formatTime.js";
import { markInboxSeen } from "./unread.js";
import { BackIcon } from "./ScreenHeader.jsx";



function getInvitationTypeLabel(
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

/* textes des signes reçus et action proposée */
const SIGNAL_COPY = {
  challenge: {
    text: (name) => `${name} te laisse lui choisir un défi.`,
    action: "Choisir son défi",
    path: (signal) => `/library?challenge=${signal.id}`,
  },
  tonight: {
    text: (name) => `${name} propose Protocol ce soir.`,
    action: "Lancer une partie",
    path: () => "/",
  },
  secret: {
    text: (name) => `${name} a un secret à partager avec toi.`,
    action: "Lui écrire",
    path: () => "/messages",
  },
};

const RESPONSE_LABELS = {
  tonight: "Ce soir",
  later: "Plus tard",
  love: "J’adore",
};

export default function InvitationsScreen({
  supabase,
  profile,
  couple,
  onBack,
  onOpenCard,
  onOpenPath,
}) {

  const [
    invitations,
    setInvitations,
  ] =
    useState([]);

  const [
    loading,
    setLoading,
  ] =
    useState(true);

  /* signes reçus (« Un défi ? », « Ce soir ? »…) */
  const [
    signals,
    setSignals,
  ] =
    useState([]);

  useEffect(() => {
    let active = true;

    supabase
      .rpc("get_my_signals")
      .then(({ data, error: signalError }) => {
        if (active && !signalError && Array.isArray(data)) {
          setSignals(
            data.filter((signal) => SIGNAL_COPY[signal.type])
          );
        }
      });

    return () => {
      active = false;
    };
  }, [supabase]);

  const [
    error,
    setError,
  ] =
    useState("");


  const currentUserId =
    profile?.user_id ||
    null;


  const partnerName =
    couple?.partner
      ?.display_name || null;


  const coupleId =
    couple?.id ||
    couple?.couple_id ||
    null;


  useEffect(() => {

    let active =
      true;


    const loadInvitations =
      async () => {

        if (
          !currentUserId ||
          !coupleId
        ) {
          if (active) {
            setInvitations([]);
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


          /* =============================================
             INVITATIONS DU COUPLE
             ============================================= */

          /* réponses rapides (migration 20261009090000) :
             si la base n'a pas encore les colonnes, on relit
             sans elles plutôt que de bloquer l'écran */
          const loadRows = (withResponse) =>
            supabase
              .from(
                "card_invitations"
              )
              .select(`
                id,
                card_source,
                card_id,
                custom_card_id,
                sender_user_id,
                recipient_user_id,
                couple_id,
                sent_at,
                opened_at${withResponse ? ",\n                response" : ""}
              `)
              .eq(
                "couple_id",
                coupleId
              )
              .or(
                `sender_user_id.eq.${currentUserId},recipient_user_id.eq.${currentUserId}`
              )
              .order(
                "sent_at",
                {
                  ascending:
                    false,
                }
              );

          let {
            data:
              invitationRows,
            error:
              invitationError,
          } = await loadRows(true);

          if (
            invitationError?.code ===
            "42703"
          ) {
            ({
              data:
                invitationRows,
              error:
                invitationError,
            } = await loadRows(false));
          }


          if (
            invitationError
          ) {
            throw invitationError;
          }


          const rows =
            Array.isArray(
              invitationRows
            )
              ? invitationRows
              : [];


          if (
            rows.length === 0
          ) {

            if (active) {
              setInvitations([]);
            }

            return;
          }

            
            /* =============================================
                CARTES ASSOCIÉES
                ============================================= */

              const officialCardIds = [
                ...new Set(
                  rows
                    .filter(
                      (row) =>
                        (
                          row.card_source ||
                          "official"
                        ) ===
                          "official"
                    )
                    .map(
                      (row) =>
                        row.card_id
                    )
                    .filter(Boolean)
                ),
              ];


              const customCardIds = [
                ...new Set(
                  rows
                    .filter(
                      (row) =>
                        row.card_source ===
                          "custom"
                    )
                    .map(
                      (row) =>
                        row.custom_card_id
                    )
                    .filter(Boolean)
                ),
              ];


              let officialCards = [];
              let customCards = [];


              if (
                officialCardIds.length >
                  0
              ) {

                const {
                  data,
                  error:
                    cardsError,
                } =
                  await supabase
                    .from(
                      "protocol_cards"
                    )
                    .select(`
                      id,
                      title,
                      type
                    `)
                    .in(
                      "id",
                      officialCardIds
                    );


                if (
                  cardsError
                ) {
                  throw cardsError;
                }


                officialCards =
                  data || [];

              }


              if (
                customCardIds.length >
                  0
              ) {

                const {
                  data,
                  error:
                    cardsError,
                } =
                  await supabase
                    .from(
                      "protocol_custom_cards"
                    )
                    .select(`
                      id,
                      title,
                      type
                    `)
                    .eq(
                      "couple_id",
                      coupleId
                    )
                    .in(
                      "id",
                      customCardIds
                    );


                if (
                  cardsError
                ) {
                  throw cardsError;
                }


                customCards =
                  data || [];

              }


              const officialCardMap =
                new Map(
                  officialCards.map(
                    (card) => [
                      card.id,
                      card,
                    ]
                  )
                );


              const customCardMap =
                new Map(
                  customCards.map(
                    (card) => [
                      card.id,
                      card,
                    ]
                  )
                );


              const normalized =
                rows.map(
                  (invitation) => {

                    const cardSource =
                      invitation.card_source ||
                      "official";


                    const effectiveCardId =
                      cardSource ===
                        "custom"
                        ? invitation.custom_card_id
                        : invitation.card_id;


                    const card =
                      cardSource ===
                        "custom"
                        ? customCardMap.get(
                            effectiveCardId
                          )
                        : officialCardMap.get(
                            effectiveCardId
                          );


                    const isSent =
                      invitation.sender_user_id ===
                      currentUserId;


                    return {

                      invitation_id:
                        invitation.id,

                      card_source:
                        cardSource,

                      card_id:
                        effectiveCardId,

                      official_card_id:
                        invitation.card_id,

                      custom_card_id:
                        invitation.custom_card_id,

                      card_title:
                        card?.title ||
                        "Carte",

                      card_type:
                        card?.type ||
                        "",

                      sender_user_id:
                        invitation.sender_user_id,

                      recipient_user_id:
                        invitation.recipient_user_id,

                      couple_id:
                        invitation.couple_id,

                      direction:
                        isSent
                          ? "sent"
                          : "received",

                      sent_at:
                        invitation.sent_at,

                      opened_at:
                        invitation.opened_at,

                      response:
                        invitation.response ||
                        null,

                    };

                  }
                );

                if (
                  active
                ) {
                  setInvitations(
                    normalized
                  );

                  // ouverture de l'écran : signes et réponses vus
                  markInboxSeen(supabase);
                }


        } catch (
          err
        ) {

          console.error(
            "INVITATIONS LOAD ERROR:",
            err
          );


          if (
            active
          ) {
            /* message humain : l'erreur technique reste en console */
            setError(
              "Impossible de charger les invitations. Vérifie ta connexion puis réessaie."
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


    loadInvitations();


    return () => {
      active =
        false;
    };


  }, [
    supabase,
    currentUserId,
    coupleId,
  ]);


  return (
    <main className="invitations-page">

      <header className="invitations-topbar">

        <button
          type="button"
          className="invitations-back"
          onClick={onBack}
          aria-label="Retour"
        >
          <BackIcon />
        </button>


        <div className="invitations-heading">

          <span className="invitations-logo">
            PROTOCOL
          </span>

          <span className="invitations-subtitle">
            {partnerName
              ? `Avec ${partnerName}`
              : "Invitations"}
          </span>

        </div>

      </header>


      <section className="invitations-content">

        <header className="invitations-intro">

          <p className="invitations-kicker">
            INVITATIONS
          </p>

          <h1>
            Vos
            <br />
            propositions.
          </h1>

          <p>
            Les cartes proposées,
            reçues et déjà découvertes.
          </p>

        </header>


        {loading ? (

          <div className="invitations-state">
            Chargement…
          </div>

        ) : error ? (

          <p className="error">
            {error}
          </p>

        ) : invitations.length === 0 &&
          signals.length === 0 ? (

          <div className="invitations-empty">

            <span>
              <span className="protocol-diamond" aria-hidden="true" />
            </span>

            <strong>
              Rien pour le moment.
            </strong>

            <p>
              Les cartes échangées avec ton partenaire
              apparaîtront ici.
            </p>

          </div>

        ) : (

          <>
          {signals.length > 0 && (
            <section className="signals-list">
              <h2 className="signals-title">
                <span aria-hidden="true" />
                Signes reçus
              </h2>

              {signals.map((signal) => {
                const copy =
                  SIGNAL_COPY[signal.type];

                const done =
                  signal.type === "challenge" &&
                  signal.status !== "pending";

                return (
                  <article
                    key={signal.id}
                    className={
                      signal.seen_at
                        ? "signal-item"
                        : "signal-item is-new"
                    }
                  >
                    <span
                      className="protocol-diamond"
                      aria-hidden="true"
                    />

                    <div className="signal-body">
                      <p>
                        {copy.text(signal.sender_name)}
                      </p>

                      <small>
                        {formatRelativeTime(signal.created_at)}
                        {done && " · Défi choisi"}
                      </small>
                    </div>

                    {!done && onOpenPath && (
                      <button
                        type="button"
                        className="signal-action"
                        onClick={() =>
                          onOpenPath(copy.path(signal))
                        }
                      >
                        {copy.action}
                      </button>
                    )}
                  </article>
                );
              })}
            </section>
          )}

          {invitations.length > 0 && (
          <div className="invitations-list">

            {invitations.map(
              (
                invitation
              ) => {

                const otherName =
                  couple?.partner?.display_name ||
                  "Partenaire";


                const isSent =
                  invitation.direction ===
                  "sent";


                const isPending =
                  isSent &&
                  !invitation.opened_at;


                const itemClassName = [
                  "invitation-item",

                  isSent
                    ? "is-sent"
                    : "is-received",

                  isPending
                    ? "is-pending"
                    : "",

                  `invitation-type-${invitation.card_type || "other"}`,
                ]
                  .filter(Boolean)
                  .join(" ");


                return (

                  <button
                    key={
                      invitation.invitation_id
                    }
                    type="button"
                    className={
                      itemClassName
                    }
                    onClick={() => {

                      onOpenCard({
                        cardId:
                          invitation.card_id,

                        invitationId:
                          invitation.invitation_id,
                      });

                    }}
                  >

                    <div className="invitation-accent" />


                    <div className="invitation-item-top">

                      <span className="invitation-type">
                        {getInvitationTypeLabel(
                          invitation.card_type
                        )}
                      </span>

                      <span className="invitation-date">
                        {formatRelativeTime(
                          invitation.sent_at
                        )}
                      </span>

                    </div>


                    <h2 className="invitation-title">
                      {invitation.card_title}
                    </h2>


                    <div className="invitation-direction">

                      <span
                        className={
                          isSent
                            ? "invitation-direction-icon is-sent"
                            : "invitation-direction-icon is-received"
                        }
                      >
                        {isSent
                          ? "→"
                          : "←"}
                      </span>

                      <span>
                        {isSent
                          ? `Proposée à ${otherName}`
                          : `Reçue de ${otherName}`}
                      </span>

                    </div>


                    <div className="invitation-footer">

                      <div
                        className={
                          invitation.opened_at
                            ? "invitation-status opened"
                            : isSent
                              ? "invitation-status pending"
                              : "invitation-status received"
                        }
                      >

                        <span className="invitation-status-dot" />

                        <span>
                          {invitation.response
                            ? isSent
                              ? `${otherName} : « ${RESPONSE_LABELS[invitation.response]} »`
                              : `Tu as répondu « ${RESPONSE_LABELS[invitation.response]} »`
                            : isSent
                            ? invitation.opened_at
                              ? `Vue ${formatRelativeTime(
                                  invitation.opened_at,
                                  { lower: true }
                                )}`
                              : "En attente"

                            : invitation.opened_at
                              ? "Ouverte"
                              : "À découvrir"}
                        </span>

                      </div>


                      <span className="invitation-open-arrow">
                        →
                      </span>

                    </div>

                  </button>

                );

              }
            )}

          </div>
          )}
          </>

        )}

      </section>

    </main>
  );
}