import { useEffect, useState } from "react";
import { createPortal } from "react-dom";

import { EnvelopeReveal } from "./Envelope.jsx";

/* Missions secrètes.
   Au lancement, chacun découvre en privé sa mission (une seule
   « Une autre » possible en début de partie). Pendant la partie,
   le bouton « Mission secrète » permet de la relire et de la
   marquer réussie, en secret. À la fin, on les révèle, avant les
   enveloppes. Un seul téléphone : chaque lecture passe par un
   écran « passe le téléphone ». */

const seenKey = (game, player, title) =>
  `protocol-mission-seen-${game.id}-${player}-${title}`;

const readSeen = (key) => {
  try {
    return localStorage.getItem(key) === "1";
  } catch {
    return false;
  }
};

const writeSeen = (key) => {
  try {
    localStorage.setItem(key, "1");
  } catch {
    // stockage indisponible : la mission se remontrera, sans gravité
  }
};

function MissionSheet({ kicker, children, label }) {
  return createPortal(
    <div className="private-reader mission-sheet">
      <section
        className="private-reader-sheet"
        role="dialog"
        aria-modal="true"
        aria-label={label}
      >
        <p className="kicker">{kicker}</p>
        {children}
      </section>
    </div>,
    document.body
  );
}

function PassPhone({ names, player, onReady }) {
  const other = player === 1 ? 2 : 1;

  return (
    <>
      <h2>
        <em>{names[player]}</em>, prends le téléphone.
      </h2>
      <p className="private-reader-note">
        {names[other]}, ne regarde pas : ce qui suit n’est que pour{" "}
        {names[player]}.
      </p>
      <button type="button" className="primary" onClick={onReady}>
        <span>Voir ma mission</span>
        <span aria-hidden="true">→</span>
      </button>
    </>
  );
}

