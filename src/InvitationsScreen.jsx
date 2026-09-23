import {
  useEffect,
  useState,
} from "react";

import "./invitations.css";


function formatDateTime(
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

export default function InvitationsScreen({
  supabase,
  profile,
  couple,
  onBack,
  onOpenCard,
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

  const [
    error,
    setError,
  ] =
    useState("");


  const currentUserId =
    profile?.user_id ||
    null;


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

          const {
            data:
              invitationRows,

            error:
              invitationError,
          } =
            await supabase
              .from(
                "card_invitations"
              )
              .select(`
                id,
                card_id,
                sender_user_id,
                recipient_user_id,
                couple_id,
                sent_at,
                opened_at
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

          const cardIds = [
            ...new Set(
              rows
                .map(
                  (row) =>
                    row.card_id
                )
                .filter(
                  Boolean
                )
            ),
          ];


          const {
            data:
              cards,

            error:
              cardsError,
          } =
            await supabase
              .from(
                "protocol_cards"
              )
              .select(
                `
                  id,
                  title,
                  type
                `
              )
              .in(
                "id",
                cardIds
              );


          if (
            cardsError
          ) {
            throw cardsError;
          }


          const cardMap =
            new Map(
              (
                cards || []
              ).map(
                (card) => [
                  card.id,
                  card,
                ]
              )
            );


          const normalized =
            rows.map(
              (invitation) => {

                const card =
                  cardMap.get(
                    invitation.card_id
                  );


                const isSent =
                  invitation.sender_user_id ===
                  currentUserId;


                const otherName =
                  couple?.partner?.display_name ||
                  "Partenaire";


                return {
                  invitation_id:
                    invitation.id,

                  card_id:
                    invitation.card_id,

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
                };

              }
            );


          if (
            active
          ) {
            setInvitations(
              normalized
            );
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
            setError(
              err?.message ||
                "Impossible de charger les invitations."
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
          ←
        </button>


        <div className="invitations-heading">

          <span className="invitations-logo">
            PROTOCOL
          </span>

          <span className="invitations-subtitle">
            À deux
          </span>

        </div>

      </header>


      <section className="invitations-content">

        <header className="invitations-intro">

          <p className="invitations-kicker">
            INVITATIONS
          </p>

          <h1>
            Entre
            <br />
            vous.
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

        ) : invitations.length === 0 ? (

          <div className="invitations-empty">

            <span>
              ◇
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
                        {formatDateTime(
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
                          {isSent
                            ? invitation.opened_at
                              ? `Vue ${formatDateTime(
                                  invitation.opened_at
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

      </section>

    </main>
  );
}