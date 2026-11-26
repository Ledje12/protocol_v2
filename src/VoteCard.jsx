import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";

import "./vote.css";
import { fillNames } from "./personalise.js";
import { playSound } from "./sounds.js";

/* Carte « Oui / Non » : cinq cartes, chacun dit oui ou non en secret,
   sur son téléphone. Une seule envie commune est tirée et arrivera
   dans les tours qui viennent. Les réponses partent une à une au
   serveur (définitives) ; l'autre ne voit que l'avancée. */

const SWIPE = 90;

const seenKey = (gameId) => `protocol_vote_seen_${gameId}`;

const wasSeen = (gameId) => {
  try {
    return localStorage.getItem(seenKey(gameId)) === "1";
  } catch {
    return false;
  }
};

const TYPE_LABELS = { action: "ACTION", scene: "SCÈNE", truth: "VÉRITÉ", duel: "DUEL" };

export default function VoteCard({
  supabase,
  code,
  gameId,
  vote,
  playerNumber,
  names,
  sexes,
  onChanged,
  // un seul téléphone : chacun vote à son tour, en se le passant
  singleDevice = false,
  activePlayer = 1,
}) {
  const [started, setStarted] = useState(false);
  const [decided, setDecided] = useState({});
  // un seul téléphone : le joueur qui tient le téléphone a confirmé
  const [holder, setHolder] = useState(null);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState("");
  const [drag, setDrag] = useState(0);
  const [dragging, setDragging] = useState(false);
  const [leaving, setLeaving] = useState(null);
  const [seen, setSeen] = useState(() => wasSeen(gameId));
  const dragStart = useRef(null);
  const soundPlayed = useRef(false);

  const isDone = vote?.status === "done";

  useEffect(() => {
    if (isDone && !seen && vote.result === "match" && !soundPlayed.current) {
      soundPlayed.current = true;
      playSound("win");
    }
  }, [isDone, seen, vote?.result]);

  if (!vote || (isDone && seen)) {
    return null;
  }

  const total = (vote.cards || []).length;
  const countOf = (player) =>
    (vote.cards || []).filter(
      (card) => card[`voted_p${player}`] || decided[`${player}-${card.position}`] !== undefined
    ).length;

  // qui vote maintenant : sur un seul téléphone, celui qui a la main
  // d'abord, puis l'autre ; sinon le propriétaire du téléphone
  const voter = singleDevice
    ? [activePlayer, 3 - activePlayer].find((player) => countOf(player) < total) || activePlayer
    : playerNumber;
  const viewer = singleDevice ? voter : playerNumber;

  const other = 3 - viewer;
  const partnerName = names[other] || "l’autre";

  const render = (text, forPlayer) =>
    fillNames(
      text,
      {
        active: names[forPlayer],
        partner: names[3 - forPlayer],
        me: names[viewer],
        other: names[other],
      },
      {
        active: sexes[forPlayer],
        partner: sexes[3 - forPlayer],
        me: sexes[viewer],
        other: sexes[other],
      }
    );

  const chip = (card) =>
    [
      !singleDevice && card.for_player === viewer
        ? "À TOI"
        : `À ${(names[card.for_player] || "").toUpperCase()}`,
      TYPE_LABELS[card.type] || "",
      card.intensity ? `NIVEAU ${card.intensity}` : "",
    ]
      .filter(Boolean)
      .join(" · ");

  const close = () => {
    try {
      localStorage.setItem(seenKey(gameId), "1");
    } catch {
      // sans stockage : le résultat s'efface au tour suivant
    }
    setSeen(true);
  };

  let screen;

  if (isDone) {
    const match = vote.result === "match" ? vote.card : null;
    screen = match ? (
      <section className="vote-screen" key="match">
        <p className="vote-kicker">UNE ENVIE COMMUNE</p>
        <div className="vote-match">
          <span className="vote-ribbon">✦ VOUS L’AVEZ CHOISIE TOUS LES DEUX</span>
          <span className="vote-chip">{chip(match)}</span>
          <h3>{match.title}</h3>
          <p>{render(match.prompt, match.for_player)}</p>
        </div>
        <p className="vote-note">
          C’est la prochaine carte, pour{" "}
          {!singleDevice && match.for_player === viewer ? "toi" : names[match.for_player]}.
          Les autres, personne ne saura qui les a refusées.
        </p>
        <button type="button" className="vote-cta" onClick={close}>
          <span>On continue</span>
          <span aria-hidden="true">→</span>
        </button>
      </section>
    ) : (
      <section className="vote-screen vote-centered" key="none">
        <div className="vote-empty" aria-hidden="true">
          {[0, 1, 2, 3, 4].map((i) => <i key={i} />)}
        </div>
        <h2>Pas cette fois.</h2>
        <p className="vote-copy">
          Aucune des cinq n’a fait l’unanimité.
          <br />
          Personne ne saura lesquelles.
        </p>
        <button type="button" className="vote-ghost" onClick={close}>
          La partie continue
        </button>
      </section>
    );
  } else {
    const cards = (vote.cards || []).filter(
      (card) =>
        !(singleDevice ? card[`voted_p${voter}`] : card.voted) &&
        decided[`${voter}-${card.position}`] === undefined
    );
    const mineDone = cards.length === 0;
    const nobodyStarted = countOf(1) === 0 && countOf(2) === 0;

    if (!started && (singleDevice ? nobodyStarted : vote.mine === 0 && Object.keys(decided).length === 0)) {
      screen = (
        <section className="vote-screen" key="intro">
          <p className="vote-kicker">OUI / NON</p>
          <h2>
            {total === 5 ? "Cinq" : total} envies.
            <br />
            <em>Deux avis.</em>
          </h2>
          <div className="vote-fan" aria-hidden="true">
            {[0, 1, 2, 3, 4].map((i) => <i key={i} />)}
          </div>
          <p className="vote-copy">
            {singleDevice
              ? "Chacun son tour, en secret : le téléphone passe de main en main. À droite pour oui, à gauche pour non."
              : "Chacun sur son téléphone. À droite pour oui, à gauche pour non."}
          </p>
          <p className="vote-note">
            Si vous dites oui à la même, l’une d’elles sera tirée au hasard
            et sera la prochaine carte. Personne ne saura ce que l’autre a
            refusé.
          </p>
          <button type="button" className="vote-cta" onClick={() => setStarted(true)}>
            <span>Commencer</span>
            <span aria-hidden="true">→</span>
          </button>
        </section>
      );
    } else if (singleDevice && holder !== voter) {
      // un seul téléphone : on le passe, l'autre ne regarde pas
      screen = (
        <section className="vote-screen vote-centered" key={`pass-${voter}`}>
          <div className="vote-seal" aria-hidden="true">P</div>
          <h2>
            <em>{names[voter]}</em>,
            <br />
            prends le téléphone.
          </h2>
          <p className="vote-copy">
            {names[3 - voter]}, ne regarde pas : ce qui suit n’est que pour{" "}
            {names[voter]}.
          </p>
          <button type="button" className="vote-cta" onClick={() => setHolder(voter)}>
            <span>Voir mes cinq cartes</span>
            <span aria-hidden="true">→</span>
          </button>
        </section>
      );
    } else if (mineDone) {
      screen = (
        <section className="vote-screen vote-centered" key="wait">
          <div className="vote-seal" aria-hidden="true">P</div>
          <h2>
            Tes choix
            <br />
            <em>sont scellés.</em>
          </h2>
          <p className="vote-copy">Même toi, tu ne les reverras pas.</p>
          <span className="vote-partner">
            <span className="vote-dot" aria-hidden="true" />
            {partnerName} trie encore… {Math.min(vote.partner, total)} / {total}
          </span>
        </section>
      );
    } else {
      const [top, next] = cards;
      const done = total - cards.length;

      const decide = async (yes) => {
        if (sending || !top) return;
        setSending(true);
        setError("");
        setLeaving(yes ? "yes" : "no");

        const { error: rpcError } = singleDevice
          ? await supabase.rpc("cast_protocol_vote_as", {
              p_game_code: code,
              p_player_no: voter,
              p_position: top.position,
              p_yes: yes,
            })
          : await supabase.rpc("cast_protocol_vote", {
              p_game_code: code,
              p_position: top.position,
              p_yes: yes,
            });

        setDrag(0);
        setLeaving(null);
        setSending(false);

        if (rpcError && !/already cast/i.test(rpcError.message || "")) {
          setError("Le choix n’est pas parti. Réessaie.");
          return;
        }

        setDecided((current) => ({ ...current, [`${voter}-${top.position}`]: yes }));
        onChanged?.();
      };

      const onDown = (event) => {
        if (sending) return;
        dragStart.current = event.clientX;
        setDragging(true);
        event.currentTarget.setPointerCapture?.(event.pointerId);
      };
      const onMove = (event) => {
        if (dragStart.current === null) return;
        setDrag(event.clientX - dragStart.current);
      };
      const onUp = () => {
        if (dragStart.current === null) return;
        dragStart.current = null;
        setDragging(false);
        if (drag > SWIPE) decide(true);
        else if (drag < -SWIPE) decide(false);
        else setDrag(0);
      };

      const offset = leaving === "yes" ? 480 : leaving === "no" ? -480 : drag;

      screen = (
        <section className="vote-screen" key="swipe">
          <div className="vote-progress" aria-hidden="true">
            {Array.from({ length: total }, (_, i) => (
              <b key={i} className={i < done ? "is-done" : undefined} />
            ))}
          </div>

          <div className="vote-stack">
            {next && <div className="vote-card is-back" aria-hidden="true" />}
            <div
              className="vote-card is-front"
              style={{
                transform: `translateX(${offset}px) rotate(${offset / 18}deg)`,
                transition: dragging ? "none" : "transform 0.32s ease",
              }}
              onPointerDown={onDown}
              onPointerMove={onMove}
              onPointerUp={onUp}
              onPointerCancel={onUp}
            >
              <span className="vote-chip">{chip(top)}</span>
              <h3>{top.title}</h3>
              <p>{render(top.prompt, top.for_player)}</p>
              {offset > 30 && <span className="vote-stamp is-yes">OUI</span>}
              {offset < -30 && <span className="vote-stamp is-no">NON</span>}
            </div>
          </div>

          {error && <p className="vote-error">{error}</p>}

          <div className="vote-buttons">
            <button type="button" className="vote-round is-no" disabled={sending} onClick={() => decide(false)} aria-label="Non">
              ✕
            </button>
            <button type="button" className="vote-round is-yes" disabled={sending} onClick={() => decide(true)} aria-label="Oui">
              ♥
            </button>
          </div>
          <p className="vote-hint">
            {done + 1} / {total} · glisse la carte, ou touche un bouton.
          </p>
        </section>
      );
    }
  }

  return createPortal(
    <div className="vote-overlay" role="dialog" aria-modal="true" aria-label="Oui / Non">
      <header className="vote-top">
        <span className="vote-brand">PROTOCOL</span>
        <span className="vote-pill">OUI / NON</span>
      </header>
      {screen}
    </div>,
    document.body
  );
}
