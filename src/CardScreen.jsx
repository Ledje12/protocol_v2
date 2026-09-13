import {
  useEffect,
  useState,
} from "react";

import {
  getCardRecipient,
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


export default function CardScreen({
  supabase,
  cardId,
  ownerKey,
  onBack,
}) {
  const [card, setCard] =
    useState(null);

  const [loading, setLoading] =
    useState(true);

  const [error, setError] =
    useState("");


  const recipient =
    getCardRecipient(
      ownerKey
    );


  useEffect(() => {
    let active = true;

    const loadCard =
      async () => {
        try {
          setLoading(true);
          setError("");

          const {
            data,
            error:
              queryError,
          } =
            await supabase
              .from(
                "protocol_cards"
              )
              .select(
                `
                  id,
                  type,
                  title,
                  prompt,
                  intensity,
                  tension,
                  sensations,
                  unexpected,
                  active,
                  target_sex,
                  library_version,
                  library_key
                `
              )
              .eq(
                "id",
                cardId
              )
              .eq(
                "library_version",
                "v2"
              )
              .eq(
                "active",
                true
              )
              .single();

          if (queryError) {
            throw queryError;
          }

          if (!active) {
            return;
          }

          const displayPrompt =
            recipient
              ? personalizeCardPrompt(
                  data.prompt,
                  recipient.key
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

          if (active) {
            setError(
              "Impossible de charger cette carte."
            );
          }

        } finally {
          if (active) {
            setLoading(false);
          }
        }
      };

    loadCard();

    return () => {
      active = false;
    };

  }, [
    supabase,
    cardId,
    recipient?.key,
  ]);


  if (loading) {
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
          onClick={onBack}
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
          onClick={onBack}
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
            {recipient?.name ||
              "ton partenaire"}
          </span>

        </div>

      </header>


      <section className="card-content">

        <div className="card-meta-top">

          <span className="card-type">
            {getTypeLabel(
              card.type
            )}
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


        <div className="card-level-grid">

          <div className="card-level">
            <span className="card-level-label">
              INTENSITÉ
            </span>

            <span className="card-level-value">
              {card.intensity}
            </span>
          </div>


          <div className="card-level">
            <span className="card-level-label">
              TENSION
            </span>

            <span className="card-level-value">
              {card.tension}
            </span>
          </div>


          <div className="card-level">
            <span className="card-level-label">
              SENSATIONS
            </span>

            <span className="card-level-value">
              {
                card.sensations
              }
            </span>
          </div>


          <div className="card-level">
            <span className="card-level-label">
              IMPRÉVU
            </span>

            <span className="card-level-value">
              {
                card.unexpected
              }
            </span>
          </div>

        </div>


        <button
          type="button"
          className="card-propose"
          disabled
        >
          Proposer à{" "}
          {recipient?.name ||
            "mon partenaire"}
        </button>

      </section>

    </main>
  );
}