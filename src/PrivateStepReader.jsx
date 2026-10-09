import { useEffect, useState } from "react";
import { createPortal } from "react-dom";

/* Étape privée d'une scène, sur un seul téléphone.
   Chaque joueur qui a un texte privé le lit à son tour, derrière
   un écran couvrant : « Jérôme, prends le téléphone (Audrey, ferme
   les yeux) » → afficher → « J'ai lu, masquer » → au tour de l'autre.
   Les marques « lu » viennent du serveur : un rechargement reprend
   là où on en était. Ensuite, chacun peut relire son texte. */

export default function PrivateStepReader({
  supabase,
  code,
  card,
  game,
  renderText,
  onUpdated,
}) {
  // textes de chacun pour l'étape en cours ({1: état, 2: état})
  const [views, setViews] = useState(null);

  // lecture en cours : { player, shown }
  const [reading, setReading] = useState(null);

  // relecture volontaire (sans marquer « lu »)
  const [rereading, setRereading] = useState(null);

  const [busy, setBusy] = useState(false);

  const stepNo = game?.scene_step_no;
  const names = {
    1: game?.player_1_name || "Joueur 1",
    2: game?.player_2_name || "Joueur 2",
  };

  useEffect(() => {
    let active = true;

    setViews(null);
    setReading(null);
    setRereading(null);

    if (!card?.id || !stepNo) {
      return undefined;
    }

    Promise.all(
      [1, 2].map((player) =>
        supabase.rpc("get_scene_state_as", {
          p_game_code: code,
          p_player_no: player,
        })
      )
    ).then(([one, two]) => {
      if (active && !one.error && !two.error) {
        setViews({ 1: one.data, 2: two.data });
      }
    });

    return () => {
      active = false;
    };
  }, [supabase, code, card?.id, stepNo]);

  if (!views) {
    return null;
  }

  const activePlayer = game?.active_player || 1;
  const order = [activePlayer, activePlayer === 1 ? 2 : 1];
  const privatePlayers = order.filter((player) => views[player]?.is_private);

  if (privatePlayers.length === 0) {
    return null;
  }

  const hasRead = (player) =>
    Boolean(game?.[`scene_step_read_player_${player}`]);

  const pending = privatePlayers.filter((player) => !hasRead(player));
  const current = reading?.player || pending[0] || null;
  const shown = Boolean(reading?.shown);

  const markRead = async (player) => {
    setBusy(true);

    const { error } = await supabase.rpc("mark_scene_step_read_guarded_as", {
      p_game_code: code,
      p_expected_card_id: card.id,
      p_expected_scene_step_no: stepNo,
      p_player_no: player,
    });

    if (error) {
      // « étape non privée » pour ce joueur : rien à marquer
      console.warn("PRIVATE STEP READ:", error.message);
    }

    setBusy(false);
    setReading(null);
    onUpdated?.();
  };

  const overlay = (player, isShown, onShow, onHide, hideLabel) => {
    const other = player === 1 ? 2 : 1;
    const view = views[player];

    return createPortal(
      <div className="private-reader">
        <section
          className="private-reader-sheet"
          role="dialog"
          aria-modal="true"
          aria-label={`Lecture privée pour ${names[player]}`}
        >
          <p className="kicker">LECTURE PRIVÉE</p>

          {!isShown ? (
            <>
              <h2>
                <em>{names[player]}</em>, prends le téléphone.
              </h2>
              <p className="private-reader-note">
                {names[other]}, ferme les yeux : ce texte n’est que pour{" "}
                {names[player]}.
              </p>
              <button type="button" className="primary" onClick={onShow}>
                <span>Afficher mon texte</span>
                <span aria-hidden="true">→</span>
              </button>
            </>
          ) : (
            <>
              {view?.title && (
                <h2 className="private-reader-title">
                  {renderText(view.title)}
                </h2>
              )}
              <p className="private-reader-text">
                {renderText(view?.prompt)}
              </p>
              <button
                type="button"
                className="primary"
                onClick={onHide}
                disabled={busy}
              >
                <span>{busy ? "Un instant…" : hideLabel}</span>
                <span aria-hidden="true">✓</span>
              </button>
            </>
          )}
        </section>
      </div>,
      document.body
    );
  };

  // 1. lecture obligatoire, joueur par joueur
  if (pending.length > 0 && !rereading) {
    return overlay(
      current,
      shown,
      () => setReading({ player: current, shown: true }),
      () => markRead(current),
      "J’ai lu, masquer"
    );
  }

  // 2. relecture volontaire
  if (rereading) {
    return overlay(
      rereading.player,
      rereading.shown,
      () => setRereading({ ...rereading, shown: true }),
      () => setRereading(null),
      "Masquer"
    );
  }

  // 3. tout le monde a lu : boutons discrets pour relire
  return (
    <div className="private-reread">
      <span>Étape privée · chacun a lu son texte.</span>
      <div>
        {privatePlayers.map((player) => (
          <button
            key={player}
            type="button"
            onClick={() => setRereading({ player, shown: false })}
          >
            Relire · {names[player]}
          </button>
        ))}
      </div>
    </div>
  );
}
