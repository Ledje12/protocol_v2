import { useState } from "react";

import { useAdvent } from "./AdventTile.jsx";
import { humanError } from "./networkError.js";
import { fillNames } from "./personalise.js";
import { BackIcon } from "./ScreenHeader.jsx";
import { SettingsSheet } from "./SettingsParts.jsx";

/* Calendrier de l'Avent : un défi par jour, du 1er au 24 décembre.
   Les cases se dévoilent côté serveur (get_protocol_advent) : avant
   son jour, le texte d'une case n'arrive jamais jusqu'au téléphone.
   Un admin peut tout lire en aperçu, sans rien enregistrer. */

// cases mélangées, comme sur un vrai calendrier
const DOOR_ORDER = [
  7, 19, 2, 13, 22, 10, 4, 16, 24, 1, 12, 20,
  6, 17, 9, 3, 21, 14, 11, 23, 5, 18, 8, 15,
];

export default function AdventScreen({ supabase, profile, couple, onBack }) {
  const [advent, reload, loadError] = useAdvent(supabase);
  const [open, setOpen] = useState(null);
  const [hint, setHint] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const partner = couple?.partner;

  // « {{partner}} » = l'autre, « {{me}} » = moi, avec les pronoms
  const personalise = (text) =>
    fillNames(
      text,
      { partner: partner?.display_name || "l’autre", me: profile?.display_name || "toi" },
      { partner: partner?.sex, me: profile?.sex }
    );

  const doors = advent?.days || [];
  const byDay = Object.fromEntries(doors.map((door) => [door.day, door]));

  const openDoor = async (door) => {
    setError("");

    if (!door.unlocked) {
      setHint(`Patience : la case ${door.day} s’ouvre le ${door.day} décembre.`);
      return;
    }

    setHint("");
    setOpen(door);

    // l'aperçu ne fait que lire
    if (!door.opened && !advent.preview) {
      const { error: rpcError } = await supabase.rpc("set_protocol_advent", {
        p_day: door.day,
      });

      if (!rpcError) {
        reload();
      }
    }
  };

  const toggleDone = async () => {
    setBusy(true);
    setError("");

    const { error: rpcError } = await supabase.rpc("set_protocol_advent", {
      p_day: open.day,
      p_done: !byDay[open.day]?.done,
    });

    setBusy(false);

    if (rpcError) {
      setError(humanError(rpcError, "Impossible d’enregistrer. Réessaie dans un instant."));
      return;
    }

    await reload();
  };

  const current = open ? byDay[open.day] || open : null;
  const doneCount = doors.filter((door) => door.done).length;

  return (
    <main className="app protocol-settings-page advent-page">
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
          <span className="protocol-settings-subtitle">Décembre à deux</span>
        </div>
      </header>

      <section className="protocol-settings advent">
        <section className="protocol-settings-intro">
          <p className="kicker">CALENDRIER DE L’AVENT</p>
          <h1>
            Un défi
            <br />
            par jour.
          </h1>
          <p className="intro">
            Une case s’ouvre chaque matin jusqu’au 24. Pas de triche : celle
            de demain reste scellée jusqu’à demain.
          </p>
        </section>

        {advent?.preview && (
          <p className="advent-preview">
            Aperçu : toutes les cases sont lisibles pour toi seul, et rien
            n’est enregistré. {partner?.display_name || "L’autre"} ne voit
            rien avant le 1er décembre.
          </p>
        )}

        {!advent && !loadError && <p className="recaps-status">Chargement…</p>}
        {loadError && <p className="recaps-status is-error">{loadError}</p>}

        {advent && doors.length === 0 && (
          <p className="recaps-status">Les défis arrivent bientôt.</p>
        )}

        {doors.length > 0 && (
          <>
            {advent.today >= 1 && (
              <p className="advent-progress">
                {doneCount === 0
                  ? "Aucun défi relevé pour l’instant."
                  : `${doneCount} défi${doneCount > 1 ? "s" : ""} relevé${doneCount > 1 ? "s" : ""} sur 24.`}
              </p>
            )}

            <div className="advent-grid">
              {DOOR_ORDER.filter((day) => byDay[day]).map((day) => {
                const door = byDay[day];
                const isToday = day === advent.today;

                return (
                  <button
                    key={day}
                    type="button"
                    className={[
                      "advent-door",
                      door.unlocked ? "is-unlocked" : "is-locked",
                      door.opened ? "is-opened" : "",
                      door.done ? "is-done" : "",
                      isToday ? "is-today" : "",
                    ]
                      .filter(Boolean)
                      .join(" ")}
                    onClick={() => openDoor(door)}
                    aria-label={`Case ${day}${door.unlocked ? "" : ", scellée"}${door.done ? ", défi relevé" : ""}`}
                  >
                    <span className="advent-door-number">{day}</span>
                    {door.done && <span className="advent-door-mark" aria-hidden="true">✓</span>}
                  </button>
                );
              })}
            </div>

            {hint && <p className="advent-hint">{hint}</p>}
          </>
        )}
      </section>

      {current && (
        <SettingsSheet
          eyebrow={`${current.day} DÉCEMBRE · DÉFI POUR VOUS DEUX`}
          title={personalise(current.title)}
          onClose={() => setOpen(null)}
        >
          <p className="advent-prompt">{personalise(current.prompt)}</p>

          {!advent.preview && (
            <button
              type="button"
              className={current.done ? "advent-done is-done" : "advent-done"}
              disabled={busy}
              onClick={toggleDone}
            >
              {current.done ? "✓ Défi relevé" : "Défi relevé"}
            </button>
          )}

          {error && <p className="settings-feedback">{error}</p>}
        </SettingsSheet>
      )}
    </main>
  );
}
