import { useEffect, useState } from "react";

import CameraIcon from "./CameraIcon.jsx";
import { SettingsSheet } from "./SettingsParts.jsx";
import { fillNames } from "./personalise.js";

/* Défis photo dans la bibliothèque : catégorie à part (ils ne
   sortent que dans le jeu « À distance »), à lire et à envoyer
   à l'autre en message. */

export const PHOTO_CATEGORY = "Défis photo";


export function usePhotoChallenges(supabase) {
  const [challenges, setChallenges] = useState(null);

  useEffect(() => {
    let active = true;

    supabase.rpc("get_photo_challenges").then(({ data, error }) => {
      // sans la migration : pas de catégorie, rien d'autre ne change
      if (active) {
        setChallenges(error ? [] : data || []);
      }
    });

    return () => {
      active = false;
    };
  }, [supabase]);

  return challenges;
}

// 4 niveaux, comme les points d'intensité des cartes
function Leds({ level }) {
  return (
    <div className="library-card-intensity" aria-label={`Niveau ${level} sur 4`}>
      {[0, 1, 2, 3].map((index) => (
        <span key={index} className={index < level ? "is-active" : ""} />
      ))}
    </div>
  );
}

export function PhotoCategoryButton({ count, onOpen }) {
  return (
    <button type="button" className="library-category" onClick={onOpen}>
      <span className="library-category-name">{PHOTO_CATEGORY}</span>
      <span className="library-category-count">{count}</span>
      <span className="library-category-arrow" aria-hidden="true">→</span>
    </button>
  );
}

export function PhotoChallengeList({ supabase, challenges, partnerName, partnerSex, myName }) {
  const [open, setOpen] = useState(null);
  const [sending, setSending] = useState(false);
  const [feedback, setFeedback] = useState("");

  // défis préparés pour l'autre : c'est lui ou elle qui le relève,
  // et « {{partner}} », c'est toi
  const text = (value) => fillNames(value, { partner: myName });

  const canSend = (challenge) =>
    !challenge.target_sex || !partnerSex || challenge.target_sex === partnerSex;

  const send = async () => {
    setSending(true);
    setFeedback("");

    try {
      const { data, error } = await supabase.functions.invoke("send-message", {
        body: {
          body: `Défi photo pour toi · ${text(open.title)}\n${text(open.prompt)}`,
        },
      });

      if (error || !data?.success) {
        throw error || new Error(data?.error || "send-message");
      }

      setFeedback(`Défi envoyé. ${partnerName} le retrouve dans vos messages.`);
    } catch (err) {
      console.error("PHOTO CHALLENGE SEND ERROR:", err);
      setFeedback("Le défi n’est pas parti. Réessaie dans un instant.");
    } finally {
      setSending(false);
    }
  };

  return (
    <>
      <div className="library-results-meta">
        <span className="library-count">
          {challenges.length} défi{challenges.length > 1 ? "s" : ""}
        </span>
        <span className="library-results-line" aria-hidden="true" />
      </div>

      {/* une seule liste, de A à Z ; le niveau sur chaque fiche */}
      <div className="library-list">
        {[...challenges]
          .sort((x, y) =>
            text(x.title).localeCompare(text(y.title), "fr", { sensitivity: "base" })
          )
          .map((challenge) => (
            <button
              key={challenge.id}
              type="button"
              className={`library-card library-card-photo library-card-intensity-${challenge.intensity}`}
              onClick={() => {
                setFeedback("");
                setOpen(challenge);
              }}
            >
              <div className="library-card-accent" />

              <div className="library-card-header">
                <div className="library-card-type-group">
                  <span className="library-card-type">PHOTO</span>
                </div>

                {!canSend(challenge) && (
                  <span className="library-card-for-me">Pour toi</span>
                )}
              </div>

              <h2 className="library-card-title">{text(challenge.title)}</h2>
              <p className="library-card-prompt">{text(challenge.prompt)}</p>

              <div className="library-card-footer">
                <Leds level={challenge.intensity} />
                <span className="library-card-open">→</span>
              </div>
            </button>
          ))}
      </div>

      {open && (
        <SettingsSheet
          eyebrow="DÉFI PHOTO"
          title={text(open.title)}
          onClose={() => setOpen(null)}
        >
          <div className="photo-challenge-sheet">
            <Leds level={open.intensity} />
            <p className="photo-challenge-prompt">{text(open.prompt)}</p>

            {canSend(open) ? (
              <button type="button" className="primary" disabled={sending} onClick={send}>
                <span>{sending ? "Envoi…" : `Envoyer ce défi à ${partnerName}`}</span>
                <CameraIcon size={20} />
              </button>
            ) : (
              <p className="photo-challenge-note">
                Ce défi est écrit pour {open.target_sex === "male" ? "lui" : "elle"} :
                il ne s’envoie pas à {partnerName}.
              </p>
            )}

            {feedback && <p className="photo-challenge-note">{feedback}</p>}
          </div>
        </SettingsSheet>
      )}
    </>
  );
}
