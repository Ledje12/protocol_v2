import { useEffect, useRef, useState } from "react";

import CardPhotos, { PHOTO_COLUMNS, cardKey } from "./CardPhotos.jsx";
import CardRating from "./CardRating.jsx";
import { BackIcon } from "./ScreenHeader.jsx";
import { SettingsSheet } from "./SettingsParts.jsx";
import { levelForIntensity } from "./gameConstants.js";

/* « Nos soirées » : le souvenir de chaque partie terminée.
   Le bloc « Votre soirée » en fin de partie, et l'écran qui les
   garde toutes (Réglages → Nos soirées). */

const TYPE_LABELS = {
  action: "Action",
  truth: "Vérité",
  duel: "Duel",
  scene: "Scène",
};

const RATING_ICONS = {
  fire: "🔥",
  like: "👍",
  dislike: "👎",
};

const OUTCOME_LABELS = {
  done: "Fait",
  pass: "Passé",
  alternative: "Remplacé",
};

// « 1 h 12 », « 47 min »
function formatDuration(startedAt, finishedAt) {
  if (!startedAt || !finishedAt) {
    return null;
  }

  const minutes = Math.max(
    1,
    Math.round((new Date(finishedAt) - new Date(startedAt)) / 60000)
  );

  if (minutes < 60) {
    return `${minutes} min`;
  }

  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  return rest ? `${hours} h ${String(rest).padStart(2, "0")}` : `${hours} h`;
}

// « Samedi 11 octobre », avec l'année si ce n'est pas celle-ci
const formatDate = (value) => {
  const date = new Date(value);
  const text = date.toLocaleDateString("fr-FR", {
    weekday: "long",
    day: "numeric",
    month: "long",
    ...(date.getFullYear() !== new Date().getFullYear() ? { year: "numeric" } : {}),
  });
  return text.charAt(0).toUpperCase() + text.slice(1);
};

const favoritesOf = (recap) =>
  (recap?.cards || []).filter((card) => card.my_rating === "fire" || card.fire_both);

const doneCount = (recap) =>
  (recap?.cards || []).filter((card) => card.outcome === "done").length;

// mon avis changé : toutes les apparitions de la carte suivent
const withRating = (recap, card, rating) => ({
  ...recap,
  cards: recap.cards.map((item) =>
    item.source === card.source && item.card_id === card.card_id
      ? { ...item, my_rating: rating }
      : item
  ),
});

// après un avis : relire les soirées (🔥 à deux) sans à-coups
function useRatingRefresh(supabase, onFresh) {
  const timerRef = useRef(null);

  useEffect(() => () => window.clearTimeout(timerRef.current), []);

  return () => {
    window.clearTimeout(timerRef.current);
    timerRef.current = window.setTimeout(() => {
      loadRecaps(supabase).then(onFresh).catch(() => {});
    }, 800);
  };
}

async function loadRecaps(supabase, gameId = null) {
  const { data, error } = await supabase.rpc(
    "get_protocol_recaps",
    gameId ? { p_game_id: gameId } : {}
  );

  if (error) {
    throw error;
  }

  return data || [];
}


/* ---------------------------------------------------------
   FIN DE PARTIE : « Votre soirée »
   --------------------------------------------------------- */

export function GameRecapHighlights({ supabase, gameId, finishedAt }) {
  const [recap, setRecap] = useState(null);
  const [showCards, setShowCards] = useState(false);
  const refresh = useRatingRefresh(supabase, (recaps) =>
    setRecap((current) => recaps.find((item) => item.id === current?.id) || current)
  );

  useEffect(() => {
    let active = true;

    if (!gameId || !finishedAt) {
      return undefined;
    }

    loadRecaps(supabase, gameId)
      .then((recaps) => {
        if (active) {
          // la soirée qui vient de se terminer (pas une précédente)
          setRecap(
            recaps.find(
              (item) => new Date(item.finished_at).getTime() === new Date(finishedAt).getTime()
            ) || null
          );
        }
      })
      .catch(() => {
        // sans la migration : pas de bloc, la fin reste la même
      });

    return () => {
      active = false;
    };
  }, [supabase, gameId, finishedAt]);

  if (!recap) {
    return null;
  }

  const duration = formatDuration(recap.started_at, recap.finished_at);
  const favorites = favoritesOf(recap);

  return (
    <section className="recap-highlights">
      <p className="recap-kicker">VOTRE SOIRÉE</p>

      <div className="recap-figures">
        {duration && (
          <div>
            <strong>{duration}</strong>
            <span>de jeu</span>
          </div>
        )}
        <div>
          <strong>{doneCount(recap)}</strong>
          <span>défis relevés</span>
        </div>
        {favorites.length > 0 && (
          <div>
            <strong>{favorites.length}</strong>
            <span>coup{favorites.length > 1 ? "s" : ""} de cœur</span>
          </div>
        )}
      </div>

      {favorites.length > 0 && (
        <ul className="recap-favorites">
          {favorites.map((card, index) => (
            <li key={`${card.source}-${card.card_id}-${index}`}>
              <span>{card.title}</span>
              <span aria-label={card.fire_both ? "🔥 pour vous deux" : "Ton 🔥"}>
                {card.fire_both ? "🔥🔥" : "🔥"}
              </span>
            </li>
          ))}
        </ul>
      )}

      <button type="button" className="recap-cards-link" onClick={() => setShowCards(true)}>
        Revoir les cartes et les noter →
      </button>

      <p className="recap-note">Gardée dans Réglages → Nos soirées.</p>

      {showCards && (
        <SettingsSheet
          eyebrow="VOTRE SOIRÉE"
          title="Les cartes de ce soir."
          onClose={() => setShowCards(false)}
        >
          <RecapDetail
            recap={recap}
            supabase={supabase}
            onRated={(card, rating) => {
              setRecap((current) => withRating(current, card, rating));
              refresh();
            }}
          />
        </SettingsSheet>
      )}
    </section>
  );
}


