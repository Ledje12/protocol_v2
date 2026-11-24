import { useEffect, useRef } from "react";
import { createPortal } from "react-dom";

// Version affichée de l'app, et les nouveautés montrées une fois par
// téléphone à ceux qui jouaient déjà (les nouveaux ont le guide).

export const RELEASE = "1.0";

const SEEN_KEY = "protocol_release_seen";

export function hasSeenRelease() {
  try {
    return localStorage.getItem(SEEN_KEY) === RELEASE;
  } catch {
    return true;
  }
}

export function markReleaseSeen() {
  try {
    localStorage.setItem(SEEN_KEY, RELEASE);
  } catch {
    // stockage indisponible : la page reviendra, sans gravité
  }
}

const NEWS = [
  {
    title: "Les cartes scellées",
    text: "Quatre fois par partie, une carte arrive retournée, plus pimentée. Tu l’acceptes sans la lire… ou pas.",
  },
  {
    title: "L’envie",
    text: "À ton tour, choisis le thème de la prochaine carte de l’autre. Il ou elle saura que c’était ton envie.",
  },
  {
    title: "Vos cartes perso",
    text: "Une ou deux par partie : celles que vous avez écrites sortent enfin.",
  },
  {
    title: "La nuit",
    text: "La lune ☾ tamise l’écran en ambre, de petits sons accompagnent les cartes, la jauge de chaleur monte avec la soirée.",
  },
];

export default function WhatsNew({ onClose }) {
  const dialogRef = useRef(null);

  const close = () => {
    markReleaseSeen();
    onClose();
  };

  useEffect(() => {
    dialogRef.current?.focus();
    const onKey = (event) => {
      if (event.key === "Escape") {
        markReleaseSeen();
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
        className="howto-sheet whatsnew-sheet"
        role="dialog"
        aria-modal="true"
        aria-labelledby="whatsnew-title"
        tabIndex={-1}
      >
        <div className="howto-body">
          <p className="howto-kicker">NOUVELLE VERSION</p>
          <h2 id="whatsnew-title" className="whatsnew-title">
            PROTOCOL <span>{RELEASE}</span>
          </h2>

          <ul className="whatsnew-list">
            {NEWS.map((item) => (
              <li key={item.title}>
                <strong>{item.title}</strong>
                <span>{item.text}</span>
              </li>
            ))}
          </ul>
        </div>

        <footer className="howto-foot whatsnew-foot">
          <button type="button" className="howto-next" onClick={close}>
            À vous de jouer
          </button>
        </footer>
      </section>
    </div>,
    document.body
  );
}
