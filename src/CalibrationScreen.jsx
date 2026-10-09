import { useEffect, useState } from "react";
import Footer from "./Footer.jsx";
import { INTENSITY_LEVELS } from "./gameConstants.js";
import { getGameSession } from "./gameSession.js";
import { supabase } from "./supabaseClient.js";

/* =========================================================
   CALIBRATION INTRO
   ========================================================= */

export default function CalibrationScreen({
  code,
  navigate,
}) {
  const {
    playerNumber,
    valid: hasGameSession,
  } = getGameSession(code);

  const [stage, setStage] =
    useState("intro");
    
  const [submitted, setSubmitted] =
    useState(false);

  const [bothReady, setBothReady] =
    useState(false);

  const [saving, setSaving] =
    useState(false);

  const [error, setError] =
    useState("");


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
        } = await supabase.rpc(
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
          err?.message ||
            "Impossible d'enregistrer tes réponses."
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
                      err?.message ||
                        "Impossible de démarrer la partie."
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
     INTRO
     ========================================= */

  if (stage === "intro") {
    return (
      <main className="app">
        <div className="glow glow-bottom" />

        <header className="header">
          <span className="logo">
            PROTOCOL
          </span>

          <span className="pill">
            Privé
          </span>
        </header>

        <section className="calibration">
          <div>
            <p className="kicker">
              JUSTE ENTRE NOUS
            </p>

            <h1>
              Ce que
              <br />
              tu veux.
            </h1>

            <p className="intro">
              Un choix rapide.
              Réponds pour toi, pas pour
              deviner ce que l'autre veut.
            </p>

            <div className="privacy">
              <span className="privacy-dot">
                ◦
              </span>

              <div>
                <strong>
                  Ton choix reste privé.
                </strong>

                <p>
                      PROTOCOL combine vos réponses
                      sans les révéler à l’autre.
                      Votre terrain commun guidera
                      ensuite la partie.
                </p>
              </div>
            </div>
          </div>

          <button
            className="primary"
            onClick={() =>
              setStage("intensity")
            }
          >
            <span>
              Commencer
            </span>

            <span>→</span>
          </button>
        </section>
      </main>
    );
  }

  /* =========================================
     1 / 5 - INTENSITE
     ========================================= */

  if (stage === "intensity") {
    return (
      <main className="app">
        <div className="glow glow-center" />

        <header className="header">
          <span className="logo">
            PROTOCOL
          </span>

          <span className="progress-label">
            01 / 01
          </span>
        </header>

        <section className="question-screen">
          <div>
            <p className="kicker">
              INTENSITÉ
            </p>

            <h1>
              Ce soir,
              <br />
              tu veux quoi ?
            </h1>

            <p className="intro">
              Ton humeur maintenant.
              Pas un engagement pour
              toute la partie.
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
                    0{level.value}
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
}
