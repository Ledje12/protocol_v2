import { useEffect, useMemo, useState } from "react";
import "./opening.css";
import { createPortal } from "react-dom";

import { playSound } from "./sounds.js";
import { RELEASE, markReleaseSeen } from "./release.js";

/* Ouverture de version : une séquence plein écran, une seule fois par
   téléphone, pour ceux qui jouaient déjà (les nouveaux ont le guide).
   L'allumage du numéro, puis chaque nouveauté montrée en mouvement. */

const FEATURES = 4;

export default function Opening({ partnerName, onClose }) {
  // l'enseigne d'ouverture vient d'allumer le « 2.0 » : on commence
  // directement par les nouveautés
  const [scene, setScene] = useState(1);

  // braises de l'ouverture : positions tirées une fois
  const embers = useMemo(
    () =>
      Array.from({ length: 12 }, (_, i) => ({
        left: `${8 + ((i * 37) % 84)}%`,
        duration: `${7 + (i % 5)}s`,
        delay: `${2 + ((i * 1.3) % 6)}s`,
      })),
    []
  );

  const close = () => {
    markReleaseSeen();
    onClose();
  };

  useEffect(() => {
    const onKey = (event) => {
      if (event.key === "Escape") close();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  });

  const other = partnerName || "l’autre";

  return createPortal(
    <div className="opening" role="dialog" aria-modal="true" aria-label={`PROTOCOL ${RELEASE}`}>
      {scene === 0 && (
        <section className="opening-scene opening-intro is-lit">
          {embers.map((e, i) => (
            <span
              key={i}
              className="opening-ember"
              style={{ left: e.left, animationDuration: e.duration, animationDelay: e.delay }}
              aria-hidden="true"
            />
          ))}
          <div className="opening-line" aria-hidden="true" />
          <p className="opening-word" aria-hidden="true">
            {[..."PROTOCOL"].map((letter, i) => (
              <span key={i} style={{ animationDelay: `${1.1 + i * 0.09}s` }}>
                {letter}
              </span>
            ))}
          </p>
          <p className="opening-number">{RELEASE}</p>
          <p className="opening-tag">Plus loin, ensemble.</p>
          <button
            type="button"
            className="opening-cta"
            onClick={() => {
              playSound("win");
              setScene(1);
            }}
          >
            Découvrir les nouveautés
          </button>
          <button type="button" className="opening-skip" onClick={close}>
            Passer
          </button>
        </section>
      )}

      {scene >= 1 && scene <= FEATURES && (
        <section className="opening-scene opening-feature" key={scene}>
          <button type="button" className="opening-skip" onClick={close}>
            Passer
          </button>

          <span className="opening-count">Nouveau · {scene} / {FEATURES}</span>

          {scene === 1 && (
            <>
              <h2>Les cartes scellées.</h2>
              <p className="opening-copy">
                Quatre fois par partie, une carte arrive retournée, plus
                pimentée. Tu l’acceptes sans la lire… ou pas.
              </p>
              <div className="opening-stage">
                <div className="opening-flip">
                  <div className="opening-flip-in">
                    <div className="opening-face opening-back">
                      <div>
                        <span className="opening-seal" aria-hidden="true">✦</span>
                        <b>Carte scellée</b>
                      </div>
                    </div>
                    <div className="opening-face opening-front opening-card">
                      <span className="opening-chip">Scellée ✦</span>
                      <h3>Ce que tu n’as pas vu venir</h3>
                      <p>Le texte ne se découvre qu’une fois la carte acceptée.</p>
                    </div>
                  </div>
                </div>
              </div>
            </>
          )}

          {scene === 2 && (
            <>
              <h2>L’envie.</h2>
              <p className="opening-copy">
                À ton tour, choisis le thème de la prochaine carte de {other}.
                Demander, sans avoir à le dire.
              </p>
              <div className="opening-stage">
                <div>
                  <div className="opening-cats" aria-hidden="true">
                    <span>Bouche</span>
                    <span>Jouets</span>
                    <span className="is-picked">Anal</span>
                    <span>Ailleurs</span>
                    <span>Liens</span>
                    <span>Scénarios</span>
                  </div>
                  <div className="opening-card opening-desire">
                    <p className="opening-ribbon">
                      ✦ Ton envie : <strong>Anal</strong>
                    </p>
                    <h3>La carte qui suit</h3>
                    <p>Tirée dans le thème choisi, et {other} le sait.</p>
                  </div>
                </div>
              </div>
            </>
          )}

          {scene === 3 && (
            <>
              <h2>Vos cartes, enfin en jeu.</h2>
              <p className="opening-copy">
                Celles que vous avez écrites sortent une ou deux fois par
                partie, au bon moment.
              </p>
              <div className="opening-stage">
                <div className="opening-deck">
                  <div className="opening-card opening-deck-1" />
                  <div className="opening-card opening-deck-2" />
                  <div className="opening-card opening-mine">
                    <span className="opening-by">Écrite par vous</span>
                    <h3>Votre carte</h3>
                    <p>Glissée dans la partie, entre deux cartes du jeu.</p>
                  </div>
                </div>
              </div>
            </>
          )}

          {scene === 4 && (
            <>
              <h2>Pour la nuit.</h2>
              <p className="opening-copy">
                La lune tamise l’écran en ambre, de petits sons accompagnent
                les cartes, la jauge de chaleur monte avec la soirée.
              </p>
              <div className="opening-stage">
                <div className="opening-night">
                  <div className="opening-gauge" aria-hidden="true"><i /></div>
                  <div className="opening-mini">
                    <span className="opening-moon" aria-hidden="true">☾</span>
                    <h4>Lumière tamisée</h4>
                    <p>Plus de blanc qui éblouit.</p>
                    <span className="opening-amber" aria-hidden="true" />
                  </div>
                  <div className="opening-wave" aria-hidden="true">
                    {[0, 1, 2, 3, 4].map((i) => (
                      <b key={i} style={{ animationDelay: `${i * 0.15}s` }} />
                    ))}
                  </div>
                </div>
              </div>
            </>
          )}

          <div className="opening-dots" aria-hidden="true">
            {Array.from({ length: FEATURES }, (_, i) => (
              <i key={i} className={i + 1 === scene ? "is-current" : undefined} />
            ))}
          </div>

          <button type="button" className="opening-next" onClick={() => setScene(scene + 1)}>
            Suivant
          </button>
        </section>
      )}

      {scene > FEATURES && (
        <section className="opening-scene opening-outro">
          <p className="opening-number opening-number-small">{RELEASE}</p>
          <h2>À vous de jouer.</h2>
          <p className="opening-copy">Même jeu. Beaucoup plus loin.</p>
          <button type="button" className="opening-cta is-visible" onClick={close}>
            Entrer
          </button>
        </section>
      )}
    </div>,
    document.body
  );
}
