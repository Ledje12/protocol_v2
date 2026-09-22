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
              .select(
                `
                  id,
                  card_id,
                  sender_key,
                  recipient_key,
                  sender_user_id,
                  recipient_user_id,
                  couple_id,
                  sent_at,
                  opened_at
                `
              )
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
                  invitation
                    .sender_user_id ===
                  currentUserId;


                const otherKey =
                  isSent
                    ? invitation
                        .recipient_key
                    : invitation
                        .sender_key;


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

                  sender_key:
                    invitation.sender_key,

                  recipient_key:
                    invitation.recipient_key,

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

                  other_key:
                    otherKey,

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
          onClick={
            onBack
          }
          aria-label="Retour"
        >
          ←
        </button>


        <div>

          <div className="invitations-logo">
            PROTOCOL
          </div>

          <div className="invitations-subtitle">
            Invitations
          </div>

        </div>

      </header>


      <section className="invitations-content">

        <h1>
          Invitations
        </h1>


        {loading ? (

          <p>
            Chargement…
          </p>

        ) : error ? (

          <p className="error">
            {error}
          </p>

        ) : invitations.length ===
          0 ? (

          <p className="invitations-empty">
            Aucune invitation pour le moment.
          </p>

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
                ]
                  .filter(
                    Boolean
                  )
                  .join(
                    " "
                  );


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

                    <div className="invitation-item-top">

                      <span className="invitation-title">
                        {
                          invitation.card_title
                        }
                      </span>

                      <span className="invitation-type">
                        {
                          String(
                            invitation.card_type ||
                            ""
                          ).toUpperCase()
                        }
                      </span>

                    </div>


                    <div className="invitation-meta">

                      <span>
                        {
                          isSent
                            ? `→ ${other?.name || "Partenaire"}`
                            : `← ${other?.name || "Partenaire"}`
                        }
                      </span>

                      <span>
                        {
                          formatDateTime(
                            invitation.sent_at
                          )
                        }
                      </span>

                    </div>


                    <div
                      className={
                        invitation.opened_at
                          ? "invitation-status opened"
                          : isSent
                            ? "invitation-status pending"
                            : "invitation-status received"
                      }
                    >

                      {
                        isSent
                          ? invitation.opened_at
                            ? `✓ Vue ${formatDateTime(
                                invitation.opened_at
                              )}`
                            : "○ En attente"

                          : invitation.opened_at
                            ? "✓ Ouverte"
                            : "Reçue"
                      }

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