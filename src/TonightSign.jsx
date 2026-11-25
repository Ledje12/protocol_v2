import { useEffect, useState } from "react";

/* « Ce soir ? » reçu : une petite enseigne s'allume sur l'accueil,
   avec deux réponses qui partent comme un message (notification
   comprise). Les 12 h qui suivent le signe, tant qu'on n'a pas
   répondu sur ce téléphone. */

const ANSWERED_KEY = "protocol_tonight_answered";
const FRESH_HOURS = 12;

const answeredId = () => {
  try {
    return localStorage.getItem(ANSWERED_KEY);
  } catch {
    return null;
  }
};

export default function TonightSign({ supabase }) {
  const [signal, setSignal] = useState(null);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState("");

  useEffect(() => {
    let active = true;
    supabase.rpc("get_my_signals").then(({ data, error }) => {
      if (!active || error || !Array.isArray(data)) return;
      const latest = data.find((item) => item.type === "tonight");
      if (
        latest &&
        String(latest.id) !== answeredId() &&
        Date.now() - new Date(latest.created_at).getTime() < FRESH_HOURS * 3600 * 1000
      ) {
        setSignal(latest);
      }
    });
    return () => {
      active = false;
    };
  }, [supabase]);

  if (!signal) {
    return null;
  }

  const answer = async (text) => {
    setBusy(true);
    setNote("");
    const { data, error } = await supabase.functions.invoke("send-message", {
      body: { body: text },
    });
    setBusy(false);
    if (error || !data?.success) {
      setNote("La réponse n’a pas pu partir. Réessaie dans un instant.");
      return;
    }
    try {
      localStorage.setItem(ANSWERED_KEY, String(signal.id));
    } catch {
      // sans stockage : l'enseigne reviendra, sans gravité
    }
    setNote("Réponse envoyée.");
    window.setTimeout(() => setSignal(null), 1400);
  };

  return (
    <section className="tonight-sign" aria-label="Ce soir ?">
      <p className="tonight-sign-neon" aria-hidden="true">Ce soir ?</p>
      <p className="tonight-sign-from">{signal.sender_name} te fait signe.</p>
      <div className="tonight-sign-actions">
        <button
          type="button"
          className="tonight-yes"
          disabled={busy}
          onClick={() => answer("Oui, ce soir 🔥")}
        >
          Oui, ce soir
        </button>
        <button
          type="button"
          disabled={busy}
          onClick={() => answer("Pas ce soir… une autre fois 😘")}
        >
          Pas ce soir
        </button>
      </div>
      {note && <p className="tonight-sign-note">{note}</p>}
    </section>
  );
}
