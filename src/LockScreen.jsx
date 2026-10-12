import { useState } from "react";

import BrandMark from "./BrandMark.jsx";
import { disableAppLock, markAppUnlocked, unlockApp } from "./appLock.js";

/* Écran de verrouillage : Face ID (ou empreinte) avant d'entrer.
   L'iPhone ne lance Face ID directement que sur un toucher (sinon
   il intercale une fenêtre « Utiliser la clé d'accès ») : tout
   l'écran est donc un bouton, un seul toucher suffit. */

export default function LockScreen({ userId, supabase, onUnlocked }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const unlock = async () => {
    if (busy) {
      return;
    }

    setBusy(true);
    setError("");

    try {
      if (await unlockApp()) {
        markAppUnlocked(userId);
        onUnlocked();
        return;
      }
    } catch (err) {
      // annulé ou refusé : on reste verrouillé, sans alarmer
      if (err?.name !== "NotAllowedError" && err?.name !== "AbortError") {
        console.error("APP UNLOCK ERROR:", err);
      }
    }

    setError("Pas reconnu. Réessaie.");
    setBusy(false);
  };

  // Face ID perdu (nouveau visage, autre téléphone) : on se
  // reconnecte avec son mot de passe, le verrou est à réactiver
  const signOut = async (event) => {
    event.stopPropagation();
    disableAppLock();
    await supabase.auth.signOut();
    window.location.replace("/");
  };

  return (
    <main className="protocol-auth-page protocol-lock-page" onClick={unlock}>
      <div className="protocol-auth-glow" />

      <section className="protocol-lock">
        <BrandMark size="lg" />

        <span className="protocol-lock-mark" aria-hidden="true">
          <svg viewBox="0 0 24 24" width="30" height="30" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
            <rect x="5" y="11" width="14" height="10" rx="2.5" />
            <path d="M8 11V8a4 4 0 0 1 8 0v3" />
          </svg>
        </span>

        <h1>Verrouillé.</h1>
        <p>Touche l’écran pour entrer.</p>

        <button
          type="button"
          className="primary protocol-lock-button"
          disabled={busy}
        >
          <span>{busy ? "Un instant…" : "Déverrouiller"}</span>
          <span aria-hidden="true">→</span>
        </button>

        {error && <p className="protocol-lock-error">{error}</p>}

        <button type="button" className="protocol-lock-signout" onClick={signOut}>
          Se déconnecter
        </button>
      </section>
    </main>
  );
}
