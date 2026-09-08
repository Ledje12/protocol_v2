import { useEffect, useState } from "react";
import { createClient } from "@supabase/supabase-js";

/* =========================================================
   SUPABASE
   ========================================================= */

const supabaseUrl =
  import.meta.env.VITE_SUPABASE_URL;

const supabaseKey =
  import.meta.env.VITE_SUPABASE_ANON_KEY ||
  import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY;

if (!supabaseUrl || !supabaseKey) {
  throw new Error(
    "Configuration Supabase manquante dans .env.local"
  );
}

/*
 * Singleton global.
 *
 * Important avec Vite/HMR :
 * App.jsx peut être réévalué plusieurs fois en développement.
 * Sans ça, chaque refresh à chaud recrée un client Supabase.
 */
const supabase =
  globalThis.__protocolSupabase ??
  createClient(
    supabaseUrl,
    supabaseKey,
    {
      auth: {
        persistSession: false,
        autoRefreshToken: false,
        detectSessionInUrl: false,
      },
    }
  );

globalThis.__protocolSupabase =
  supabase;

/* =========================================================
   HELPERS
   ========================================================= */

function generateCode() {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";

  let code = "";

  for (let i = 0; i < 6; i += 1) {
    code += chars[
      Math.floor(Math.random() * chars.length)
    ];
  }

  return code;
}

const INTENSITY_LEVELS = [
  {
    value: 1,
    title: "Doux",
    text: "Complice, léger, sans pression.",
  },
  {
    value: 2,
    title: "Curieux",
    text: "On explore un peu plus loin.",
  },
  {
    value: 3,
    title: "Joueur",
    text: "On accepte d'être surpris.",
  },
  {
    value: 4,
    title: "Intense",
    text: "On veut sentir la tension monter.",
  },
  {
    value: 5,
    title: "Sans filtre",
    text: "On ouvre franchement le terrain de jeu.",
  },
];

const CONTROL_OPTIONS = [
  {
    value: "guide",
    title: "Guider",
    text: "J'aime prendre les commandes.",
  },
  {
    value: "both",
    title: "Les deux",
    text: "Ça dépend du moment et de l'envie.",
  },
  {
    value: "follow",
    title: "Me laisser guider",
    text: "J'aime quand l'autre mène le jeu.",
  },
];

const CALIBRATION_DIMENSIONS = [
  {
    key: "tension",
    title: "Tension",
    text: "Provocation, défis et montée progressive du jeu.",
  },
  {
    key: "sensations",
    title: "Sensations",
    text: "Toucher, attente, contraintes et jeux sensoriels.",
  },
  {
    key: "unexpected",
    title: "Imprévu",
    text: "Surprise, improvisation et perte de contrôle sur la suite.",
  },
];

const PREFERENCE_LEVELS = [
  {
    value: 1,
    label: "Un peu",
  },
  {
    value: 2,
    label: "Oui",
  },
  {
    value: 3,
    label: "Beaucoup",
  },
];

function getRoute() {
  const path =
    window.location.pathname;

  if (path === "/") {
    return {
      screen: "home",
      code: null,
    };
  }

  if (path === "/join") {
    return {
      screen: "join",
      code: null,
    };
  }

  /*
   * IMPORTANT :
   * les routes les plus spécifiques
   * passent AVANT /game/:code.
   */

  const calibrationMatch =
    path.match(
      /^\/game\/([^/]+)\/calibration\/?$/
    );

  if (calibrationMatch) {
    return {
      screen: "calibration",
      code:
        calibrationMatch[1].toUpperCase(),
    };
  }

  const playMatch =
    path.match(
      /^\/game\/([^/]+)\/play\/?$/
    );

  if (playMatch) {
    return {
      screen: "play",
      code:
        playMatch[1].toUpperCase(),
    };
  }

  const gameMatch =
    path.match(
      /^\/game\/([^/]+)\/?$/
    );

  if (gameMatch) {
    return {
      screen: "lobby",
      code:
        gameMatch[1].toUpperCase(),
    };
  }

  console.warn(
    "Route inconnue:",
    path
  );

  return {
    screen: "home",
    code: null,
  };
}

/* =========================================================
   APP
   ========================================================= */

