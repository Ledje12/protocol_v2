import { useCallback, useEffect, useState } from "react";

import { humanError } from "./networkError.js";

/* Calendrier de l'Avent, côté accueil : la tuile de saison et le
   chargement du calendrier (partagé avec l'écran, Advent.jsx). */

// compte à rebours affiché tout le mois de novembre (teasing)
const TEASER_DAYS = 31;

export function GiftIcon({ size = 24 }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.6"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <rect x="3.5" y="8.5" width="17" height="4" rx="1" />
      <path d="M5 12.5v7a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1v-7" />
      <path d="M12 8.5v12" />
      <path d="M12 8.5c-1.6-3.6-5.6-3.9-5.6-1.7 0 1.7 3.4 1.7 5.6 1.7Z" />
      <path d="M12 8.5c1.6-3.6 5.6-3.9 5.6-1.7 0 1.7-3.4 1.7-5.6 1.7Z" />
    </svg>
  );
}

// jours avant le 1er décembre (heure du téléphone), 0 si on y est
const daysUntilAdvent = () => {
  const now = new Date();
  const start = new Date(now.getFullYear(), 11, 1);
  return Math.ceil((start - now) / 86400000);
};

export function useAdvent(supabase) {
  const [advent, setAdvent] = useState(null);
  const [error, setError] = useState("");

  const reload = useCallback(async () => {
    const { data, error: rpcError } = await supabase.rpc("get_protocol_advent", {
      p_preview: true,
    });

    if (rpcError) {
      // sans la migration, ou hors connexion : pas de calendrier
      setError(humanError(rpcError, "Le calendrier ne répond pas. Réessaie dans un instant."));
      return;
    }

    setError("");
    setAdvent(data);
  }, [supabase]);

  useEffect(() => {
    reload();
  }, [reload]);

  return [advent, reload, error];
}

/* Tuile de saison sur l'accueil : compte à rebours en novembre,
   puis tout décembre. Rien le reste de l'année, sauf en
   aperçu pour un admin. */
export function AdventHomeTile({ supabase, onOpen }) {
  const [advent] = useAdvent(supabase);

  if (!advent || !advent.days?.length) {
    return null;
  }

  const today = advent.today;
  const todayDoor = advent.days.find((door) => door.day === today);
  const until = daysUntilAdvent();

  let text = null;

  if (today >= 1 && today <= 24) {
    text = todayDoor?.done
      ? `Jour ${today} : défi relevé. À demain…`
      : todayDoor?.opened
        ? `Jour ${today} : votre défi vous attend.`
        : `Case ${today} à ouvrir aujourd’hui.`;
  } else if (today === 25) {
    text = "Revoir vos 24 défis.";
  } else if (today === 0 && advent.days.some((door) => door.day === 0 && !door.opened)) {
    text = "Une invitation vous attend.";
  } else if (until > 0 && until <= TEASER_DAYS) {
    text = until === 1 ? "Première case demain." : `Première case dans ${until} jours.`;
  } else if (advent.preview) {
    text = "Aperçu : visible par toi seul.";
  }

  if (!text) {
    return null;
  }

  return (
    <button type="button" className="advent-tile" onClick={onOpen}>
      <span className="advent-tile-icon">
        <GiftIcon size={22} />
      </span>
      <span className="advent-tile-copy">
        <small>CALENDRIER DE L’AVENT</small>
        <strong>{text}</strong>
      </span>
      <span aria-hidden="true">→</span>
    </button>
  );
}