/* ---------------------------------------------------------
   ÉCRAN « NOS SOIRÉES »
   --------------------------------------------------------- */

export default function RecapsScreen({ supabase, onBack }) {
  const [recaps, setRecaps] = useState(null);
  const [error, setError] = useState("");
  const [open, setOpen] = useState(null);
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const refresh = useRatingRefresh(supabase, (rows) => {
    setRecaps(rows);
    setOpen((current) => rows.find((item) => item.id === current?.id) || current);
  });

  useEffect(() => {
    let active = true;

    loadRecaps(supabase)
      .then((rows) => active && setRecaps(rows))
      .catch((err) => {
        console.error("RECAPS LOAD ERROR:", err);
        if (active) {
          setError("Impossible de charger vos soirées. Vérifie ta connexion puis réessaie.");
          setRecaps([]);
        }
      });

    return () => {
      active = false;
    };
  }, [supabase]);

  const forget = async () => {
    setBusy(true);

    const { error: deleteError } = await supabase.rpc("delete_protocol_recap", {
      p_recap_id: open.id,
    });

    setBusy(false);

    if (deleteError) {
      console.error("RECAP DELETE ERROR:", deleteError);
      setError("La soirée n’a pas pu être oubliée.");
      return;
    }

    setRecaps((current) => current.filter((item) => item.id !== open.id));
    setOpen(null);
    setConfirming(false);
  };

  return (
    <main className="app protocol-settings-page recaps-page">
      {/* même en-tête que Réglages et Mes cartes */}
      <header className="header protocol-settings-header">
        <button
          type="button"
          className="back protocol-settings-back"
          onClick={onBack}
          aria-label="Retour"
        >
          <BackIcon />
        </button>

        <div className="protocol-settings-heading">
          <span className="logo protocol-settings-logo">PROTOCOL</span>
          <span className="protocol-settings-subtitle">Vos souvenirs</span>
        </div>
      </header>

      <section className="protocol-settings recaps">
        <section className="protocol-settings-intro">
          <p className="kicker">NOS SOIRÉES</p>
          <h1>
            Ce que vous
            <br />
            avez vécu.
          </h1>
          <p className="intro">
            Chaque partie terminée laisse ici sa trace : la durée, les
            cartes tirées, vos coups de cœur.
          </p>
        </section>

        {recaps === null && <p className="recaps-status">Chargement…</p>}
        {error && <p className="recaps-status is-error">{error}</p>}

        {recaps?.length === 0 && !error && (
          <div className="recaps-empty">
            <span className="protocol-diamond" aria-hidden="true" />
            <p>Votre première soirée s’inscrira ici à la fin de votre prochaine partie.</p>
          </div>
        )}

        {recaps?.length > 0 && (
          <div className="recaps-list">
            {recaps.map((recap) => {
              const duration = formatDuration(recap.started_at, recap.finished_at);
              const favorites = favoritesOf(recap).length;

              return (
                <button
                  key={recap.id}
                  type="button"
                  className="recap-item"
                  onClick={() => {
                    setConfirming(false);
                    setOpen(recap);
                  }}
                >
                  <span className="recap-item-main">
                    <strong>{formatDate(recap.finished_at)}</strong>
                    <span>
                      {[
                        duration,
                        `${recap.cards.length} carte${recap.cards.length > 1 ? "s" : ""}`,
                        favorites > 0 ? `${favorites} 🔥` : null,
                      ]
                        .filter(Boolean)
                        .join(" · ")}
                    </span>
                  </span>
                  <span className="recap-item-arrow" aria-hidden="true">→</span>
                </button>
              );
            })}
          </div>
        )}
      </section>

      {open && (
        <SettingsSheet
          eyebrow="NOTRE SOIRÉE"
          title={formatDate(open.finished_at)}
          onClose={() => setOpen(null)}
        >
          <RecapDetail
            recap={open}
            supabase={supabase}
            onRated={(card, rating) => {
              setOpen((current) => withRating(current, card, rating));
              setRecaps((current) =>
                current.map((item) => (item.id === open.id ? withRating(item, card, rating) : item))
              );
              refresh();
            }}
          />

          {confirming ? (
            <div className="recap-forget">
              <p>Oublier cette soirée pour vous deux ? C’est définitif.</p>
              <button type="button" className="recap-forget-confirm" disabled={busy} onClick={forget}>
                {busy ? "Un instant…" : "Oublier"}
              </button>
              <button type="button" onClick={() => setConfirming(false)}>Annuler</button>
            </div>
          ) : (
            <button type="button" className="recap-forget-link" onClick={() => setConfirming(true)}>
              Oublier cette soirée
            </button>
          )}
        </SettingsSheet>
      )}
    </main>
  );
}

