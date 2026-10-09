import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";

import { markHowToPlaySeen } from "./howto.js";

// « Comment on joue » : quatre étapes, montrées une fois au
// premier lancement (après l'association du duo), puis à la
// demande depuis les réglages.

const STEPS = [
  {
    kicker: "LE PRINCIPE",
    title: "Un jeu, deux téléphones.",
    body: (
      <>
        <p>
          L’un crée la partie, l’autre la rejoint avec son code.
        </p>
        <p>
          Puis chacun dit, en secret, ce qu’il veut ce soir.{" "}
          <em>La partie suit le plus prudent des deux</em> : personne
          ne sait qui a choisi quoi.
        </p>
      </>
    ),
  },
  {
    kicker: "LES CARTES",
    title: "Quatre façons de jouer.",
    body: (
      <ul className="howto-types">
        <li className="is-truth">
          <strong>Vérité</strong>
          <span>On répond, sans détour.</span>
        </li>
        <li className="is-action">
          <strong>Action</strong>
          <span>On le fait, ici et maintenant.</span>
        </li>
        <li className="is-duel">
          <strong>Duel</strong>
          <span>Un seul gagne. Celui dont c’est le tour désigne le gagnant.</span>
        </li>
        <li className="is-scene">
          <strong>Scène</strong>
          <span>En plusieurs temps. Parfois, chacun lit un texte que l’autre ne voit pas.</span>
        </li>
      </ul>
    ),
  },
  {
    kicker: "LES JOKERS",
    title: "Pas de score. Des jokers.",
    body: (
      <>
        <p>
          Personne ne compte les points : on ne joue pas l’un
          contre l’autre. Passer ne coûte rien.
        </p>
        <p>
          Chacun commence avec deux jokers :{" "}
          <strong>imposer le type</strong> de la prochaine carte,
          et <strong>prendre la main</strong> pour jouer deux fois
          de suite. <em>Un duel gagné recharge un joker utilisé.</em>
        </p>
      </>
    ),
  },
  {
    kicker: "LA MONTÉE",
    title: "Ça monte, doucement.",
    body: (
      <>
        <p className="howto-phases">
          Mise en tension <span aria-hidden="true">·</span> Montée{" "}
          <span aria-hidden="true">·</span> Intensité{" "}
          <span aria-hidden="true">·</span> Finale
        </p>
        <p>
          Une vingtaine de cartes, de plus en plus intenses, sans
          jamais dépasser ce que vous avez choisi.
        </p>
        <p>
          <em>Passer, changer de carte ou STOP : à tout moment, sans
          vous justifier.</em> STOP met la partie en pause pour vous
          deux.
        </p>
      </>
    ),
  },
];

export default function HowToPlay({ onClose }) {
  const [index, setIndex] = useState(0);
  const dialogRef = useRef(null);
  const step = STEPS[index];
  const isLast = index === STEPS.length - 1;

  const close = () => {
    markHowToPlaySeen();
    onClose();
  };

  useEffect(() => {
    dialogRef.current?.focus();
  }, [index]);

  useEffect(() => {
    const onKey = (event) => {
      if (event.key === "Escape") {
        markHowToPlaySeen();
        onClose();
      }
    };

    document.addEventListener("keydown", onKey);

    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);

  return createPortal(
    <div className="howto-overlay">
      <section
        ref={dialogRef}
        className="howto-sheet"
        role="dialog"
        aria-modal="true"
        aria-labelledby="howto-title"
        tabIndex={-1}
      >
        <header className="howto-head">
          <span className="howto-step">
            {index + 1} / {STEPS.length}
          </span>

          <button type="button" className="howto-skip" onClick={close}>
            {isLast ? "Fermer" : "Passer"}
          </button>
        </header>

        <div className="howto-body" key={index}>
          <span className="protocol-diamond" aria-hidden="true" />
          <p className="howto-kicker">{step.kicker}</p>
          <h2 id="howto-title">{step.title}</h2>
          <div className="howto-text">{step.body}</div>
        </div>

        <footer className="howto-foot">
          <div className="howto-dots" aria-hidden="true">
            {STEPS.map((item, dot) => (
              <span
                key={item.kicker}
                className={dot === index ? "is-current" : undefined}
              />
            ))}
          </div>

          <div className="howto-actions">
            {index > 0 && (
              <button
                type="button"
                className="howto-back"
                onClick={() => setIndex(index - 1)}
              >
                Retour
              </button>
            )}

            <button
              type="button"
              className="howto-next"
              onClick={() => (isLast ? close() : setIndex(index + 1))}
            >
              {isLast ? "À vous de jouer" : "Suivant"}
            </button>
          </div>
        </footer>
      </section>
    </div>,
    document.body
  );
}
