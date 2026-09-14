import {
  useEffect,
  useState,
} from "react";

import {
  getPerson,
} from "./cardPersonalization.js";

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
        day: "2-digit",
        month: "2-digit",
        hour: "2-digit",
        minute: "2-digit",
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
  ownerKey,
  onBack,
  onOpenCard,
}) {

  const [
    invitations,
    setInvitations,
  ] = useState([]);

  const [
    loading,
    setLoading,
  ] = useState(true);

  const [
    error,
    setError,
  ] = useState("");


  useEffect(() => {

    let active = true;

    const loadInvitations =
      async () => {

        try {

          setLoading(true);
          setError("");

          const {
            data,
            error: rpcError,
          } =
            await supabase.rpc(
              "get_card_invitations",
              {
                p_owner_key:
                  ownerKey,
              }
            );

          if (rpcError) {
            throw rpcError;
          }

          if (!active) {
            return;
          }

          setInvitations(
            Array.isArray(data)
              ? data
              : []
          );

        } catch (err) {

          console.error(
            "INVITATIONS LOAD ERROR:",
            err
          );

          if (active) {
            setError(
              err?.message ||
              "Impossible de charger les invitations."
            );
          }

        } finally {

          if (active) {
            setLoading(false);
          }

        }

      };

    loadInvitations();

    return () => {
      active = false;
    };

  }, [
    supabase,
    ownerKey,
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

        ) : invitations.length === 0 ? (

          <p className="invitations-empty">
            Aucune invitation pour le moment.
          </p>

        ) : (

          <div className="invitations-list">

            {invitations.map(
              (invitation) => {

                const other =
                  getPerson(
                    invitation.other_key
                  );

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

                        activeKey:
                          invitation.recipient_key,

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
                            : "● En attente"
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