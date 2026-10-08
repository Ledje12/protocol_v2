import { useEffect, useState } from "react";
import Footer from "./Footer.jsx";
import { getGameSession } from "./gameSession.js";
import LoadingScreen from "./LoadingScreen.jsx";
import StateScreen from "./StateScreen.jsx";
import { supabase } from "./supabaseClient.js";

/* =========================================================
   LOBBY
   ========================================================= */

export default function LobbyScreen({
  code,
  navigate,
}) {
  const [game, setGame] =
    useState(null);

  const [loading, setLoading] =
    useState(true);

  const [readyLoading, setReadyLoading] =
    useState(false);

  const [error, setError] =
    useState("");

  const {
    playerNumber,
    valid: hasGameSession,
  } = getGameSession(code);

  const goCalibration = () => {
    navigate(
      `/game/${code}/calibration`
    );
  };

  const processGame = (
    updatedGame
  ) => {
    if (!updatedGame) {
      return;
    }

    setGame(updatedGame);

    if (
      updatedGame.status ===
      "calibrating"
    ) {
      goCalibration();
    }
  };

  const loadGame = async () => {
    if (!hasGameSession) {
      throw new Error(
        "Session de partie invalide."
      );
    }

    const {
      data,
      error: loadError,
    } = await supabase.rpc(
      "get_protocol_game",
      {
        p_game_code: code,
      }
    );

    if (loadError) {
      throw loadError;
    }

    const gameData =
      Array.isArray(data)
        ? data[0]
        : data;

    if (!gameData) {
      throw new Error(
        "Partie introuvable."
      );
    }

    processGame(gameData);

    return gameData;
  };

  useEffect(() => {
    let active = true;

    const initialise = async () => {
      try {
        const data =
          await loadGame();

        if (
          active &&
          data.status !==
            "calibrating"
        ) {
          setGame(data);
        }
      } catch (err) {
        console.error(err);

        if (active) {
          setError(
            "Partie introuvable."
          );
        }
      } finally {
        if (active) {
          setLoading(false);
        }
      }
    };

    initialise();

    /*
     * Polling = filet de sécurité.
     *
     * Si Realtime rate un événement,
     * on vérifie quand même Supabase.
     */
    const polling =
      window.setInterval(
        async () => {
          if (!active) return;

          try {
            await loadGame();
          } catch (err) {
            console.error(
              "POLL ERROR:",
              err
            );
          }
        },
        1500
      );

    return () => {
      active = false;

      window.clearInterval(
        polling
      );

    };
  }, [code]);

  const setReady = async () => {
    if (
      !game ||
      readyLoading ||
      !hasGameSession
    ) {
      return;
    }

    try {
      setReadyLoading(true);
      setError("");

        const {
          error: readyError,
        } = await supabase.rpc(
          "set_protocol_ready",
          {
            p_game_code: code,
          }
        );

      if (readyError) {
        throw readyError;
      }

      await loadGame();

    } catch (err) {
      console.error(
        "READY ERROR:",
        err
      );

      setError(
        err?.message ||
          "Impossible de continuer."
      );

    } finally {
      setReadyLoading(false);
    }
  };

  if (loading) {
    return (
      <LoadingScreen />
    );
  }

  if (
    error &&
    !game
  ) {
    return (
      <StateScreen
        title={
          error === "Partie introuvable."
            ? "Partie introuvable."
            : "La partie ne répond pas."
        }
        text={
          error === "Partie introuvable."
            ? "Le code n’est plus valable, ou la partie est terminée."
            : "Impossible de charger la partie. Vérifie ta connexion puis réessaie."
        }
        actionLabel="Retour à l’accueil"
        onAction={() =>
          navigate("/")
        }
      />
    );
  }

  if (!hasGameSession) {
    return (
      <StateScreen
        title="Pas sur ce téléphone."
        text="Ce téléphone n’est pas associé à cette partie. Rejoins-la avec son code."
        actionLabel="Retour à l’accueil"
        onAction={() =>
          navigate("/")
        }
      />
    );
  }

  const myName =
    playerNumber === 1
      ? game.player_1_name
      : game.player_2_name;

  const partnerName =
    playerNumber === 1
      ? game.player_2_name
      : game.player_1_name;

  const connected =
    game.player_count === 2;

  const playerReady =
    playerNumber === 1
      ? game.player_1_ready
      : game.player_2_ready;

  const partnerReady =
    playerNumber === 1
      ? game.player_2_ready
      : game.player_1_ready;

  return (
    <main className="app">
      <div className="glow glow-center" />

      <header className="header">
        <span className="logo">
          PROTOCOL
        </span>

      <span className="pill">
        {myName}
      </span>
      </header>

      <section className="lobby">
        <div className="code-card">
          <p className="kicker">
            VOTRE CODE
          </p>

          <div className="game-code">
            {code}
          </div>

          <p className="small-text">
            {connected
              ? `${partnerName || "Ton partenaire"} a rejoint la partie.`
              : "Partage ce code avec ton partenaire."}
          </p>

          <div
            className={
              connected
                ? "status connected"
                : "status"
            }
          >
            <span className="orb" />

            {connected
              ? "Vous êtes connectés"
              : "En attente de l'autre joueur"}
          </div>
        </div>

        {connected && (
          <div className="ready-area">
            <p className="kicker">
              AVANT DE COMMENCER
            </p>

            <h1>
              Prêt à
              <br />
              jouer ?
            </h1>

            <p className="intro">
              La prochaine étape est
              individuelle. Tes réponses
              resteront privées.
            </p>

            {!playerReady ? (
              <button
                className="primary"
                onClick={setReady}
                disabled={
                  readyLoading
                }
              >
                <span>
                  {readyLoading
                    ? "Un instant…"
                    : "Je suis prêt"}
                </span>

                <span>→</span>
              </button>
            ) : (
              <div className="ready-box">
                <div className="check">
                  ✓
                </div>

                <div>
                  <strong>
                    Tu es prêt.
                  </strong>

                  <span>
                    {partnerReady
                      ? "La partie commence…"
                      : "On attend encore l'autre."}
                  </span>
                </div>
              </div>
            )}

            {error && (
              <p className="error">
                {error}
              </p>
            )}
          </div>
        )}
      </section>

      <Footer />
    </main>
  );
}
