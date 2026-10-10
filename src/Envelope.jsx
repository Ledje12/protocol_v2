import { useEffect, useState } from "react";
import { createPortal } from "react-dom";

/* L'enveloppe.
   Vers 60 % de la partie, chacun écrit en secret une phrase pour
   la fin de soirée, ou passe. Elle est scellée côté serveur et ne
   s'ouvre qu'à la fin normale de la partie (EnvelopeReveal).
   Un seul téléphone : chacun écrit à son tour, derrière un écran
   « passe le téléphone ». */

const MAX_LENGTH = 140;

// même règle que le serveur (protocol_envelope_turn)
const envelopeTurn = (targetTurns) =>
  Math.floor((targetTurns || 20) * 0.6) + 1;

export function EnvelopeWriter({ supabase, code, game, singleDevice, names }) {
  // joueurs qui doivent encore écrire, dans l'ordre
  const [pending, setPending] = useState([]);

  // un seul téléphone : écran de passage avant d'écrire
  const [ready, setReady] = useState(!singleDevice);

  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const due =
    game?.status === "playing" &&
    game.turn_no >= envelopeTurn(game.target_turns);

  useEffect(() => {
    let active = true;

    if (!due) {
      return undefined;
    }

    const players = singleDevice
      ? [game.active_player || 1, game.active_player === 1 ? 2 : 1]
      : [null];

    Promise.all(
      players.map((player) =>
        player
          ? supabase.rpc("get_protocol_envelope_as", {
              p_game_code: code,
              p_player_no: player,
            })
          : supabase.rpc("get_protocol_envelope", { p_game_code: code })
      )
    ).then((results) => {
      if (!active || results.some((result) => result.error)) {
        return;
      }

      setPending(
        results
          .map((result) => result.data)
          .filter((state) => state?.due && !state.sealed)
          .map((state) => state.player_no)
      );
    });

    return () => {
      active = false;
    };
    // on revérifie à chaque tour ; active_player ne sert qu'à l'ordre
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [supabase, code, due, game?.turn_no, singleDevice]);

  const current = pending[0];

  if (!due || !current) {
    return null;
  }

  const other = current === 1 ? 2 : 1;

  const seal = async (text) => {
    setBusy(true);
    setError("");

    const { error: rpcError } = singleDevice
      ? await supabase.rpc("seal_protocol_envelope_as", {
          p_game_code: code,
          p_player_no: current,
          p_message: text,
        })
      : await supabase.rpc("seal_protocol_envelope", {
          p_game_code: code,
          p_message: text,
        });

    setBusy(false);

    // déjà scellée (autre onglet, double appui) : on passe à la suite
    if (rpcError && !/already sealed/i.test(rpcError.message)) {
      console.error("ENVELOPE SEAL ERROR:", rpcError);
      setError("L’enveloppe n’a pas pu être scellée. Réessaie.");
      return;
    }

    setMessage("");
    setReady(!singleDevice);
    setPending((list) => list.slice(1));
  };

  return createPortal(
    <div className="private-reader envelope-writer">
      <section
        className="private-reader-sheet"
        role="dialog"
        aria-modal="true"
        aria-label="L’enveloppe"
      >
        <p className="kicker">L’ENVELOPPE</p>

        {!ready ? (
          <>
            <h2>
              <em>{names[current]}</em>, prends le téléphone.
            </h2>
            <p className="private-reader-note">
              {names[other]}, ne regarde pas : ce qui suit n’est que
              pour {names[current]}.
            </p>
            <button type="button" className="primary" onClick={() => setReady(true)}>
              <span>Ouvrir mon enveloppe</span>
              <span aria-hidden="true">→</span>
            </button>
          </>
        ) : (
          <>
            <h2>Ce que tu veux pour la fin de soirée.</h2>
            <p className="private-reader-note">
              Une phrase, pour {names[other]}. Elle reste scellée
              jusqu’à la dernière carte, puis vous ouvrez les
              enveloppes ensemble.
            </p>

            <label className="envelope-field">
              <textarea
                aria-label="Ton enveloppe"
                value={message}
                maxLength={MAX_LENGTH}
                rows={3}
                placeholder="J’ai envie que…"
                onChange={(event) => setMessage(event.target.value)}
              />
              <span className="envelope-count" aria-hidden="true">
                {message.length} / {MAX_LENGTH}
              </span>
            </label>

            {error && <p className="envelope-error">{error}</p>}

            <button
              type="button"
              className="primary"
              disabled={busy || !message.trim()}
              onClick={() => seal(message)}
            >
              <span>{busy ? "Un instant…" : "Sceller l’enveloppe"}</span>
              <span aria-hidden="true">✦</span>
            </button>

            <button
              type="button"
              className="envelope-skip"
              disabled={busy}
              onClick={() => seal("")}
            >
              Passer, sans rien écrire
            </button>

            <p className="envelope-hint">
              {names[other]} ne saura pas si tu as écrit ou passé.
            </p>
          </>
        )}
      </section>
    </div>,
    document.body
  );
}

/* Fin de partie : ouverture des enveloppes, l'une après l'autre,
   avant l'écran de fin. Rien si personne n'a écrit. */

const seenKey = (game) =>
  `protocol-envelopes-seen-${game.id}-${game.finished_at || ""}`;

const wasSeen = (game) => {
  try {
    return localStorage.getItem(seenKey(game)) === "1";
  } catch {
    return false;
  }
};

export function EnvelopeReveal({ supabase, code, game }) {
  const [envelopes, setEnvelopes] = useState(null);
  const [opened, setOpened] = useState(0);
  const [closed, setClosed] = useState(() => wasSeen(game));

  useEffect(() => {
    let active = true;

    if (closed) {
      return undefined;
    }

    supabase
      .rpc("open_protocol_envelopes", { p_game_code: code })
      .then(({ data, error }) => {
        if (active) {
          setEnvelopes(!error && Array.isArray(data) ? data : []);
        }
      });

    return () => {
      active = false;
    };
  }, [supabase, code, closed]);

  if (closed || !envelopes || envelopes.length === 0) {
    return null;
  }

  const close = () => {
    try {
      localStorage.setItem(seenKey(game), "1");
    } catch {
      // stockage indisponible : l'écran se fermera quand même
    }

    setClosed(true);
  };

  const allOpen = opened >= envelopes.length;

  return createPortal(
    <div className="private-reader envelope-reveal">
      <section
        className="private-reader-sheet"
        role="dialog"
        aria-modal="true"
        aria-label="Les enveloppes"
      >
        <p className="kicker">LES ENVELOPPES</p>
        <h2>
          {envelopes.length === 1
            ? "Une seule enveloppe ce soir."
            : "Deux enveloppes vous attendent."}
        </h2>

        <div className="envelope-list">
          {envelopes.map((envelope, index) =>
            index < opened ? (
              <article key={envelope.player_no} className="envelope-card is-open">
                <span className="envelope-from">
                  De <em>{envelope.name}</em>
                </span>
                <blockquote>{envelope.message}</blockquote>
              </article>
            ) : (
              <button
                key={envelope.player_no}
                type="button"
                className="envelope-card"
                disabled={index !== opened}
                onClick={() => setOpened(index + 1)}
              >
                <span className="envelope-seal" aria-hidden="true">✦</span>
                <span className="envelope-from">
                  Enveloppe de <em>{envelope.name}</em>
                </span>
                {index === opened && (
                  <span className="envelope-tap">Toucher pour ouvrir</span>
                )}
              </button>
            )
          )}
        </div>

        {allOpen && (
          <button type="button" className="primary" onClick={close}>
            <span>Fin de partie</span>
            <span aria-hidden="true">→</span>
          </button>
        )}
      </section>
    </div>,
    document.body
  );
}
