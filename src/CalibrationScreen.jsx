import { useEffect, useState } from "react";
import Footer from "./Footer.jsx";
import { INTENSITY_LEVELS } from "./gameConstants.js";
import { getGameSession } from "./gameSession.js";
import { supabase } from "./supabaseClient.js";
import { humanError } from "./networkError.js";

/* =========================================================
   CALIBRATION INTRO
   ========================================================= */

export default function CalibrationScreen({
  code,
  navigate,
}) {
  const {
    valid: hasGameSession,
    singleDevice,
  } = getGameSession(code);

  /* Un seul téléphone : chacun choisit à son tour, l'écran se
     masque entre les deux (« passe le téléphone »). */
  const [turn, setTurn] =
    useState(1);

  const [handoff, setHandoff] =
    useState(false);

  const [names, setNames] =
    useState({ 1: "", 2: "" });

  useEffect(() => {
    if (!singleDevice) {
      return undefined;
    }

    let active = true;

    supabase
      .rpc("get_protocol_game", { p_game_code: code })
      .then(({ data }) => {
        const gameData = Array.isArray(data) ? data[0] : data;

        if (active && gameData) {
          setNames({
            1: gameData.player_1_name || "Joueur 1",
            2: gameData.player_2_name || "Joueur 2",
          });
        }
      });

    return () => {
      active = false;
    };
  }, [singleDevice, code]);

  const currentName = names[turn] || "";
  const otherName = names[turn === 1 ? 2 : 1] || "";

  const [submitted, setSubmitted] =
    useState(false);

  const [bothReady, setBothReady] =
    useState(false);

  const [saving, setSaving] =
    useState(false);

  const [error, setError] =
    useState("");


  /* Écran rouvert : on reprend là où on en était (choix déjà fait,
     partie prête ou déjà lancée) au lieu de redemander. */
  const doneKey = `protocol-calibrated-${code}`;

  useEffect(() => {
    if (!hasGameSession) {
      return undefined;
    }

    let active = true;

    try {
      if (!singleDevice && window.localStorage.getItem(doneKey)) {
        setSubmitted(true);
      }
    } catch {
      // stockage indisponible : on redemandera le choix
    }

    supabase
      .rpc("get_protocol_game", { p_game_code: code })
      .then(({ data }) => {
        const gameData = Array.isArray(data) ? data[0] : data;

        if (!active || !gameData) {
          return;
        }

        if (gameData.status === "playing") {
          navigate(`/game/${code}/play`);
        } else if (gameData.status === "calibration_ready") {
          setSubmitted(true);
          setBothReady(true);
        }
      });

    return () => {
      active = false;
    };
  }, [hasGameSession, singleDevice, code, doneKey, navigate]);

  /* =========================================
     ATTENTE PARTENAIRE
     ========================================= */

  useEffect(() => {
    if (!submitted) {
      return;
    }

    let active = true;

    const checkStatus = async () => {
      if (!hasGameSession) {
        return;
      }

      try {
        const {
          data,
          error: statusError,
        } = await supabase.rpc(
          "get_protocol_game",
          {
            p_game_code: code,
          }
        );

        if (statusError) {
          throw statusError;
        }

        const gameData =
          Array.isArray(data)
            ? data[0]
            : data;

        if (!gameData || !active) {
          return;
        }

        if (
          gameData.status ===
          "calibration_ready"
        ) {
          setBothReady(true);
        }

        if (
          gameData.status ===
          "playing"
        ) {
          navigate(
            `/game/${code}/play`
          );
        }

      } catch (err) {
        console.error(
          "CALIBRATION STATUS ERROR:",
          err
        );
      }
    };

    checkStatus();

    const interval =
      window.setInterval(
        checkStatus,
        1500
      );

    return () => {
      active = false;

      window.clearInterval(
        interval
      );
    };
  }, [
    submitted,
    code,
    hasGameSession,
    navigate,
  ]);

  /* =========================================
     SUBMIT
     ========================================= */

  const submitCalibration =
    async (selectedIntensity) => {
      try {
        setSaving(true);
        setError("");

        const {
          data,
          error: rpcError,
        } = singleDevice
          ? await supabase.rpc(
              "submit_calibration_as",
              {
                p_game_code: code,
                p_player_no: turn,
                p_intensity:
                  selectedIntensity,
                p_answers: {},
              }
            )
          : await supabase.rpc(
              "submit_calibration",
              {
                p_game_code: code,
                p_intensity:
                  selectedIntensity,
                p_answers: {},
              }
            );
        if (rpcError) {
          throw rpcError;
        }

        // un seul téléphone : après le premier choix, on passe
        // le téléphone à l'autre
        if (singleDevice && turn === 1) {
          setHandoff(true);
          return;
        }

        if (!singleDevice) {
          try {
            window.localStorage.setItem(doneKey, "1");
          } catch {
            // sans stockage, l'écran redemandera simplement le choix
          }
        }

        setSubmitted(true);

        if (data?.ready) {
          setBothReady(true);
        }
      } catch (err) {
        console.error(
          "CALIBRATION SUBMIT ERROR:",
          err
        );

        setError(
          humanError(err, err?.message || "Impossible d'enregistrer tes réponses.")
        );
      } finally {
        setSaving(false);
      }
    };

  /* =========================================
     RESULTAT / ATTENTE
     ========================================= */

  if (submitted) {
    return (
      <main className="app">
        <div className="glow glow-center" />

        <header className="header">
          <span className="logo">
            PROTOCOL
          </span>

          <span className="pill">
            Privé
          </span>
        </header>

        <section className="calibration-result">
          {!bothReady ? (
            <>
              <div>
                <p className="kicker">
                  C'EST FAIT
                </p>

                <h1>
                  C'est
                  <br />
                  enregistré.
                </h1>

                <p className="intro">
                  Tes choix restent privés.
                  On attend simplement que
                  l'autre termine.
                </p>
              </div>

              <div className="waiting-partner">
                <span className="pulse-dot" />

                <div>
                  <strong>
                    On attend l'autre.
                  </strong>

                  <p>
                      PROTOCOL combinera vos réponses
                      dès que vous aurez terminé tous les deux.
                  </p>
                </div>
              </div>
            </>
          ) : (
            <>
              <div className="protocol-opening">

                <div className="protocol-opening-mark">
                  <span />
                  <p>PROTOCOL EST PRÊT</p>
                  <span />
                </div>

                <div className="protocol-opening-title">
                  <span className="protocol-opening-small">
                    CE SOIR
                  </span>

                  <h1>
                    Ne cherchez pas
                    <br />
                    à prévoir la suite.
                  </h1>
                </div>

                <div className="protocol-opening-copy">

                  <p>
                    PROTOCOL connaît maintenant
                    <br />
                    ce que vous avez choisi
                    d’explorer.
                  </p>

                  <div className="protocol-opening-divider" />

                  <p className="protocol-opening-emphasis">
                    Vos envies.
                    <br />
                    Vos limites.
                    <br />
                    Et le terrain entre les deux.
                  </p>

                  <div className="protocol-opening-divider" />

                  <p className="protocol-opening-final">
                    Certaines cartes vous feront parler.
                    <br />
                    D’autres agir.
                    <br />
                    Parfois, vous ne lirez pas
                    la même chose.
                  </p>

                </div>

                <p className="protocol-opening-whisper">
                  Laissez simplement le jeu monter.
                </p>

              </div>


              {error && (
                <p className="error">
                  {error}
                </p>
              )}


              <button
                className="primary protocol-opening-button"
                onClick={async () => {
                  try {
                    setError("");

                    const {
                      data,
                      error: startError,
                    } = await supabase.rpc(
                      "start_protocol",
                      {
                        p_game_code: code,
                      }
                    );

                    if (startError) {
                      throw startError;
                    }

                    console.log(
                      "PROTOCOL STARTED:",
                      data
                    );

                    navigate(
                      `/game/${code}/play`
                    );

                  } catch (err) {

                    console.error(
                      "START PROTOCOL ERROR:",
                      err
                    );

                    setError(
                      humanError(err, err?.message || "Impossible de démarrer la partie.")
                    );
                  }
                }}
              >
                <span>
                  Commencer
                </span>

                <span>→</span>
              </button>


              <p className="protocol-opening-safety">
                Passer, autre proposition ou STOP :
                à tout moment, sans vous justifier.
              </p>
            </>
          )}

        </section>

        <Footer />
      </main>
    );
  }

  /* =========================================
     UN SEUL TÉLÉPHONE : PASSER LA MAIN
     ========================================= */

  if (singleDevice && handoff) {
    return (
      <main className="app">
        <div className="glow glow-center" />
        <header className="header">
          <span className="logo">
            PROTOCOL
          </span>
          <span className="pill">
            Privé
          </span>
        </header>
        <section className="calibration handoff-screen">
          <div>
            <p className="kicker">
              C’EST ENREGISTRÉ
            </p>
            <h1>
              Passe le téléphone
              <br />
              à <em>{otherName}</em>.
            </h1>
            <p className="intro">
              {currentName}, ton choix reste secret.
              {" "}{otherName}, à toi de choisir, sans regarder
              ce que l’autre a fait.
            </p>
          </div>
          <button
            className="primary"
            onClick={() => {
              setTurn(2);
              setHandoff(false);
            }}
          >
            <span>
              C’est {otherName}
            </span>
            <span>→</span>
          </button>
        </section>
      </main>
    );
  }

  /* =========================================
     INTENSITÉ : Taquin, Coquin ou Indécent
     ========================================= */

  return (
    <main className="app">
      <div className="glow glow-center" />

      <header className="header">
        <span className="logo">
          PROTOCOL
        </span>

        {singleDevice ? (
          <span className="progress-label">
            {`${turn} / 2`}
          </span>
        ) : (
          <span className="pill">
            Privé
          </span>
        )}
      </header>

      <section className="question-screen">
        <div>
          <p className="kicker">
            {singleDevice && currentName
              ? `${currentName.toUpperCase()}, À TOI`
              : "INTENSITÉ"}
          </p>

          <h1>
            Ce soir,
            <br />
            tu veux quoi ?
          </h1>

          <p className="intro">
            {singleDevice && turn === 1
              ? `${otherName || "L’autre"}, ne regarde pas l’écran. `
              : ""}
            Ton humeur maintenant, pas un engagement
            pour toute la partie. Ton choix reste privé :
            PROTOCOL garde votre terrain commun.
          </p>
        </div>

        <div className="intensity-list">
          {INTENSITY_LEVELS.map(
            (level) => (
              <button
                key={level.value}
                className="calibration-option"
                disabled={saving}
                onClick={() => {
                  submitCalibration(
                    level.value
                  );
                }}
              >
                <span className="option-number">
                  0{level.rank}
                </span>

                <div>
                  <strong>
                    {level.title}
                  </strong>

                  <p>
                    {level.text}
                  </p>
                </div>

                <span className="option-arrow">
                  →
                </span>
              </button>
            )
          )}
        </div>
      </section>
    </main>
  );
}
