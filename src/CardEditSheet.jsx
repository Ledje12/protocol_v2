import { useState } from "react";

import { SettingsSheet } from "./SettingsParts.jsx";
import { levelForIntensity } from "./gameConstants.js";

/* Modifier une carte (bibliothèque, comptes autorisés) : la
   consigne et l'intensité, écrites tout de suite dans la base.
   L'intensité reste précise (1 à 5, utile à la montée en jeu) ;
   chaque valeur montre le niveau affiché : 1-3 Taquin, 4 Coquin,
   5 Indécent. */

export default function CardEditSheet({
  supabase,
  card,
  onSaved,
  onClose,
}) {
  const [prompt, setPrompt] = useState(card.prompt || "");
  const [intensity, setIntensity] = useState(card.intensity || 1);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const unchanged =
    prompt.trim() === (card.prompt || "").trim() &&
    Number(intensity) === Number(card.intensity);

  const save = async () => {
    setBusy(true);
    setError("");

    const { error: saveError } = await supabase.rpc("update_protocol_card", {
      p_card_id: card.id,
      p_prompt: prompt,
      p_intensity: intensity,
    });

    setBusy(false);

    if (saveError) {
      console.error("CARD EDIT ERROR:", saveError);
      setError(
        /not allowed/i.test(saveError.message || "")
          ? "Ce compte ne peut pas modifier les cartes."
          : "La modification n’est pas passée. Réessaie."
      );
      return;
    }

    onSaved();
  };

  return (
    <SettingsSheet eyebrow="MODIFIER LA CARTE" title={card.title} onClose={onClose}>
      <label className="card-edit-label" htmlFor="card-edit-prompt">
        Consigne
      </label>
      <textarea
        id="card-edit-prompt"
        className="card-edit-prompt"
        value={prompt}
        onChange={(event) => setPrompt(event.target.value)}
        rows={7}
        maxLength={2000}
      />
      <p className="card-edit-hint">
        Les mots entre {"{{ }}"} sont remplacés par vos prénoms : garde-les
        tels quels.
      </p>

      <p className="card-edit-label">Intensité</p>
      <div className="card-edit-intensity" role="radiogroup" aria-label="Intensité">
        {[1, 2, 3, 4, 5].map((level) => (
          <button
            key={level}
            type="button"
            role="radio"
            aria-checked={intensity === level}
            className={intensity === level ? "is-active" : undefined}
            onClick={() => setIntensity(level)}
          >
            <strong>{level}</strong>
            <span>{levelForIntensity(level).title}</span>
          </button>
        ))}
      </div>

      <button
        type="button"
        className="settings-primary-action"
        disabled={busy || unchanged || !prompt.trim()}
        onClick={save}
      >
        <span>{busy ? "Enregistrement…" : "Enregistrer"}</span>
        <span className="settings-action-arrow">→</span>
      </button>

      {error && <p className="settings-feedback">{error}</p>}
    </SettingsSheet>
  );
}
