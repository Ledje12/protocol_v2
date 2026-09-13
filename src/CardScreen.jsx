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


export default function CardScreen({
  supabase,
  cardId,
  ownerKey,
  activeKey,
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


  useEffect(() => {
    let mounted = true;


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


          if (!mounted) {
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


          if (mounted) {
            setError(
              err?.message ||
              "Impossible de charger cette carte."
            );
          }


        } finally {

          if (mounted) {
            setLoading(
              false
            );
          }

        }

      };


    loadCard();


    return () => {
      mounted = false;
    };

  }, [
    supabase,
    cardId,
    activeKey,
    activePerson?.sex,
  ]);


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


        if (functionError) {
          throw functionError;
        }


        if (!data?.success) {
          throw new Error(
            data?.error ||
            "Impossible d’envoyer cette carte."
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


        {canPropose ? (
          <>

            {sendMessage && (
              <p className="card-send-message">
                {sendMessage}
              </p>
            )}


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
              {sending
                ? "Envoi…"
                : `Proposer à ${
                    activePerson?.name ||
                    "mon partenaire"
                  }`}
            </button>

          </>
        ) : (
          <p className="card-send-message">
            Proposé par{" "}
            {
              senderPerson?.name ||
              "ton partenaire"
            }.
          </p>
        )}

      </section>

    </main>
  );
}