export function SecretMission({ supabase, code, game, singleDevice, names }) {
  // états par joueur : { 1: {...}, 2: {...} } (deux téléphones : le sien)
  const [states, setStates] = useState({});

  // { player, mode: "briefing" | "reread", ready }
  const [open, setOpen] = useState(null);
  const [choosing, setChoosing] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const playing = game?.status === "playing";

  const fetchStates = async () => {
    const players = singleDevice ? [1, 2] : [null];

    const results = await Promise.all(
      players.map((player) =>
        player
          ? supabase.rpc("get_my_mission_as", {
              p_game_code: code,
              p_player_no: player,
            })
          : supabase.rpc("get_my_mission", { p_game_code: code })
      )
    );

    if (results.some((result) => result.error)) {
      return null;
    }

    const next = {};

    for (const { data } of results) {
      if (data?.mission) {
        next[data.player_no] = data;
      }
    }

    setStates(next);
    return next;
  };

  useEffect(() => {
    if (!playing) {
      return undefined;
    }

    let active = true;

    fetchStates().then((next) => {
      if (!active || !next) {
        return;
      }

      // première découverte : le joueur actif d'abord
      const order = singleDevice
        ? [game.active_player || 1, game.active_player === 1 ? 2 : 1]
        : Object.keys(next).map(Number);

      const unseen = order.find(
        (player) =>
          next[player] &&
          !readSeen(seenKey(game, player, next[player].mission.title))
      );

      if (unseen) {
        setOpen((current) =>
          current || { player: unseen, mode: "briefing", ready: !singleDevice }
        );
      }
    });

    return () => {
      active = false;
    };
    // revérifié au lancement, à la reprise et à chaque tour
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [supabase, code, playing, game?.id, game?.turn_no, singleDevice]);

  const players = Object.keys(states).map(Number);

  if (!playing || players.length === 0) {
    return null;
  }

  const call = (name, player, extra = {}) =>
    singleDevice
      ? supabase.rpc(`${name}_as`, { p_game_code: code, p_player_no: player, ...extra })
      : supabase.rpc(name, { p_game_code: code, ...extra });

  const closeSheet = () => {
    if (open?.mode === "briefing") {
      const state = states[open.player];
      writeSeen(seenKey(game, open.player, state.mission.title));

      // un seul téléphone : enchaîner sur l'autre joueur
      const other = open.player === 1 ? 2 : 1;
      const otherState = states[other];

      if (
        singleDevice &&
        otherState &&
        !readSeen(seenKey(game, other, otherState.mission.title))
      ) {
        setOpen({ player: other, mode: "briefing", ready: false });
        return;
      }
    }

    setError("");
    setOpen(null);
  };

  const redraw = async () => {
    setBusy(true);
    setError("");
    const { data, error: rpcError } = await call("redraw_my_mission", open.player);
    setBusy(false);

    if (rpcError) {
      console.error("MISSION REDRAW ERROR:", rpcError);
      setError("Pas d’autre mission disponible pour l’instant.");
      return;
    }

    setStates((current) => ({ ...current, [open.player]: data }));
  };

  const toggleDone = async () => {
    const state = states[open.player];
    setBusy(true);
    setError("");
    const { error: rpcError } = await call("set_my_mission_done", open.player, {
      p_done: !state.done,
    });
    setBusy(false);

    if (rpcError) {
      console.error("MISSION DONE ERROR:", rpcError);
      setError("Impossible d’enregistrer pour l’instant.");
      return;
    }

    setStates((current) => ({
      ...current,
      [open.player]: { ...state, done: !state.done, can_redraw: false },
    }));
  };

  const state = open ? states[open.player] : null;

  return (
    <>
      <button
        type="button"
        className="mission-toggle"
        onClick={() =>
          singleDevice
            ? setChoosing(true)
            : setOpen({ player: players[0], mode: "reread", ready: true })
        }
      >
        <span className="mission-toggle-label">
          {singleDevice ? "MISSIONS SECRÈTES" : "MISSION SECRÈTE"}
        </span>
        <span className="mission-toggle-meta">
          {!singleDevice && states[players[0]]?.done ? "Réussie ✓" : "Relire"}
        </span>
      </button>

      {choosing && (
        <MissionSheet kicker="MISSIONS SECRÈTES" label="Choisir sa mission">
          <h2>Qui veut relire sa mission ?</h2>
          <div className="mission-choose">
            {players.map((player) => (
              <button
                key={player}
                type="button"
                onClick={() => {
                  setChoosing(false);
                  setOpen({ player, mode: "reread", ready: false });
                }}
              >
                {names[player]}
              </button>
            ))}
          </div>
          <button type="button" className="envelope-skip" onClick={() => setChoosing(false)}>
            Fermer
          </button>
        </MissionSheet>
      )}

      {open && state && (
        <MissionSheet
          kicker={open.mode === "briefing" ? "TA MISSION SECRÈTE" : "MISSION SECRÈTE"}
          label="Mission secrète"
        >
          {!open.ready ? (
            <PassPhone
              names={names}
              player={open.player}
              onReady={() => setOpen({ ...open, ready: true })}
            />
          ) : (
            <>
              <h2>{state.mission.title}</h2>
              <p className="mission-prompt">{state.mission.prompt}</p>
              <p className="private-reader-note">
                {open.mode === "briefing"
                  ? `À réussir avant la fin de la partie, sans que ${
                      names[open.player === 1 ? 2 : 1]
                    } le devine. Tu pourras la relire à tout moment.`
                  : "Personne ne voit ta mission avant la fin de la partie."}
              </p>

              {error && <p className="envelope-error">{error}</p>}

              {open.mode === "reread" && (
                <button
                  type="button"
                  className={state.done ? "mission-done is-done" : "mission-done"}
                  aria-pressed={state.done}
                  disabled={busy}
                  onClick={toggleDone}
                >
                  {state.done ? "Réussie ✓" : "Je l’ai réussie"}
                </button>
              )}

              <button type="button" className="primary" onClick={closeSheet}>
                <span>{open.mode === "briefing" ? "C’est noté" : "Masquer"}</span>
                <span aria-hidden="true">✓</span>
              </button>

              {state.can_redraw && (
                <button
                  type="button"
                  className="envelope-skip"
                  disabled={busy}
                  onClick={redraw}
                >
                  Une autre (une seule fois)
                </button>
              )}
            </>
          )}
        </MissionSheet>
      )}
    </>
  );
}

/* Fin de partie : les missions d'abord, puis les enveloppes. */

const revealKey = (game) =>
  `protocol-missions-seen-${game.id}-${game.finished_at || ""}`;

function MissionReveal({ supabase, code, game, onDone }) {
  const [missions, setMissions] = useState(null);

  useEffect(() => {
    let active = true;

    if (readSeen(revealKey(game))) {
      onDone();
      return undefined;
    }

    supabase
      .rpc("reveal_protocol_missions", { p_game_code: code })
      .then(({ data, error }) => {
        if (!active) {
          return;
        }

        if (error || !Array.isArray(data) || data.length === 0) {
          onDone();
          return;
        }

        setMissions(data);
      });

    return () => {
      active = false;
    };
    // une seule fois par fin de partie
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [supabase, code, game?.id, game?.finished_at]);

  if (!missions) {
    return null;
  }

  return (
    <MissionSheet kicker="LES MISSIONS SECRÈTES" label="Les missions secrètes">
      <h2>Ce que vous cachiez.</h2>

      <div className="envelope-list">
        {missions.map((mission) => (
          <article key={mission.player_no} className="envelope-card is-open mission-result">
            <span className="envelope-from">
              <em>{mission.name}</em> devait…
            </span>
            <strong>{mission.title}</strong>
            <p>{mission.prompt}</p>
            <span className={mission.done ? "mission-badge is-done" : "mission-badge"}>
              {mission.done ? "Réussie ✓" : "Pas cette fois"}
            </span>
          </article>
        ))}
      </div>

      <button
        type="button"
        className="primary"
        onClick={() => {
          writeSeen(revealKey(game));
          onDone();
        }}
      >
        <span>Continuer</span>
        <span aria-hidden="true">→</span>
      </button>
    </MissionSheet>
  );
}

export function FinalReveals({ supabase, code, game }) {
  const [missionsDone, setMissionsDone] = useState(false);

  return missionsDone ? (
    <EnvelopeReveal supabase={supabase} code={code} game={game} />
  ) : (
    <MissionReveal
      supabase={supabase}
      code={code}
      game={game}
      onDone={() => setMissionsDone(true)}
    />
  );
}
