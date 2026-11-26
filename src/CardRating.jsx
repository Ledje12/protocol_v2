import { useEffect, useState } from "react";

// Avis facultatif et privé sur une carte : j'adore (flamme), j'aime,
// je n'aime pas. Toucher l'avis actif le retire. Sans la
// migration (table absente), le composant ne s'affiche pas.

const RATINGS = [
  ["fire", "J’adore"],
  ["like", "J’aime"],
  ["dislike", "Je n’aime pas"],
];

// signaler une carte de la bibliothèque (lu par l'équipe dans l'éditeur SQL)
const REPORT_REASONS = [
  ["faute", "Faute ou phrase bizarre"],
  ["flop", "Tombe à plat"],
  ["pas_pour_nous", "Pas pour nous"],
  ["doublon", "Ressemble à une autre"],
  ["autre", "Autre chose"],
];

// mêmes traits fins que les autres icônes de l'app
const PATHS = {
  report: "M5 21V4m0 0h11l-2 4 2 4H5",
  fire: "M12 21c3.6 0 6-2.5 6-5.9 0-2.6-1.5-4.3-2.8-6-.5 1.3-1.2 2-2.1 2.4.3-3-1-5.9-3.6-8 .2 2.9-1 4.6-2.4 6.300C6 11.300 6 13.200 6 15.100 6 18.500 8.400 21 12 21Z",
  like: "M7 11v9H4.500A1.500 1.500 0 0 1 3 18.500v-6A1.500 1.500 0 0 1 4.500 11H7Zm0 0 3.600-7.200A2.300 2.300 0 0 1 13 6v3.500h5.200a2 2 0 0 1 2 2.400l-1.300 6.500a2 2 0 0 1-2 1.600H7",
  dislike: "M17 13V4h2.500A1.500 1.500 0 0 1 21 5.500v6a1.500 1.500 0 0 1-1.500 1.500H17Zm0 0-3.600 7.200A2.300 2.300 0 0 1 11 18v-3.500H5.800a2 2 0 0 1-2-2.400l1.300-6.500a2 2 0 0 1 2-1.600H17",
};

function RatingIcon({ value }) {
  return (
    <svg
      width="18"
      height="18"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.6"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d={PATHS[value]} />
    </svg>
  );
}

export default function CardRating({
  supabase,
  cardSource = "official",
  cardId,
  initialRating,
  onChange,
  className = "",
}) {
  // undefined : en cours de chargement ou indisponible
  const [rating, setRating] =
    useState(initialRating);

  const [available, setAvailable] =
    useState(initialRating !== undefined);

  // signalement : fermé, ouvert (choix du motif), envoyé
  const [report, setReport] = useState(null);
  const [reportReason, setReportReason] = useState("");
  const [reportComment, setReportComment] = useState("");
  const [reportError, setReportError] = useState("");
  const canReport = cardSource === "official";

  useEffect(() => {
    if (initialRating !== undefined || !cardId) {
      return undefined;
    }

    let active = true;

    supabase
      .from("protocol_card_ratings")
      .select("rating")
      .eq("card_source", cardSource)
      .eq("card_id", cardId)
      .maybeSingle()
      .then(({ data, error }) => {
        if (!active || error) {
          return;
        }

        setRating(data?.rating ?? null);
        setAvailable(true);
      });

    return () => {
      active = false;
    };
  }, [supabase, cardSource, cardId, initialRating]);

  if (!available || !cardId) {
    return null;
  }

  const choose = async (value) => {
    const previous = rating;
    const next = rating === value ? null : value;

    setRating(next);
    onChange?.(next);

    const { error } =
      await supabase.rpc("set_card_rating", {
        p_card_source: cardSource,
        p_card_id: cardId,
        p_rating: next,
      });

    if (error) {
      console.error("CARD RATING ERROR:", error);
      setRating(previous);
      onChange?.(previous);
    }
  };

  // toucher un motif envoie le signalement (avec le mot, s'il y en a un)
  const sendReport = async (reason) => {
    if (!reason || report === "sending") return;

    setReportReason(reason);
    setReport("sending");
    setReportError("");

    const { error } = await supabase.rpc("report_protocol_card", {
      p_card_source: cardSource,
      p_card_id: cardId,
      p_reason: reason,
      p_comment: reportComment.trim() || null,
    });

    if (error) {
      console.error("CARD REPORT ERROR:", error);
      setReport("open");
      setReportError("Le signalement n’est pas passé. Réessaie.");
      return;
    }

    setReport("sent");
  };

  return (
    <>
    <div
      className={`card-rating ${className}`.trim()}
      role="group"
      aria-label="Ton avis sur cette carte"
    >
      {RATINGS.map(([value, label]) => (
        <button
          key={value}
          type="button"
          className={
            rating === value
              ? "card-rating-option is-active"
              : "card-rating-option"
          }
          aria-pressed={rating === value}
          aria-label={label}
          title={label}
          onClick={() => choose(value)}
        >
          <RatingIcon value={value} />
        </button>
      ))}
      {canReport && (
        <button
          type="button"
          className={
            report
              ? "card-rating-option card-report-toggle is-active"
              : "card-rating-option card-report-toggle"
          }
          aria-expanded={Boolean(report)}
          aria-label="Signaler cette carte"
          title="Signaler cette carte"
          onClick={() => {
            setReport(report ? null : "open");
            setReportError("");
          }}
        >
          <RatingIcon value="report" />
        </button>
      )}
    </div>

    {report && (
      <div className="card-report" role="group" aria-label="Signaler cette carte">
        {report === "sent" ? (
          <p className="card-report-thanks">Merci, c’est noté.</p>
        ) : (
          <>
            <p className="card-report-title">Qu’est-ce qui ne va pas ?</p>
            <textarea
              className="card-report-comment"
              rows={2}
              maxLength={500}
              placeholder="Un mot de plus, si tu veux (facultatif)"
              value={reportComment}
              onChange={(event) => setReportComment(event.target.value)}
            />
            <div className="card-report-reasons">
              {REPORT_REASONS.map(([value, label]) => (
                <button
                  key={value}
                  type="button"
                  className={
                    reportReason === value && report === "sending"
                      ? "card-report-reason is-active"
                      : "card-report-reason"
                  }
                  disabled={report === "sending"}
                  onClick={() => sendReport(value)}
                >
                  {report === "sending" && reportReason === value ? "Envoi…" : label}
                </button>
              ))}
            </div>
            <p className="card-report-hint">Touche le motif : c’est envoyé.</p>
            {reportError && <p className="error">{reportError}</p>}
          </>
        )}
      </div>
    )}
    </>
  );
}
