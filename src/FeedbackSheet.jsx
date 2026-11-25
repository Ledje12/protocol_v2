import { useState } from "react";

import { SettingsSheet } from "./SettingsParts.jsx";
import { RELEASE } from "./release.js";

/* « Une idée, un souci ? » : un message écrit dans l'app, sans passer
   par le mail. Il arrive dans la table protocol_feedback, avec le
   prénom et la version ; depuis la fin de partie, avec la partie. */

const KINDS = [
  { value: "idea", label: "Une idée" },
  { value: "issue", label: "Un souci" },
  { value: "card", label: "Une carte" },
];

const PLACEHOLDERS = {
  idea: "Ce qui vous manque, ce qui vous ferait plaisir…",
  issue: "Ce qui s’est passé, sur quel écran…",
  card: "La carte que vous aimeriez trouver, ou celle qui coince…",
};

const MAX = 2000;

export default function FeedbackSheet({ supabase, gameId = null, onClose }) {
  const [kind, setKind] = useState("idea");
  const [body, setBody] = useState("");
  const [sending, setSending] = useState(false);
  const [sent, setSent] = useState(false);
  const [error, setError] = useState("");

  const send = async () => {
    const text = body.trim();
    if (!text || sending) return;

    setSending(true);
    setError("");

    const { error: rpcError } = await supabase.rpc("submit_protocol_feedback", {
      p_kind: kind,
      p_body: text,
      p_game_id: gameId,
      p_app_version: RELEASE,
    });

    setSending(false);

    if (rpcError) {
      setError(
        /réessaie demain/.test(rpcError.message || "")
          ? rpcError.message
          : "Le message n’est pas parti. Réessaie dans un instant."
      );
      return;
    }

    setSent(true);
  };

  return (
    <SettingsSheet
      eyebrow="UNE IDÉE, UN SOUCI ?"
      title={sent ? "Merci." : "Dis-moi tout."}
      onClose={onClose}
    >
      {sent ? (
        <>
          <p className="settings-card-copy">
            C’est bien arrivé, et ce sera lu, promis. Si ça peut
            rendre PROTOCOL meilleur, tu le verras dans une prochaine version.
          </p>

          <button type="button" className="settings-primary-action" onClick={onClose}>
            <span>Fermer</span>
            <span className="settings-action-arrow">→</span>
          </button>
        </>
      ) : (
        <>
          <p className="settings-card-copy">
            Lu par celui qui fabrique PROTOCOL. Une carte qui manque, un
            bug, une envie : tout compte.
          </p>

          <div className="feedback-kinds" role="radiogroup" aria-label="Type de message">
            {KINDS.map((option) => (
              <button
                key={option.value}
                type="button"
                role="radio"
                aria-checked={kind === option.value}
                className={kind === option.value ? "is-picked" : undefined}
                onClick={() => setKind(option.value)}
              >
                {option.label}
              </button>
            ))}
          </div>

          <label className="feedback-field">
            <textarea
              aria-label="Ton message"
              value={body}
              onChange={(event) => setBody(event.target.value.slice(0, MAX))}
              placeholder={PLACEHOLDERS[kind]}
              rows={5}
            />
          </label>

          <p className="feedback-note">
            Envoyé avec ton prénom et la version de l’app
            {gameId ? ", et cette partie" : ""}. Rien d’autre.
          </p>

          {error && <p className="settings-feedback">{error}</p>}

          <button
            type="button"
            className="settings-primary-action"
            onClick={send}
            disabled={sending || !body.trim()}
          >
            <span>{sending ? "Envoi…" : "Envoyer"}</span>
            <span className="settings-action-arrow">→</span>
          </button>
        </>
      )}
    </SettingsSheet>
  );
}
