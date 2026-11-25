import { useEffect, useState } from "react";
import { createPortal } from "react-dom";

import { RELEASE } from "./release.js";
import { playSound } from "./sounds.js";
import "./opening.css";

/* Fin de partie : l'enseigne d'ouverture s'éteint tube par tube,
   « Le club ferme ses portes. », puis le récap. Une fois par partie
   et par téléphone, après l'écran des enveloppes s'il y en a. */

const seenKey = (gameId) => `protocol_closing_${gameId}`;

export default function ClubClosing({ gameId }) {
  const [phase, setPhase] = useState(() => {
    try {
      return localStorage.getItem(seenKey(gameId)) ? "done" : "waiting";
    } catch {
      return "done";
    }
  });

  // on attend que l'écran des enveloppes soit refermé (ou absent)
  useEffect(() => {
    if (phase !== "waiting") return undefined;
    let calm = 0;
    const timer = window.setInterval(() => {
      calm = document.querySelector(".envelope-reveal") ? 0 : calm + 1;
      if (calm >= 3) {
        window.clearInterval(timer);
        setPhase("closing");
        playSound("close");
      }
    }, 300);
    return () => window.clearInterval(timer);
  }, [phase]);

  useEffect(() => {
    if (phase !== "closing") return undefined;
    try {
      localStorage.setItem(seenKey(gameId), "1");
    } catch {
      // sans stockage : la fermeture se rejouera, sans gravité
    }
    const timer = window.setTimeout(() => setPhase("leaving"), 6200);
    return () => window.clearTimeout(timer);
  }, [phase, gameId]);

  useEffect(() => {
    if (phase !== "leaving") return undefined;
    const timer = window.setTimeout(() => setPhase("done"), 600);
    return () => window.clearTimeout(timer);
  }, [phase]);

  if (phase === "waiting" || phase === "done") {
    return null;
  }

  return createPortal(
    <div
      className={phase === "leaving" ? "club-closing is-leaving" : "club-closing"}
      role="dialog"
      aria-modal="true"
      aria-label="Le club ferme ses portes"
      onClick={() => setPhase("leaving")}
    >
      <p className="club-word" aria-hidden="true">PROTOCOL</p>
      <p className="club-number" aria-hidden="true">{RELEASE}</p>
      <p className="club-tag" aria-hidden="true">Club privé · Adultes consentants</p>
      <p className="club-bye">
        Le club ferme ses portes.
        <small>À très vite.</small>
      </p>
    </div>,
    document.body
  );
}