function App() {
  const [route, setRoute] =
    useState(getRoute());

  const navigate = (
    path,
    replace = false
  ) => {
    if (replace) {
      window.history.replaceState(
        {},
        "",
        path
      );
    } else {
      window.history.pushState(
        {},
        "",
        path
      );
    }

    setRoute(getRoute());
  };

  useEffect(() => {
    const handlePopState = () => {
      setRoute(getRoute());
    };

    window.addEventListener(
      "popstate",
      handlePopState
    );

    return () => {
      window.removeEventListener(
        "popstate",
        handlePopState
      );
    };
  }, []);

  if (route.screen === "join") {
    return (
      <JoinScreen
        navigate={navigate}
      />
    );
  }

  if (route.screen === "lobby") {
    return (
      <LobbyScreen
        code={route.code}
        navigate={navigate}
      />
    );
  }

  if (
    route.screen ===
    "calibration"
  ) {
    return (
      <CalibrationScreen
        code={route.code}
        navigate={navigate}
      />
    );
  }

  if (route.screen === "play") {
    return (
      <PlayScreen
        code={route.code}
        navigate={navigate}
      />
    );
  }

  return (
    <HomeScreen
      navigate={navigate}
    />
  );
}

/* =========================================================
   HOME
   ========================================================= */

function HomeScreen({ navigate }) {
  const [loading, setLoading] =
    useState(false);

  const [error, setError] =
    useState("");

  const createGame = async () => {
    try {
      setLoading(true);
      setError("");

      let createdGame = null;

      for (
        let attempt = 0;
        attempt < 5;
        attempt += 1
      ) {
        const code = generateCode();

        const {
          data,
          error: insertError,
        } = await supabase
          .from("games")
          .insert({
            code,
            player_count: 1,
            status: "waiting",
            player_1_ready: false,
            player_2_ready: false,
          })
          .select()
          .single();

        if (!insertError) {
          createdGame = data;
          break;
        }

        if (insertError.code !== "23505") {
          throw insertError;
        }
      }

      if (!createdGame) {
        throw new Error(
          "Impossible de créer une partie."
        );
      }

      sessionStorage.setItem(
        `protocol-player-${createdGame.code}`,
        "1"
      );

      navigate(
        `/game/${createdGame.code}`
      );
    } catch (err) {
      console.error(
        "CREATE GAME ERROR:",
        err
      );

      setError(
        err?.message ||
          "Impossible de créer la partie."
      );
    } finally {
      setLoading(false);
    }
  };

  return (
    <main className="app">
      <div className="glow glow-top" />

      <header className="header">
        <span className="logo">
          PROTOCOL
        </span>

        <span className="for-two">
          for two
        </span>
      </header>

      <section className="home">
        <div>
          <p className="kicker">
            UNE EXPÉRIENCE À DEUX
          </p>

          <h1>
            Jusqu’où
            <br />
            irez-vous ?
          </h1>

          <p className="intro">
            Un jeu privé qui s’adapte à
            vos envies, vos limites et à
            ce que vous êtes prêts à
            découvrir ensemble.
          </p>
        </div>

        <div className="actions">
          {error && (
            <p className="error">
              {error}
            </p>
          )}

          <button
            className="primary"
            onClick={createGame}
            disabled={loading}
          >
            <span>
              {loading
                ? "Création…"
                : "Créer une partie"}
            </span>

            <span>→</span>
          </button>

          <button
            className="secondary"
            onClick={() =>
              navigate("/join")
            }
          >
            <span>
              Rejoindre une partie
            </span>

            <span>→</span>
          </button>
        </div>
      </section>

      <Footer />
    </main>
  );
}

/* =========================================================
   JOIN
   ========================================================= */

