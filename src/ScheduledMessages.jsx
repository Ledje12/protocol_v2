import { useCallback, useEffect, useState } from "react";

import { SettingsSheet } from "./SettingsParts.jsx";

/* Messages programmés : écrire maintenant, envoyer à l'heure choisie.
   Le serveur les dépose dans la conversation à l'heure dite (avec la
   notification habituelle) ; d'ici là, seul l'expéditeur les voit. */

const at = (date, hours) => {
  const next = new Date(date);
  next.setHours(hours, 0, 0, 0);
  return next;
};

const tomorrow = (date) => {
  const next = new Date(date);
  next.setDate(next.getDate() + 1);
  return next;
};

// « ce soir, 21:00 », « demain, 08:00 », « jeudi, 18:00 »
function formatSendAt(value) {
  const date = new Date(value);
  const now = new Date();
  const time = date.toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit" });

  if (date.toDateString() === now.toDateString()) {
    return `${date.getHours() >= 17 ? "ce soir" : "aujourd’hui"}, ${time}`;
  }

  if (date.toDateString() === tomorrow(now).toDateString()) {
    return `demain, ${time}`;
  }

  return `${date.toLocaleDateString("fr-FR", { weekday: "long" })}, ${time}`;
}

// valeur d'un champ datetime-local (heure locale)
const toLocalInput = (date) => {
  const pad = (n) => String(n).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
};

// null tant que c'est inconnu, ou si la base n'a pas la fonction :
// le bouton horloge reste alors caché
export function useScheduledMessages(supabase) {
  const [items, setItems] = useState(null);

  const reload = useCallback(async () => {
    const { data, error } = await supabase.rpc("get_my_scheduled_messages");

    if (!error) {
      setItems(data || []);
    }
  }, [supabase]);

  useEffect(() => {
    reload();

    // un message envoyé quitte la liste
    const timer = window.setInterval(() => {
      if (document.visibilityState === "visible") {
        reload();
      }
    }, 60000);

    return () => window.clearInterval(timer);
  }, [reload]);

  return [items, reload];
}

export function ScheduleSheet({ supabase, body, partnerName, onScheduled, onClose }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const now = new Date();
  const [custom, setCustom] = useState(toLocalInput(new Date(now.getTime() + 2 * 3600e3)));

  const options = [
    { label: "Dans 1 heure", date: new Date(now.getTime() + 3600e3) },
    now.getHours() < 17 && { label: "Ce soir, 18 h", date: at(now, 18) },
    now.getHours() < 20 && { label: "Ce soir, 21 h", date: at(now, 21) },
    { label: "Demain, 8 h", date: at(tomorrow(now), 8) },
    { label: "Demain, 18 h", date: at(tomorrow(now), 18) },
  ].filter(Boolean);

  const schedule = async (date) => {
    setBusy(true);
    setError("");

    const { error: rpcError } = await supabase.rpc("schedule_protocol_message", {
      p_body: body,
      p_send_at: date.toISOString(),
    });

    setBusy(false);

    if (rpcError) {
      console.error("SCHEDULE MESSAGE ERROR:", rpcError);
      setError(
        /send time/i.test(rpcError.message || "")
          ? "Choisis un moment dans les 7 prochains jours."
          : "Le message n’a pas pu être programmé. Réessaie."
      );
      return;
    }

    onScheduled();
  };

  return (
    <SettingsSheet eyebrow="PROGRAMMER" title="Quand l’envoyer ?" onClose={onClose}>
      <p className="schedule-preview">« {body} »</p>
      <p className="schedule-hint">
        {partnerName} le recevra à l’heure choisie, avec la notification
        habituelle. D’ici là, il reste entre toi et ton téléphone.
      </p>

      <div className="schedule-options">
        {options.map((option) => (
          <button
            key={option.label}
            type="button"
            disabled={busy}
            onClick={() => schedule(option.date)}
          >
            {option.label}
          </button>
        ))}
      </div>

      <div className="schedule-custom">
        <input
          type="datetime-local"
          value={custom}
          min={toLocalInput(new Date(now.getTime() + 5 * 60e3))}
          max={toLocalInput(new Date(now.getTime() + 7 * 86400e3 - 60e3))}
          onChange={(event) => setCustom(event.target.value)}
          aria-label="Date et heure d’envoi"
        />
        <button
          type="button"
          className="settings-primary-action"
          disabled={busy || !custom}
          onClick={() => schedule(new Date(custom))}
        >
          <span>{busy ? "Un instant…" : "Programmer"}</span>
          <span className="settings-action-arrow">→</span>
        </button>
      </div>

      {error && <p className="settings-feedback">{error}</p>}
    </SettingsSheet>
  );
}

export function ScheduledList({ supabase, items, onChanged, onClose }) {
  const [busyId, setBusyId] = useState(null);

  const cancel = async (id) => {
    setBusyId(id);
    const { error } = await supabase.rpc("cancel_scheduled_message", { p_id: id });
    setBusyId(null);

    if (error) {
      console.error("CANCEL SCHEDULED ERROR:", error);
    }

    onChanged();
  };

  return (
    <SettingsSheet eyebrow="PROGRAMMÉS" title="En attente d’envoi." onClose={onClose}>
      {items.length === 0 && <p className="schedule-hint">Plus rien en attente.</p>}

      <ul className="scheduled-list">
        {items.map((item) => (
          <li key={item.id}>
            <span className="scheduled-when">{formatSendAt(item.send_at)}</span>
            <p>{item.body}</p>
            <button type="button" disabled={busyId === item.id} onClick={() => cancel(item.id)}>
              {busyId === item.id ? "…" : "Annuler"}
            </button>
          </li>
        ))}
      </ul>
    </SettingsSheet>
  );
}
