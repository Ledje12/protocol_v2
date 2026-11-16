import { useEffect, useRef, useState } from "react";

/* Dilemme d'une carte : deux boutons sous le texte. Celui dont c'est
   le tour en touche un ; le choix s'affiche sur les deux téléphones
   et ne se reprend pas. Sans la migration, ou si la carte n'a pas de
   choix, le composant ne montre rien. */

const POLL_MS = 3000;

export default function CardChoice({ supabase, code, cardId, turnNo, names = {} }) {
  const [state, setState] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const alive = useRef(true);

  useEffect(() => {
    alive.current = true;
    let timer = null;

    setState(null);
    setError("");

    if (!code || !cardId) {
      return undefined;
    }

    const read = async () => {
      const { data, error: rpcError } = await supabase.rpc("get_card_choice", {
        p_game_code: code,
      });

      if (!alive.current) return;

      // fonction absente ou carte sans choix : rien à afficher, rien à relire
      if (rpcError || !data || data.card_id !== cardId) {
        setState(null);
        return;
      }

      setState(data);

      // tant que personne n'a choisi, on attend le choix de l'autre
      if (data.choice == null) {
        timer = window.setTimeout(read, POLL_MS);
      }
    };

    read();

    return () => {
      alive.current = false;
      window.clearTimeout(timer);
    };
  }, [supabase, code, cardId, turnNo]);

  if (!state) {
    return null;
  }

  const choose = async (choice) => {
    if (busy || !state.can_choose) return;

    setBusy(true);
    setError("");

    const { data, error: rpcError } = await supabase.rpc("set_card_choice", {
      p_game_code: code,
      p_choice: choice,
    });

    if (!alive.current) return;

    setBusy(false);

    if (rpcError || !data) {
      setError("Le choix n’est pas passé. Réessaie.");
      return;
    }

    setState(data);
  };

  const chosen = state.choice != null;
  const who = names[state.chosen_by];

  return (
    <section className={chosen ? "card-choice is-chosen" : "card-choice"} aria-label="Ton choix">
      <div className="card-choice-options">
        {state.options.map((label, index) => {
          const value = index + 1;
          const picked = state.choice === value;

          return (
            <button
              key={value}
              type="button"
              className={
                picked ? "card-choice-option is-picked" : "card-choice-option"
              }
              onClick={() => choose(value)}
              disabled={chosen || busy || !state.can_choose}
              aria-pressed={picked}
            >
              {label}
            </button>
          );
        })}
      </div>

      <p className="card-choice-status" aria-live="polite">
        {chosen
          ? who
            ? `${who} a choisi. On ne change pas d’avis.`
            : "C’est choisi. On ne change pas d’avis."
          : state.can_choose
            ? "Touche ton choix : il s’affiche chez l’autre."
            : "En attente du choix…"}
      </p>

      {error && <p className="card-choice-error">{error}</p>}
    </section>
  );
}
