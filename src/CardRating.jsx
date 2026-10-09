import { useEffect, useState } from "react";

// Avis facultatif et privé sur une carte : 🔥 j'adore, 👍 j'aime,
// 👎 je n'aime pas. Toucher l'avis actif le retire. Sans la
// migration (table absente), le composant ne s'affiche pas.

const RATINGS = [
  ["fire", "🔥", "J’adore"],
  ["like", "👍", "J’aime"],
  ["dislike", "👎", "Je n’aime pas"],
];

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

  return (
    <div
      className={`card-rating ${className}`.trim()}
      role="group"
      aria-label="Ton avis sur cette carte"
    >
      {RATINGS.map(([value, icon, label]) => (
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
          <span aria-hidden="true">{icon}</span>
        </button>
      ))}
    </div>
  );
}