function JoinScreen({ navigate }) {
  const [code, setCode] =
    useState("");

  const [loading, setLoading] =
    useState(false);

  const [error, setError] =
    useState("");

  const joinGame = async (event) => {
    event.preventDefault();

    if (code.length !== 6) {
      return;
    }

    try {
      setLoading(true);
      setError("");

      const normalized =
        code.toUpperCase();

      const {
        data: game,
        error: findError,
      } = await supabase
        .from("games")
        .select("*")
        .eq("code", normalized)
        .maybeSingle();

      if (findError) {
        throw findError;
      }

      if (!game) {
        throw new Error(
          "Ce code n'existe pas."
        );
      }

      if (game.player_count >= 2) {
        throw new Error(
          "Cette partie est déjà complète."
        );
      }

      const {
        data: updatedGame,
        error: updateError,
      } = await supabase
        .from("games")
        .update({
          player_count: 2,
          status: "ready",
        })
        .eq("id", game.id)
        .eq("player_count", 1)
        .select()
        .maybeSingle();

      if (updateError) {
        throw updateError;
      }

      if (!updatedGame) {
        throw new Error(
          "La partie vient d'être rejointe."
        );
      }

      sessionStorage.setItem(
        `protocol-player-${normalized}`,
        "2"
      );

      navigate(
        `/game/${normalized}`
      );
    } catch (err) {
      console.error(
        "JOIN ERROR:",
        err
      );

      setError(
        err?.message ||
          "Impossible de rejoindre."
      );
    } finally {
      setLoading(false);
    }
  };

  return (
    <main className="app">
      <div className="glow glow-top" />

      <header className="header">
        <button
          className="back"
          onClick={() => navigate("/")}
        >
          ←
        </button>

        <span className="logo">
          PROTOCOL
        </span>
      </header>

      <section className="join">
        <div>
          <p className="kicker">
            REJOINDRE
          </p>

          <h1>
            Entre
            <br />
            le code.
          </h1>

          <p className="intro">
            Le code à six caractères est
            affiché sur le téléphone de
            ton partenaire.
          </p>
        </div>

        <form
          className="join-form"
          onSubmit={joinGame}
        >
          <input
            value={code}
            onChange={(event) => {
              setCode(
                event.target.value
                  .toUpperCase()
                  .replace(
                    /[^A-Z0-9]/g,
                    ""
                  )
                  .slice(0, 6)
              );

              setError("");
            }}
            placeholder="XXXXXX"
            autoFocus
          />

          {error && (
            <p className="error">
              {error}
            </p>
          )}

          <button
            className="primary"
            disabled={
              code.length !== 6 ||
              loading
            }
          >
            <span>
              {loading
                ? "Connexion…"
                : "Entrer"}
            </span>

            <span>→</span>
          </button>
        </form>
      </section>

      <Footer />
    </main>
  );
}

/* =========================================================
   LOBBY
   ========================================================= */

function LobbyScreen({
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

  const playerNumber = Number(
    sessionStorage.getItem(
      `protocol-player-${code}`
    )
  );

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
    const {
      data,
      error: loadError,
    } = await supabase
      .from("games")
      .select("*")
      .eq("code", code)
      .maybeSingle();

    if (loadError) {
      throw loadError;
    }

    if (!data) {
      throw new Error(
        "Partie introuvable."
      );
    }

    processGame(data);

    return data;
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
     * Realtime = confort.
     */
    const channel = supabase
      .channel(`protocol-${code}`)
      .on(
        "postgres_changes",
        {
          event: "UPDATE",
          schema: "public",
          table: "games",
          filter: `code=eq.${code}`,
        },
        (payload) => {
          if (active) {
            processGame(
              payload.new
            );
          }
        }
      )
      .subscribe();

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

      supabase.removeChannel(
        channel
      );
    };
  }, [code]);

  const setReady = async () => {
    if (
      !game ||
      readyLoading
    ) {
      return;
    }

    try {
      setReadyLoading(true);
      setError("");

      const field =
        playerNumber === 1
          ? "player_1_ready"
          : "player_2_ready";

      const {
        data: readyGame,
        error: readyError,
      } = await supabase
        .from("games")
        .update({
          [field]: true,
        })
        .eq("id", game.id)
        .select()
        .single();

      if (readyError) {
        throw readyError;
      }

      setGame(readyGame);

      /*
       * Si les deux sont prêts,
       * on démarre.
       */
      if (
        readyGame.player_1_ready &&
        readyGame.player_2_ready
      ) {
        const {
          data: startedGame,
          error: startError,
        } = await supabase
          .from("games")
          .update({
            status:
              "calibrating",
          })
          .eq("id", game.id)
          .eq(
            "player_1_ready",
            true
          )
          .eq(
            "player_2_ready",
            true
          )
          .select()
          .single();

        if (startError) {
          throw startError;
        }

        processGame(
          startedGame
        );
      }
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
      <main className="app center">
        <p>{error}</p>

        <button
          className="secondary"
          onClick={() =>
            navigate("/")
          }
        >
          Retour
        </button>
      </main>
    );
  }

  if (
    ![1, 2].includes(
      playerNumber
    )
  ) {
    return (
      <main className="app center">
        <p>
          Ce téléphone n'est pas
          associé à cette partie.
        </p>

        <button
          className="secondary"
          onClick={() =>
            navigate("/")
          }
        >
          Retour
        </button>
      </main>
    );
  }

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
          Joueur {playerNumber}
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
              ? "Votre partenaire a rejoint la partie."
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