function RecapDetail({ recap, supabase, onRated }) {
  const duration = formatDuration(recap.started_at, recap.finished_at);
  const nameOf = (playerNo) =>
    playerNo === 1 ? recap.player_1_name : recap.player_2_name;

  // photos des cartes (prises en jeu, quelle que soit la soirée) :
  // une seule lecture pour toute la liste
  const [photosByCard, setPhotosByCard] = useState({});
  const [photosVersion, setPhotosVersion] = useState(0);

  useEffect(() => {
    let active = true;

    supabase
      .from("protocol_photos")
      .select(PHOTO_COLUMNS)
      .not("card_id", "is", null)
      .order("created_at", { ascending: true })
      .then(({ data, error }) => {
        if (!active || error) {
          return;
        }

        const grouped = {};
        for (const photo of data || []) {
          (grouped[cardKey(photo.card_source, photo.card_id)] ||= []).push(photo);
        }
        setPhotosByCard(grouped);
      });

    return () => {
      active = false;
    };
  }, [supabase, photosVersion]);

  // appui long sur une carte : 🔥 👍 👎 (comme pendant la partie)
  const [rating, setRating] = useState(null);
  const pressRef = useRef({ timer: null, x: 0, y: 0 });

  const cancelPress = () => window.clearTimeout(pressRef.current.timer);

  const pressHandlers = (index) => ({
    onPointerDown: (event) => {
      cancelPress();
      pressRef.current = {
        x: event.clientX,
        y: event.clientY,
        timer: window.setTimeout(() => {
          navigator.vibrate?.(10);
          setRating((current) => (current === index ? null : index));
        }, 450),
      };
    },
    onPointerMove: (event) => {
      if (
        Math.abs(event.clientX - pressRef.current.x) > 10 ||
        Math.abs(event.clientY - pressRef.current.y) > 10
      ) {
        cancelPress();
      }
    },
    onPointerUp: cancelPress,
    onPointerCancel: cancelPress,
    onContextMenu: (event) => event.preventDefault(),
  });

  return (
    <div className="recap-detail">
      <p className="recap-detail-summary">
        {[
          duration && `${duration} de jeu`,
          `${doneCount(recap)} défis relevés sur ${recap.cards.length}`,
        ]
          .filter(Boolean)
          .join(" · ")}
      </p>

      <p className="recap-detail-hint">Appui long sur une carte pour la noter.</p>

      <ol className="recap-cards">
        {recap.cards.map((card, index) => (
          <li
            key={`${card.source}-${card.card_id}-${index}`}
            className={[
              card.outcome === "done" && "is-done",
              rating === index && "is-rating",
            ]
              .filter(Boolean)
              .join(" ") || undefined}
            {...pressHandlers(index)}
          >
            <span className="recap-card-meta">
              {TYPE_LABELS[card.type] || card.type}
              {card.intensity ? ` · ${levelForIntensity(card.intensity).title}` : ""}
              {nameOf(card.player_no) ? ` · ${nameOf(card.player_no)}` : ""}
            </span>
            <span className="recap-card-title">
              {card.title}
              {(card.fire_both || card.my_rating) && (
                <span className="recap-card-fire">
                  {card.fire_both ? " 🔥🔥" : ` ${RATING_ICONS[card.my_rating]}`}
                </span>
              )}
            </span>
            <span className="recap-card-outcome">
              {photosByCard[cardKey(card.source, card.card_id)] && (
                <CardPhotos
                  supabase={supabase}
                  cardSource={card.source}
                  cardId={card.card_id}
                  photos={photosByCard[cardKey(card.source, card.card_id)]}
                  onChanged={() => setPhotosVersion((value) => value + 1)}
                  className="recap-card-photos"
                />
              )}
              {OUTCOME_LABELS[card.outcome] || "—"}
            </span>

            {rating === index && card.card_id && (
              <CardRating
                supabase={supabase}
                cardSource={card.source}
                cardId={card.card_id}
                initialRating={card.my_rating ?? null}
                onChange={(next) => onRated(card, next)}
                className="recap-card-rating"
              />
            )}
          </li>
        ))}
      </ol>

      {recap.missions?.length > 0 && (
        <div className="recap-missions">
          <p className="recap-kicker">MISSIONS SECRÈTES</p>
          {recap.missions.map((mission) => (
            <p key={mission.player_no}>
              <strong>{nameOf(mission.player_no)}</strong> · {mission.title}
              {mission.done ? " ✓" : ""}
            </p>
          ))}
        </div>
      )}
    </div>
  );
}
