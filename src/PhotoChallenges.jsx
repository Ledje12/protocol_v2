import { useEffect, useState } from "react";

import CameraIcon from "./CameraIcon.jsx";
import { SettingsSheet } from "./SettingsParts.jsx";

/* Défis photo dans la bibliothèque : catégorie à part (ils ne
   sortent que dans le jeu « À distance »), à lire et à envoyer
   à l'autre en message. */

export const PHOTO_CATEGORY = "Défis photo";

const LEVELS = ["", "Suggestif", "Sensuel", "Osé", "Explicite"];
const TARGETS = { male: "Pour lui", female: "Pour elle" };

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

export function PhotoBadge() {
  return (
    <span className="photo-badge">
      <CameraIcon size={13} strokeWidth={1.8} />
      À distance
    </span>
  );
}

export function PhotoCategoryButton({ count, onOpen }) {
  return (
    <button type="button" className="library-category library-category-photo" onClick={onOpen}>
      <span className="library-category-name">
        {PHOTO_CATEGORY}
        <PhotoBadge />
      </span>
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
  const text = (value) => (value || "").replaceAll("{{partner}}", myName);

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
      <p className="photo-challenges-intro">
        Ils sortent dans le jeu « À distance », de Suggestif à Explicite.
        Tu peux aussi en envoyer un à {partnerName}, à tout moment.
      </p>

      {[1, 2, 3, 4].map((level) => {
        const list = challenges.filter((challenge) => challenge.intensity === level);

        if (list.length === 0) {
          return null;
        }

        return (
          <section key={level} className="photo-challenges-level">
            <h3>
              Niveau {level} · {LEVELS[level]} <span>{list.length}</span>
            </h3>

            <div className="library-list">
              {list.map((challenge) => (
                <button
                  key={challenge.id}
                  type="button"
                  className={`library-card photo-challenge-card library-card-intensity-${level}`}
                  onClick={() => {
                    setFeedback("");
                    setOpen(challenge);
                  }}
                >
                  <div className="library-card-accent" />
                  <div className="library-card-header">
                    <PhotoBadge />
                    <span className="photo-challenge-target">
                      {TARGETS[challenge.target_sex] || "Pour tous"}
                    </span>
                  </div>
                  <h3 className="library-card-title">{text(challenge.title)}</h3>
                  <p className="library-card-prompt">{text(challenge.prompt)}</p>
                </button>
              ))}
            </div>
          </section>
        );
      })}

      {open && (
        <SettingsSheet
          eyebrow={`DÉFI PHOTO · NIVEAU ${open.intensity} · ${LEVELS[open.intensity].toUpperCase()}`}
          title={text(open.title)}
          onClose={() => setOpen(null)}
        >
          <div className="photo-challenge-sheet">
            <PhotoBadge />
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