/* =========================================================
   CALIBRATION INTRO
   ========================================================= */

function CalibrationScreen({
  code,
  navigate,
}) {
  const playerNumber = Number(
    sessionStorage.getItem(
      `protocol-player-${code}`
    )
  );

  const [stage, setStage] =
    useState("intro");

  const [intensity, setIntensity] =
    useState(null);

  const [answers, setAnswers] =
    useState({});

  const [dimensionIndex, setDimensionIndex] =
    useState(0);

  const [submitted, setSubmitted] =
    useState(false);

  const [bothReady, setBothReady] =
    useState(false);

  const [saving, setSaving] =
    useState(false);

  const [error, setError] =
    useState("");

  const currentDimension =
    CALIBRATION_DIMENSIONS[
      dimensionIndex
    ];

  /* =========================================
     ATTENTE PARTENAIRE
     ========================================= */

  useEffect(() => {
    if (!submitted) {
      return;
    }

    let active = true;

    const checkStatus = async () => {
      try {
        const {
          data,
          error: statusError,
        } = await supabase
          .from("games")
          .select("status")
          .eq("code", code)
          .single();

        if (statusError) {
          throw statusError;
        }

        if (!active) {
          return;
        }

        if (
          data.status ===
            "calibration_ready"
        ) {
          setBothReady(true);
        }

        if (
          data.status ===
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

    const channel = supabase
      .channel(`calibration-${code}`)
      .on(
        "postgres_changes",
        {
          event: "UPDATE",
          schema: "public",
          table: "games",
          filter: `code=eq.${code}`,
        },
        (payload) => {
          if (
            payload.new.status ===
              "calibration_ready"
          ) {
            setBothReady(true);
          }

          if (
            payload.new.status ===
              "playing"
          ) {
            navigate(
              `/game/${code}/play`
            );
          }
        }
      )
      .subscribe();

    return () => {
      active = false;

      window.clearInterval(
        interval
      );

      supabase.removeChannel(
        channel
      );
    };
  }, [submitted, code]);

  /* =========================================
     CHOIX CONTROLE
     ========================================= */

  const selectControl = (
    value
  ) => {
    setAnswers({
      ...answers,
      control: value,
    });

    setStage("preferences");
  };

  /* =========================================
     CHOIX TENSION / SENSATIONS / IMPREVU
     ========================================= */

  const selectPreference = (
    value
  ) => {
    const updatedAnswers = {
      ...answers,
      [currentDimension.key]:
        value,
    };

    setAnswers(
      updatedAnswers
    );

    if (
      dimensionIndex <
      CALIBRATION_DIMENSIONS.length -
        1
    ) {
      setDimensionIndex(
        dimensionIndex + 1
      );

      return;
    }

    submitCalibration(
      updatedAnswers
    );
  };

  /* =========================================
     SUBMIT
     ========================================= */

  const submitCalibration =
    async (finalAnswers) => {
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
            p_player_no:
              playerNumber,
            p_intensity:
              intensity,
            p_answers:
              finalAnswers,
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
                    Votre terrain commun
                    sera créé automatiquement.
                  </p>
                </div>
              </div>
            </>
          ) : (
            <>
              <div>
                <p className="kicker">
                  VOUS ÊTES ALIGNÉS
                </p>

                <h1>
                  On peut
                  <br />
                  commencer.
                </h1>

                <p className="intro">
                  PROTOCOL connaît maintenant
                  le terrain sur lequel vous
                  pouvez jouer tous les deux.
                </p>
              </div>

              <div className="shared-ready">
                <span>✓</span>

                <div>
                  <strong>
                    Profil commun créé
                  </strong>

                  <p>
                    Vos réponses individuelles
                    restent privées.
                  </p>
                </div>
              </div>

              <button
                className="primary"
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
                  Entrer dans PROTOCOL
                </span>

                <span>→</span>
              </button>
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
              Quelques choix rapides.
              Réponds pour toi, pas pour
              deviner ce que l'autre veut.
            </p>

            <div className="privacy">
              <span className="privacy-dot">
                ◦
              </span>

              <div>
                <strong>
                  Tes réponses restent privées.
                </strong>

                <p>
                  Seul votre terrain commun
                  sera utilisé par le jeu.
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
            01 / 05
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
                  onClick={() => {
                    setIntensity(
                      level.value
                    );

                    setStage(
                      "control"
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

  /* =========================================
     2 / 5 - CONTROLE
     ========================================= */

  if (stage === "control") {
    return (
      <main className="app">
        <div className="glow glow-bottom" />

        <header className="header">
          <span className="logo">
            PROTOCOL
          </span>

          <span className="progress-label">
            02 / 05
          </span>
        </header>

        <section className="question-screen dimension-screen">
          <div>
            <p className="kicker">
              CONTRÔLE
            </p>

            <h1>
              Dans quel
              <br />
              rôle ?
            </h1>

            <p className="intro">
              Ce qui t'attire le plus
              ce soir.
            </p>
          </div>

          <div className="control-options">
            {CONTROL_OPTIONS.map(
              (option) => (
                <button
                  key={
                    option.value
                  }
                  className="control-button"
                  onClick={() =>
                    selectControl(
                      option.value
                    )
                  }
                >
                  <div>
                    <strong>
                      {option.title}
                    </strong>

                    <p>
                      {option.text}
                    </p>
                  </div>

                  <span>→</span>
                </button>
              )
            )}
          </div>

          <div className="question-progress">
            <div
              style={{
                width: "40%",
              }}
            />
          </div>
        </section>
      </main>
    );
  }

  /* =========================================
     3-5 / 5
     ========================================= */

  const progress =
    dimensionIndex + 3;

  return (
    <main className="app">
      <div className="glow glow-bottom" />

      <header className="header">
        <span className="logo">
          PROTOCOL
        </span>

        <span className="progress-label">
          0{progress} / 05
        </span>
      </header>

      <section className="question-screen dimension-screen">
        <div>
          <p className="kicker">
            TON TERRAIN
          </p>

          <h1>
            {currentDimension.title}
          </h1>

          <p className="intro">
            {currentDimension.text}
          </p>
        </div>

        <div className="preference-options">
          {PREFERENCE_LEVELS.map(
            (option) => (
              <button
                key={
                  option.value
                }
                className="preference-button"
                onClick={() =>
                  selectPreference(
                    option.value
                  )
                }
                disabled={saving}
              >
                <span className="preference-orb" />

                <span>
                  {option.label}
                </span>
              </button>
            )
          )}
        </div>

        {error && (
          <p className="error">
            {error}
          </p>
        )}

        <div className="question-progress">
          <div
            style={{
              width: `${
                (progress / 5) *
                100
              }%`,
            }}
          />
        </div>
      </section>
    </main>
  );
}

/* =========================================================
   PLAY
   ========================================================= */


function PlayScreen({
  code,
  navigate,
}) {
  const playerNumber = Number(
    sessionStorage.getItem(
      `protocol-player-${code}`
    )
  );

  const [game, setGame] =
    useState(null);

  const [card, setCard] =
    useState(null);

  const [loading, setLoading] =
    useState(true);

  const [nextLoading, setNextLoading] =
    useState(false);

  const [error, setError] =
    useState("");

  const loadState = async () => {
    const {
      data: gameData,
      error: gameError,
    } = await supabase
      .from("games")
      .select(`
        id,
        code,
        status,
        turn_no,
        active_player,
        current_card_id
      `)
      .eq("code", code)
      .single();

    if (gameError) {
      throw gameError;
    }

    if (
      gameData.status !==
      "playing"
    ) {
      return;
    }

    const {
      data: cardData,
      error: cardError,
    } = await supabase
      .from("protocol_cards")
      .select("*")
      .eq(
        "id",
        gameData.current_card_id
      )
      .single();

    if (cardError) {
      throw cardError;
    }

    setGame(gameData);
    setCard(cardData);
  };

  useEffect(() => {
    let active = true;

    const initialise =
      async () => {
        try {
          await loadState();
        } catch (err) {
          console.error(
            "PLAY LOAD ERROR:",
            err
          );

          if (active) {
            setError(
              "Impossible de charger la partie."
            );
          }
        } finally {
          if (active) {
            setLoading(false);
          }
        }
      };

    initialise();

    const channel = supabase
      .channel(
        `play-${code}`
      )
      .on(
        "postgres_changes",
        {
          event: "UPDATE",
          schema: "public",
          table: "games",
          filter:
            `code=eq.${code}`,
        },
        async () => {
          if (!active) {
            return;
          }

          try {
            await loadState();
          } catch (err) {
            console.error(err);
          }
        }
      )
      .subscribe();

    const polling =
      window.setInterval(
        async () => {
          if (!active) {
            return;
          }

          try {
            await loadState();
          } catch {
            // Realtime + polling :
            // on ne bloque pas le jeu
            // pour une erreur transitoire.
          }
        },
        1500
      );

    return () => {
      active = false;

      window.clearInterval(
        polling
      );

      supabase.removeChannel(
        channel
      );
    };
  }, [code]);

  const nextCard = async () => {
    try {
      setNextLoading(true);
      setError("");

      const {
        error: rpcError,
      } = await supabase.rpc(
        "next_protocol_card",
        {
          p_game_code: code,
        }
      );

      if (rpcError) {
        throw rpcError;
      }

      await loadState();
    } catch (err) {
      console.error(
        "NEXT CARD ERROR:",
        err
      );

      setError(
        err?.message ||
          "Impossible de continuer."
      );
    } finally {
      setNextLoading(false);
    }
  };

  if (loading) {
    return (
      <LoadingScreen />
    );
  }

  if (!game || !card) {
    return (
      <main className="app center">
        <p>
          {error ||
            "Partie introuvable."}
        </p>

        <button
          className="secondary"
          onClick={() =>
            navigate("/")
          }
        >
          Retour
        </button>
      </main>
    );
  }

  const isMyTurn =
    game.active_player ===
    playerNumber;

  const typeLabels = {
    truth: "VÉRITÉ",
    action: "ACTION",
    duel: "DUEL",
    scene: "SCÈNE",
  };

  return (
    <main className="app play-page">
      <div className="glow glow-center" />

      <header className="header">
        <span className="logo">
          PROTOCOL
        </span>

        <span className="progress-label">
          {String(
            game.turn_no
          ).padStart(2, "0")}
        </span>
      </header>

      <section className="play">
        <div className="play-meta">
          <span
            className={`card-type card-type-${card.type}`}
          >
            {typeLabels[
              card.type
            ]}
          </span>

          <span>
            {isMyTurn
              ? "À TOI"
              : `JOUEUR ${game.active_player}`}
          </span>
        </div>

        <div className="game-card">
          {card.title && (
            <p className="kicker">
              {card.title.toUpperCase()}
            </p>
          )}

          <p className="card-prompt">
            {card.prompt}
          </p>
        </div>

        <div className="play-bottom">
          {isMyTurn ? (
            <button
              className="primary"
              onClick={
                nextCard
              }
              disabled={
                nextLoading
              }
            >
              <span>
                {nextLoading
                  ? "Un instant…"
                  : "C'est fait"}
              </span>

              <span>→</span>
            </button>
          ) : (
            <div className="waiting-turn">
              <span className="pulse-dot" />

              <div>
                <strong>
                  À l'autre de jouer.
                </strong>

                <p>
                  La prochaine carte
                  apparaîtra automatiquement.
                </p>
              </div>
            </div>
          )}

          {error && (
            <p className="error">
              {error}
            </p>
          )}
        </div>
      </section>

      <Footer />
    </main>
  );
}

/* =========================================================
   COMPONENTS
   ========================================================= */

function Footer() {
  return (
    <footer className="footer">
      <span>
        Session privée
      </span>

      <span>
        Pour adultes consentants
      </span>
    </footer>
  );
}

function LoadingScreen() {
  return (
    <main className="app center">
      <span className="loading">
        Préparation…
      </span>
    </main>
  );
}

export default App;