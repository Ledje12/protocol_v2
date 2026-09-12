import { useEffect, useState } from "react";
import { createClient } from "@supabase/supabase-js";
import "./notifications.css";
import {
  getCurrentPushSubscription,
  getPushOwner,
  registerPushNotifications,
} from "./pushNotifications.js";

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

  if (path === "/settings") {
    return {
      screen: "settings",
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

  const identityMatch =
    path.match(
      /^\/game\/([^/]+)\/identity\/?$/
    );

  if (identityMatch) {
    return {
      screen: "identity",
      code:
        identityMatch[1].toUpperCase(),
    };
  }

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

  if (route.screen === "settings") {
    return (
      <SettingsScreen
        navigate={navigate}
      />
    );
  }

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
    "identity"
  ) {
    return (
      <IdentityScreen
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

  const [inviteLoading, setInviteLoading] =
    useState(false);

  const [inviteMessage, setInviteMessage] =
    useState("");

  const sendInvitation = async () => {
    const sender = getPushOwner();

    if (!sender) {
      setInviteMessage(
        "Enregistre d’abord cet appareil dans les réglages."
      );
      return;
    }

    try {
      setInviteLoading(true);
      setInviteMessage("");

      const {
        data,
        error: functionError,
      } = await supabase.functions.invoke(
        "send-invitation",
        {
          body: {
            sender,
          },
        }
      );

      if (functionError) {
        throw functionError;
      }

      if (!data?.success) {
        throw new Error(
          data?.error ||
          "Impossible d’envoyer l’invitation."
        );
      }

      setInviteMessage(
        sender === "jerome"
          ? "Signal envoyé à Audrey."
          : "Signal envoyé à Jérôme."
      );
    } catch (err) {
      console.error(
        "SEND INVITATION ERROR:",
        err
      );

      setInviteMessage(
        err?.message ||
        "Impossible d’envoyer l’invitation."
      );
    } finally {
      setInviteLoading(false);
    }
  };

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
        `/game/${createdGame.code}/identity`
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

        <button
          type="button"
          className="settings-trigger"
          onClick={() => navigate("/settings")}
          aria-label="Réglages"
        >
          <span aria-hidden="true">⌁</span>
        </button>
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

          {inviteMessage && (
            <p className="small-text">
              {inviteMessage}
            </p>
          )}

          <button
            type="button"
            className="secondary"
            onClick={sendInvitation}
            disabled={inviteLoading}
          >
            <span>
              {inviteLoading
                ? "Envoi…"
                : "On joue ce soir ?"}
            </span>

            <span>♡</span>
          </button>

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
   SETTINGS
   ========================================================= */

function SettingsScreen({ navigate }) {
  const [permission, setPermission] =
    useState(() => {
      if (!("Notification" in window)) {
        return "unsupported";
      }

      return Notification.permission;
    });

  const [owner, setOwner] =
    useState(() => getPushOwner());

  const [subscribed, setSubscribed] =
    useState(false);

  const [checkingSubscription, setCheckingSubscription] =
    useState(true);

  const [requesting, setRequesting] =
    useState(false);

  const [message, setMessage] =
    useState("");

  const isStandalone =
    window.matchMedia?.(
      "(display-mode: standalone)"
    )?.matches ||
    window.navigator.standalone === true;

  useEffect(() => {
    let active = true;

    const checkSubscription = async () => {
      if (
        !("Notification" in window) ||
        Notification.permission !== "granted"
      ) {
        if (active) {
          setSubscribed(false);
          setCheckingSubscription(false);
        }

        return;
      }

      try {
        const subscription =
          await getCurrentPushSubscription();

        if (active) {
          setSubscribed(
            Boolean(subscription) &&
            Boolean(getPushOwner())
          );
        }
      } catch (err) {
        console.error(
          "PUSH SUBSCRIPTION CHECK ERROR:",
          err
        );

        if (active) {
          setSubscribed(false);
        }
      } finally {
        if (active) {
          setCheckingSubscription(false);
        }
      }
    };

    checkSubscription();

    return () => {
      active = false;
    };
  }, []);

  const activatePushNotifications =
    async () => {
      if (!("Notification" in window)) {
        setPermission("unsupported");
        return;
      }

      if (!owner) {
        setMessage(
          "Choisis d’abord à qui appartient cet appareil."
        );
        return;
      }

      try {
        setRequesting(true);
        setMessage("");

        const result =
          await registerPushNotifications({
            ownerKey: owner,
            supabaseClient: supabase,
          });

        setPermission(Notification.permission);
        setSubscribed(Boolean(result?.subscription));

        setMessage(
          owner === "jerome"
            ? "Cet iPhone est enregistré pour Jérôme."
            : "Cet iPhone est enregistré pour Audrey."
        );
      } catch (err) {
        console.error(
          "PUSH ACTIVATION ERROR:",
          err
        );

        if (
          "Notification" in window
        ) {
          setPermission(
            Notification.permission
          );
        }

        setMessage(
          err?.message ||
          "Impossible d’activer les notifications sur cet appareil."
        );
      } finally {
        setRequesting(false);
      }
    };

  const status =
    permission === "granted" &&
    subscribed
      ? {
          label: "ACTIVES",
          title: "Tu ne manqueras rien.",
          text:
            "Cet appareil est enregistré et peut recevoir les invitations PROTOCOL.",
          className: "is-on",
        }
      : permission === "granted"
        ? {
            label: "À FINALISER",
            title: "Encore une seconde.",
            text:
              "iOS autorise déjà les notifications. Il reste à enregistrer cet appareil dans PROTOCOL.",
            className: "",
          }
        : permission === "denied"
          ? {
              label: "BLOQUÉES",
              title: "iOS garde la porte fermée.",
              text:
                "Les notifications ont été refusées. Elles peuvent être réactivées depuis les réglages de l’iPhone.",
              className: "is-off",
            }
          : permission === "unsupported"
            ? {
                label: "INDISPONIBLE",
                title: "Pas sur cet appareil.",
                text:
                  "Ce navigateur ne permet pas d’utiliser les notifications PROTOCOL.",
                className: "is-off",
              }
            : {
                label: "DÉSACTIVÉES",
                title: "Un signe. Au bon moment.",
                text:
                  "Autorise PROTOCOL à t’envoyer une invitation ou un signal discret lorsque l’autre a envie de jouer.",
                className: "",
              };

  return (
    <main className="app protocol-settings-page">
      <div className="glow glow-center" />

      <header className="header">
        <button
          className="back"
          onClick={() => navigate("/")}
          aria-label="Retour"
        >
          ←
        </button>

        <span className="logo">
          PROTOCOL
        </span>

        <span className="settings-header-dot">
          •
        </span>
      </header>

      <section className="protocol-settings">
        <div className="protocol-settings-intro">
          <p className="kicker">
            RÉGLAGES
          </p>

          <h1>
            Restez
            <br />
            connectés.
          </h1>

          <p className="intro">
            Quelques signaux seulement.
            <br />
            Jamais de bruit inutile.
          </p>
        </div>

        <div
          className={
            `notification-card ${status.className}`
          }
        >
          <div className="notification-card-top">
            <div className="notification-orb">
              <span />
            </div>

            <span className="notification-status">
              {checkingSubscription
                ? "VÉRIFICATION"
                : status.label}
            </span>
          </div>

          <div className="notification-card-copy">
            <span className="notification-eyebrow">
              NOTIFICATIONS
            </span>

            <h2>
              {checkingSubscription
                ? "On vérifie cet appareil."
                : status.title}
            </h2>

            <p>
              {checkingSubscription
                ? "PROTOCOL vérifie si cet iPhone possède déjà un abonnement Push."
                : status.text}
            </p>
          </div>

          {!isStandalone &&
            permission !== "granted" && (
              <p className="notification-hint">
                Sur iPhone, ouvre PROTOCOL depuis
                l’icône ajoutée à l’écran d’accueil.
              </p>
            )}

{permission !== "unsupported" &&
  permission !== "denied" && (
    <div className="device-owner-section">
      <span className="notification-eyebrow device-owner-label">
        CET APPAREIL APPARTIENT À
      </span>

      <div className="device-owner-selector">
        <button
          type="button"
          className={`device-owner-button ${
            owner === "jerome" ? "active" : ""
          }`}
          onClick={() => {
            if (owner !== "jerome") {
              setSubscribed(false);
            }

            setOwner("jerome");
            setMessage("");
          }}
          aria-pressed={owner === "jerome"}
        >
          Jérôme
        </button>

        <button
          type="button"
          className={`device-owner-button ${
            owner === "audrey" ? "active" : ""
          }`}
          onClick={() => {
            if (owner !== "audrey") {
              setSubscribed(false);
            }

            setOwner("audrey");
            setMessage("");
          }}
          aria-pressed={owner === "audrey"}
        >
          Audrey
        </button>
      </div>
    </div>
  )}

          {message && (
            <p className="notification-message">
              {message}
            </p>
          )}

          {permission !== "unsupported" &&
            permission !== "denied" &&
            !subscribed &&
            !checkingSubscription && (
              <button
                type="button"
                className="notification-enable"
                onClick={activatePushNotifications}
                disabled={
                  requesting ||
                  !owner
                }
              >
                <span>
                  {requesting
                    ? "Enregistrement…"
                    : permission === "granted"
                      ? "Enregistrer cet appareil"
                      : "Activer les notifications"}
                </span>

                <span className="notification-arrow">
                  →
                </span>
              </button>
            )}

          {permission === "granted" &&
            subscribed && (
              <div className="notification-enabled">
                <span className="notification-check">
                  ✓
                </span>

                <div>
                  <strong>
                    Notifications activées
                  </strong>

                  <span>
                    {owner === "jerome"
                      ? "Appareil de Jérôme"
                      : owner === "audrey"
                        ? "Appareil d’Audrey"
                        : "Cet appareil est prêt."}
                  </span>
                </div>
              </div>
            )}
        </div>

        <p className="settings-privacy">
          Le contenu sensible ne sera pas affiché
          dans les notifications.
        </p>
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
      `/game/${normalized}/identity`
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
   IDENTITY
   ========================================================= */

  function IdentityScreen({
    code,
    navigate,
  }) {
    const playerNumber = Number(
      sessionStorage.getItem(
        `protocol-player-${code}`
      )
    );

    const [name, setName] =
      useState("");

    const [sex, setSex] =
      useState(null);

    const [loading, setLoading] =
      useState(false);

    const [initialLoading, setInitialLoading] =
      useState(true);

    const [error, setError] =
      useState("");

    useEffect(() => {
      let active = true;

      const loadIdentity =
        async () => {
          try {
            const {
              data,
              error: loadError,
            } = await supabase
              .from("games")
              .select(`
                player_1_name,
                player_1_sex,
                player_2_name,
                player_2_sex
              `)
              .eq("code", code)
              .single();

            if (loadError) {
              throw loadError;
            }

            if (!active) {
              return;
            }

            if (playerNumber === 1) {
              setName(
                data.player_1_name || ""
              );

              setSex(
                data.player_1_sex || null
              );
            } else {
              setName(
                data.player_2_name || ""
              );

              setSex(
                data.player_2_sex || null
              );
            }

          } catch (err) {
            console.error(
              "IDENTITY LOAD ERROR:",
              err
            );

            if (active) {
              setError(
                "Impossible de charger la partie."
              );
            }

          } finally {
            if (active) {
              setInitialLoading(false);
            }
          }
        };

      loadIdentity();

      return () => {
        active = false;
      };

    }, [code, playerNumber]);


    const saveIdentity =
      async () => {
        const cleanName =
          name.trim();

        if (
          cleanName.length < 1 ||
          !sex
        ) {
          return;
        }

        try {
          setLoading(true);
          setError("");

          const updates =
            playerNumber === 1
              ? {
                  player_1_name:
                    cleanName,

                  player_1_sex:
                    sex,
                }
              : {
                  player_2_name:
                    cleanName,

                  player_2_sex:
                    sex,
                };

          const {
            error: updateError,
          } = await supabase
            .from("games")
            .update(updates)
            .eq("code", code);

          if (updateError) {
            throw updateError;
          }

          navigate(
            `/game/${code}`
          );

        } catch (err) {
          console.error(
            "IDENTITY SAVE ERROR:",
            err
          );

          setError(
            err?.message ||
              "Impossible d'enregistrer."
          );

        } finally {
          setLoading(false);
        }
      };


    if (initialLoading) {
      return (
        <LoadingScreen />
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


    return (
      <main className="app identity-page">
        <div className="glow glow-center" />

        <header className="header">
          <span className="logo">
            PROTOCOL
          </span>

          <span className="pill">
            Ce soir
          </span>
        </header>

        <section className="identity">

          <div>
            <p className="kicker">
              TON IDENTITÉ
            </p>

            <h1>
              Comment
              <br />
              t'appeler ?
            </h1>

            <p className="intro">
              Ton prénom, un surnom ou
              simplement celui que tu veux
              entendre ce soir.
            </p>
          </div>


          <div className="identity-form">

            <label className="identity-name">

              <span>
                NOM DE SESSION
              </span>

              <input
                type="text"
                value={name}
                onChange={(event) => {
                  setName(
                    event.target.value
                      .slice(0, 24)
                  );

                  setError("");
                }}
                placeholder="Ton nom ce soir"
                autoFocus
                autoComplete="off"
              />

            </label>


            <div className="identity-symbols">

              <button
                type="button"
                className={
                  sex === "female"
                    ? "identity-symbol selected"
                    : "identity-symbol"
                }
                onClick={() => {
                  setSex("female");
                  setError("");
                }}
                aria-label="Femme"
              >
                ♀
              </button>


              <button
                type="button"
                className={
                  sex === "male"
                    ? "identity-symbol selected"
                    : "identity-symbol"
                }
                onClick={() => {
                  setSex("male");
                  setError("");
                }}
                aria-label="Homme"
              >
                ♂
              </button>

            </div>


            {error && (
              <p className="error">
                {error}
              </p>
            )}


            <button
              className="primary"
              onClick={saveIdentity}
              disabled={
                loading ||
                !name.trim() ||
                !sex
              }
            >
              <span>
                {loading
                  ? "Un instant…"
                  : "Continuer"}
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
                  COMMENCER
                </span>

                <span>→</span>
              </button>


              <p className="protocol-opening-safety">
                PASS · AUTRE PROPOSITION · STOP
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

  const [sceneState, setSceneState] =
    useState(null);

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

  const [
    showTypePicker,
    setShowTypePicker,
  ] = useState(false);

  const [
    showBonuses,
    setShowBonuses,
  ] = useState(false);

  const [activeRules, setActiveRules] =
    useState([]);

    async function loadSceneState(
    currentCard
    ) {
      if (
        !currentCard ||
        currentCard.type !== "scene" ||
        !playerNumber
      ) {
        setSceneState(null);
        return;
      }

      const {
        data,
        error,
      } = await supabase.rpc(
        "get_scene_state",
        {
          p_game_code: code,
          p_player_no: playerNumber,
        }
      );

      if (error) {
        console.error(
          "Erreur scene:",
          error
        );

        setSceneState(null);

        return;
      }

      if (!data?.is_multistep) {
        setSceneState(null);
        return;
      }

      setSceneState(data);
    }

async function loadActiveRules() {
  if (!playerNumber) {
    setActiveRules([]);
    return;
  }

  const {
    data,
    error,
  } = await supabase.rpc(
    "get_active_rules",
    {
      p_game_code: code,
      p_player_no: playerNumber,
    }
  );

  console.log(
    `ACTIVE RULES P${playerNumber}:`,
    data
  );

  if (error) {
    console.error(
      "ACTIVE RULES ERROR:",
      error
    );

    return;
  }

  setActiveRules(
    Array.isArray(data)
      ? data
      : []
  );
}

async function handleSceneRead() {
  if (
    !playerNumber ||
    nextLoading ||
    mySceneStepRead
  ) {
    return;
  }

  setNextLoading(true);
  setError("");

  try {

    const {
      data,
      error,
    } = await supabase.rpc(
      "mark_scene_step_read",
      {
        p_game_code: code,
        p_player_no: playerNumber,
      }
    );

    if (error) {
      throw error;
    }

    console.log(
      "SCENE READ:",
      data
    );

    await loadState();

  } catch (err) {

    console.error(
      "SCENE READ ERROR:",
      err
    );

    setError(
      err?.message ||
      "Impossible de confirmer la lecture."
    );

  } finally {

    setNextLoading(false);
  }
}

  async function handleSceneNext() {
  if (!playerNumber || nextLoading) {
    return;
  }

  setNextLoading(true);
  setError("");

  try {
    const {
      data,
      error,
    } = await supabase.rpc(
      "advance_scene_step",
      {
        p_game_code: code,
        p_player_no: playerNumber,
      }
    );

    if (error) {
      throw error;
    }

    console.log(
      "Nouvelle étape scène:",
      data
    );

    await loadState();

  } catch (err) {
    console.error(
      "Erreur advance_scene_step:",
      err
    );

    setError(
      err.message ||
      "Impossible de poursuivre la scène."
    );

  } finally {
    setNextLoading(false);
  }
}


  /* =========================================
     LOAD STATE
     ========================================= */

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
        current_card_id,

        player_1_name,
        player_1_sex,
        player_2_name,
        player_2_sex,

        score_player_1,
        score_player_2,

        bonus_player_1,
        bonus_player_2,

        target_turns,
        phase,
        finished_at,
        shared_profile,
        scene_step_no,
        scene_step_read_player_1,
        scene_step_read_player_2
      `)
      .eq("code", code)
      .single();

    if (gameError) {
      throw gameError;
    }

    /*
     * Partie terminée :
     * on garde game mais plus de carte.
     */
    if (
      gameData.status ===
      "finished"
    ) {
      setGame(gameData);
      setCard(null);
      return;
    }

    /*
     * Route play mais partie pas encore
     * réellement en cours.
     */
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

    await Promise.all([
      loadSceneState(cardData),
      loadActiveRules(),
    ]);

  };


  /* =========================================
   REALTIME + POLLING
   ========================================= */

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


    /* =======================================
      REALTIME
      ======================================= */

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
            console.error(
              "PLAY REALTIME ERROR:",
              err
            );
          }
        }
      )
      .subscribe();


    /* =======================================
      POLLING DE SECURITE
      ======================================= */

    const polling =
      window.setInterval(
        async () => {
          if (!active) {
            return;
          }

          try {
            await loadState();

          } catch (err) {
            /*
            * Realtime + polling :
            * une erreur réseau transitoire
            * ne doit pas bloquer la partie.
            */

            console.warn(
              "PLAY POLLING ERROR:",
              err
            );
          }
        },
        1000
      );


    /* =======================================
      CLEANUP
      ======================================= */

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


  /* =========================================
     ADVANCE GAME
     ========================================= */

  const advanceGame =
    async (
      action,
      duelWinner = null
    ) => {
      try {
        setNextLoading(true);
        setError("");

        const {
          data,
          error: rpcError,
        } = await supabase.rpc(
          "advance_protocol",
          {
            p_game_code: code,
            p_action: action,
            p_duel_winner:
              duelWinner,
          }
        );

        if (rpcError) {
          throw rpcError;
        }

        console.log(
          "ADVANCE:",
          data
        );

        await loadState();

      } catch (err) {
        console.error(
          "ADVANCE ERROR:",
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


  /* =========================================
     BUY BONUS
     ========================================= */

  const buyBonus =
    async (bonus) => {
      try {
        setNextLoading(true);
        setError("");

        const {
          data,
          error: rpcError,
        } = await supabase.rpc(
          "buy_protocol_bonus",
          {
            p_game_code: code,
            p_player_no:
              playerNumber,
            p_bonus: bonus,
          }
        );

        if (rpcError) {
          throw rpcError;
        }

        console.log(
          "BONUS BOUGHT:",
          data
        );

        await loadState();

      } catch (err) {
        console.error(
          "BONUS ERROR:",
          err
        );

        setError(
          err?.message ||
            "Impossible d'acheter cet avantage."
        );

      } finally {
        setNextLoading(false);
      }
    };


  /* =========================================
     CHOOSE NEXT TYPE
     ========================================= */

  const chooseNextType =
    async (cardType) => {
      try {
        setNextLoading(true);
        setError("");

        const {
          data,
          error: rpcError,
        } = await supabase.rpc(
          "use_choose_type",
          {
            p_game_code: code,
            p_player_no:
              playerNumber,
            p_card_type:
              cardType,
          }
        );

        if (rpcError) {
          throw rpcError;
        }

        console.log(
          "TYPE CHOSEN:",
          data
        );

        setShowTypePicker(false);

        await loadState();

      } catch (err) {
        console.error(
          "CHOOSE TYPE ERROR:",
          err
        );

        setError(
          err?.message ||
            "Ce type de carte n'est pas disponible."
        );

      } finally {
        setNextLoading(false);
      }
    };


  /* =========================================
     INITIAL LOADING
     ========================================= */

  if (loading) {
    return (
      <LoadingScreen />
    );
  }


  /* =========================================
     LOAD ERROR
     ========================================= */

  if (
    error &&
    !game
  ) {
    return (
      <main className="app center">

        <p>
          {error}
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


  /* =========================================
     NOMS DES JOUEURS

     IMPORTANT :
     AVANT l'écran finished.
     game peut encore être null ici,
     donc optional chaining.
     ========================================= */

  const player1Name =
    game?.player_1_name ||
    "Joueur 1";

  const player2Name =
    game?.player_2_name ||
    "Joueur 2";

  const myName =
    playerNumber === 1
      ? player1Name
      : player2Name;

  const partnerName =
    playerNumber === 1
      ? player2Name
      : player1Name;

  const activePlayerName =
    game?.active_player === 1
      ? player1Name
      : player2Name;

  const cardPartnerName =
    game?.active_player === 1
      ? player2Name
      : player1Name;

  const renderProtocolText = (text) =>
    (text || "")
      .replaceAll(
        "{{active}}",
        activePlayerName
      )
      .replaceAll(
        "{{partner}}",
        cardPartnerName
      )
      .replaceAll(
        "{{me}}",
        myName
      )
      .replaceAll(
        "{{other}}",
        partnerName
      );

  const cardText =
    renderProtocolText(
      card?.prompt
    );

  const displayPrompt =
    sceneState?.is_multistep
      ? renderProtocolText(
          sceneState.prompt
        )
      : cardText;

  const promptLength =
    displayPrompt?.length || 0;

  const promptSizeClass =
    promptLength > 135
      ? "card-prompt-long"
      : promptLength > 80
        ? "card-prompt-medium"
        : "card-prompt-short";


   /* =========================================
     PARTIE TERMINEE
     ========================================= */

  if (
    game &&
    game.status === "finished"
  ) {
    const score1 =
      game.score_player_1 || 0;

    const score2 =
      game.score_player_2 || 0;


    const winner =
      score1 === score2
        ? null
        : score1 > score2
          ? 1
          : 2;


    const winnerName =
      winner === 1
        ? player1Name
        : winner === 2
          ? player2Name
          : null;


    const maxIntensity =
      game.shared_profile?.intensity ||
      null;


    let endTitle =
      "C'était votre moment.";


    let endText =
      "Gardez ce qui vous a plu. Le reste pourra attendre la prochaine fois.";


    if (maxIntensity === 1) {
      endTitle =
        "Tout doucement.";

      endText =
        "Vous avez choisi de prendre votre temps. Parfois, il n'en faut pas beaucoup plus.";
    }


    if (maxIntensity === 2) {
      endTitle =
        "Juste assez.";

      endText =
        "Un peu de tension, quelques surprises et probablement quelques idées à garder pour plus tard.";
    }


    if (maxIntensity === 3) {
      endTitle =
        "Vous avez joué.";

      endText =
        "Vous vous êtes provoqués, surpris et probablement donné envie d'aller un peu plus loin.";
    }


    if (maxIntensity === 4) {
      endTitle =
        "Vous êtes allés loin.";

      endText =
        "Certaines règles ont tenu. D'autres probablement beaucoup moins.";
    }


    if (maxIntensity === 5) {
      endTitle =
        "Sans filtre.";

      endText =
        "Vous aviez choisi de ne pas trop vous retenir. PROTOCOL n'a manifestement pas eu besoin d'insister beaucoup.";
    }


    const replay = () => {
      navigate("/");
    };


    return (
      <main className="app final-page">

        <div className="final-glow final-glow-top" />
        <div className="final-glow final-glow-bottom" />


        <header className="header final-header">

          <span className="logo">
            PROTOCOL
          </span>

          <span className="pill">
            Terminé
          </span>

        </header>


        <section className="final-screen">


          {/* =================================
              INTRO
              ================================= */}

          <div className="final-intro">

            <p className="kicker">
              SESSION TERMINÉE
            </p>

            <h1>
              {endTitle}
            </h1>

            <p className="final-text">
              {endText}
            </p>

          </div>


          {/* =================================
              SCORE
              ================================= */}

          <div className="final-score-card">

            <div
              className={
                winner === 1
                  ? "final-player final-winner"
                  : "final-player"
              }
            >

              <span className="final-player-name">
                {player1Name}
              </span>

              <strong className="final-player-score">
                {score1}
              </strong>

            </div>


            <div className="final-score-divider">

              <span>·</span>

            </div>


            <div
              className={
                winner === 2
                  ? "final-player final-winner"
                  : "final-player"
              }
            >

              <span className="final-player-name">
                {player2Name}
              </span>

              <strong className="final-player-score">
                {score2}
              </strong>

            </div>

          </div>


          {/* =================================
              RESULT
              ================================= */}

          <div className="final-result">

            {winnerName ? (
              <>
                <span className="final-symbol">
                  ◇
                </span>

                <p>
                  <strong>
                    {winnerName}
                  </strong>
                  {" "}
                  termine avec quelques points d'avance.
                </p>
              </>
            ) : (
              <>
                <span className="final-symbol">
                  ◇
                </span>

                <p>
                  Aucun gagnant ce soir.
                  <br />
                  Ce qui semble franchement secondaire.
                </p>
              </>
            )}

          </div>


          {/* =================================
              CLOSING
              ================================= */}

          <div className="final-closing">

            <p>
              PROTOCOL est terminé.
              <br />
              La soirée, elle, ne l'est pas forcément.
            </p>

          </div>


          {/* =================================
              BUTTON
              ================================= */}

          <button
            className="primary final-replay"
            onClick={replay}
          >

            <span>
              Rejouer
            </span>

            <span>
              →
            </span>

          </button>


        </section>


        <Footer />

      </main>
    );
  }

  /* =========================================
     GAME/CARD GUARD
     ========================================= */

  if (
    !game ||
    !card
  ) {
    return (
      <LoadingScreen />
    );
  }


  /* =========================================
     DERIVED STATE
     ========================================= */

  const myBonuses =
    playerNumber === 1
      ? game.bonus_player_1 || {}
      : game.bonus_player_2 || {};

  const myScore =
    playerNumber === 1
      ? game.score_player_1
      : game.score_player_2;

  const isMyTurn =
    game.active_player ===
    playerNumber;

  const mySceneStepRead =
    playerNumber === 1
      ? game.scene_step_read_player_1
      : game.scene_step_read_player_2;

  const partnerSceneStepRead =
    playerNumber === 1
      ? game.scene_step_read_player_2
      : game.scene_step_read_player_1;

  const bothSceneStepRead =
    game.scene_step_read_player_1 &&
    game.scene_step_read_player_2;

    const typeLabels = {
      truth: "VÉRITÉ",
      action: "ACTION",
      duel: "DUEL",
      scene: "SCÈNE",
    };

  const phaseLabels = {
    warmup:
      "MISE EN TENSION",

    rise:
      "MONTÉE",

    intense:
      "INTENSITÉ",

    finale:
      "FINALE",
  };


  /* =========================================
     RENDER
     ========================================= */

  return (
    <main className="app play-page">

      <div className="glow glow-center" />


      {/* =====================================
          HEADER / SCORE
          ===================================== */}

      <header className="header play-header">

        <span className="logo">
          PROTOCOL
        </span>


        <div className="score-board">

          <div
            className={
              playerNumber === 1
                ? "score-me"
                : ""
            }
          >
            <span>
              {player1Name}
            </span>

            <strong>
              {game.score_player_1}
            </strong>
          </div>


          <span className="score-separator">
            ·
          </span>


          <div
            className={
              playerNumber === 2
                ? "score-me"
                : ""
            }
          >
            <span>
              {player2Name}
            </span>

            <strong>
              {game.score_player_2}
            </strong>
          </div>

        </div>

      </header>


    {/* =====================================
        BONUS
        ===================================== */}

    <div
      className={
        showBonuses
          ? "bonus-panel bonus-panel-open"
          : "bonus-panel"
      }
    >

      <button
        type="button"
        className="bonus-toggle"
        onClick={() =>
          setShowBonuses(
            (current) => !current
          )
        }
      >
        <span className="bonus-toggle-label">
          AVANTAGES
        </span>

        <span className="bonus-toggle-meta">
          {myScore} pts
          <span className="bonus-toggle-dot">
            ·
          </span>
          {showBonuses
            ? "FERMER"
            : "OUVRIR"}
        </span>
      </button>


      {showBonuses && (

        <div className="bonus-bar">


          <button
            className={
              myBonuses.double_reward
                ? "bonus-button bonus-owned"
                : "bonus-button"
            }
            onClick={() =>
              buyBonus(
                "double_reward"
              )
            }
            disabled={
              nextLoading ||
              myBonuses.double_reward ||
              myScore < 3
            }
          >
            <span>
              Double enjeu
            </span>

            <strong>
              {myBonuses.double_reward
                ? "PRÊT"
                : "3 pts"}
            </strong>
          </button>


          <button
            className={
              myBonuses.take_control ||
              myBonuses.take_control_armed
                ? "bonus-button bonus-owned"
                : "bonus-button"
            }
            onClick={() =>
              buyBonus(
                "take_control"
              )
            }
            disabled={
              nextLoading ||
              myBonuses.take_control ||
              myBonuses.take_control_armed ||
              myScore < 3
            }
          >
            <span>
              Prendre la main
            </span>

            <strong>
              {myBonuses.take_control_armed
                ? "ACTIF"
                : myBonuses.take_control
                  ? "PRÊT"
                  : "3 pts"}
            </strong>
          </button>


          <button
            className={
              myBonuses.choose_type ||
              myBonuses.choose_type_armed
                ? "bonus-button bonus-owned"
                : "bonus-button"
            }
            onClick={() => {

              if (
                myBonuses.choose_type
              ) {
                setShowBonuses(false);

                setShowTypePicker(
                  true
                );

                return;
              }

              buyBonus(
                "choose_type"
              );
            }}
            disabled={
              nextLoading ||
              Boolean(
                myBonuses.choose_type_armed
              ) ||
              (
                !myBonuses.choose_type &&
                myScore < 2
              )
            }
          >
            <span>
              Imposer le type
            </span>

            <strong>
              {myBonuses.choose_type_armed
                ? myBonuses
                    .choose_type_armed
                    .toUpperCase()
                : myBonuses.choose_type
                  ? "UTILISER"
                  : "2 pts"}
            </strong>
          </button>


        </div>

      )}

    </div>


      {/* =====================================
          TYPE PICKER
          ===================================== */}

      {showTypePicker && (
        <div className="type-picker">

          <div className="type-picker-header">

            <div>
              <strong>
                Prochaine carte
              </strong>

              <span>
                Choisis son type.
              </span>
            </div>


            <button
              className="type-picker-close"
              onClick={() =>
                setShowTypePicker(
                  false
                )
              }
            >
              ×
            </button>

          </div>


          <div className="type-picker-grid">

            <button
              onClick={() =>
                chooseNextType(
                  "truth"
                )
              }
              disabled={nextLoading}
            >
              <span>?</span>
              Vérité
            </button>


            <button
              onClick={() =>
                chooseNextType(
                  "action"
                )
              }
              disabled={nextLoading}
            >
              <span>→</span>
              Action
            </button>


            <button
              onClick={() =>
                chooseNextType(
                  "duel"
                )
              }
              disabled={nextLoading}
            >
              <span>×</span>
              Duel
            </button>


            <button
              onClick={() =>
                chooseNextType(
                  "scene"
                )
              }
              disabled={nextLoading}
            >
              <span>◇</span>
              Scène
            </button>

          </div>

        </div>
      )}


      {/* =====================================
          TAKE CONTROL
          ===================================== */}

      {myBonuses.take_control && (
        <button
          className="activate-bonus"

          onClick={async () => {
            try {
              setNextLoading(true);
              setError("");

              const {
                error: bonusError,
              } = await supabase.rpc(
                "use_take_control",
                {
                  p_game_code:
                    code,

                  p_player_no:
                    playerNumber,
                }
              );

              if (bonusError) {
                throw bonusError;
              }

              await loadState();

            } catch (err) {
              console.error(
                "TAKE CONTROL ERROR:",
                err
              );

              setError(
                err?.message ||
                  "Impossible d'utiliser cet avantage."
              );

            } finally {
              setNextLoading(false);
            }
          }}
        >
          Utiliser « Prendre la main »
        </button>
      )}


      {/* =====================================
          PLAY
          ===================================== */}

      <section className="play">

        <div className="play-meta">

          <span
            className={
              `card-type card-type-${card.type}`
            }
          >
            {typeLabels[
              card.type
            ]}
          </span>


          <span>
            {isMyTurn
              ? `${myName.toUpperCase()} · À TOI`
              : activePlayerName.toUpperCase()}
          </span>


          <span>
            {phaseLabels[
              game.phase
            ]}
            {" · "}
            {game.turn_no}
            /
            {game.target_turns}
          </span>

        </div>


        {/* ===================================
            CARD
            =================================== */}

          {activeRules.length > 0 && (
            <div className="active-rules">

              {activeRules.map((rule) => (
                <div
                  key={rule.id}
                  className="active-rule"
                >
                  <div className="active-rule-top">

                    <div className="active-rule-label">
                      <span className="active-rule-dot">
                        ◉
                      </span>

                      <span>
                        RÈGLE ACTIVE
                      </span>
                    </div>

                    <span className="active-rule-duration">
                      {rule.remaining_turns}
                      {" "}
                      {rule.remaining_turns === 1
                        ? "carte"
                        : "cartes"}
                    </span>

                  </div>

                  <strong className="active-rule-title">
                    {rule.title}
                  </strong>

                  <p className="active-rule-text">
                    {renderProtocolText(
                      rule.rule_text
                    )}
                  </p>

                </div>
              ))}

            </div>
          )}

          <div
            key={`${card.id}-${sceneState?.step_no || 0}`}
            className={`game-card game-card-${card.type}`}
          >

          {card.title && (
            <p className="kicker">
              {card.title.toUpperCase()}
            </p>
          )}

        {sceneState?.is_multistep && (
          <div className="scene-progress">

            <span>
              {sceneState.is_private
                ? "◉ PRIVÉ"
                : "SCÈNE"}
            </span>

            <span>
              ÉTAPE {sceneState.step_no}
              /
              {sceneState.step_count}
            </span>

          </div>
        )}

        {sceneState?.title && (
          <p className="scene-step-title">
            {sceneState.title}
          </p>
        )}

        <p
          className={`card-prompt ${promptSizeClass}`}
        >
          {displayPrompt}
        </p>

        </div>


        {/* ===================================
            ACTIONS
            =================================== */}

        <div className="play-bottom">


          {/* DUEL */}

          {card.type === "duel" ? (

            <div className="duel-actions">

              <p className="duel-question">
                Qui remporte ce duel ?
              </p>


              <div className="duel-buttons">

                <button
                  className="duel-winner"

                  onClick={() =>
                    advanceGame(
                      "duel",
                      1
                    )
                  }

                  disabled={
                    nextLoading
                  }
                >
                  <span>
                    {player1Name}
                  </span>

                  <strong>
                    +2
                  </strong>
                </button>


                <button
                  className="duel-winner"

                  onClick={() =>
                    advanceGame(
                      "duel",
                      2
                    )
                  }

                  disabled={
                    nextLoading
                  }
                >
                  <span>
                    {player2Name}
                  </span>

                  <strong>
                    +2
                  </strong>
                </button>

              </div>


              <button
                className="text-action pass-action"

                onClick={() =>
                  advanceGame(
                    "pass"
                  )
                }

                disabled={
                  nextLoading
                }
              >
                Passer ce duel
              </button>

            </div>


          /* ACTIVE PLAYER */

          ) : isMyTurn ? (

            <div className="turn-actions">

          {sceneState?.is_multistep ? (

            sceneState.is_private ? (

              !mySceneStepRead ? (

                <button
                  className="primary"
                  onClick={handleSceneRead}
                  disabled={nextLoading}
                >
                  <span>
                    {nextLoading
                      ? "Un instant…"
                      : "J'ai lu"}
                  </span>

                  <span>✓</span>
                </button>

              ) : !bothSceneStepRead ? (

                <div className="ready-box">
                  <div className="check">
                    ✓
                  </div>

                  <div>
                    <strong>
                      Tu as lu.
                    </strong>

                    <span>
                      On attend l'autre.
                    </span>
                  </div>
                </div>

              ) : sceneState.is_last ? (

                <button
                  className="primary"
                  onClick={() =>
                    advanceGame("done")
                  }
                  disabled={nextLoading}
                >
                  <span>
                    {nextLoading
                      ? "Un instant…"
                      : "Scène terminée"}
                  </span>

                  <span>→</span>
                </button>

              ) : (

                <button
                  className="primary scene-next"
                  onClick={handleSceneNext}
                  disabled={nextLoading}
                >
                  <span>
                    {nextLoading
                      ? "Un instant…"
                      : "Continuer la scène"}
                  </span>

                  <span>→</span>
                </button>

              )

            ) : (

              sceneState.is_last ? (

                <button
                  className="primary"
                  onClick={() =>
                    advanceGame("done")
                  }
                  disabled={nextLoading}
                >
                  <span>
                    {nextLoading
                      ? "Un instant…"
                      : "Scène terminée"}
                  </span>

                  <span>→</span>
                </button>

              ) : (

                <button
                  className="primary scene-next"
                  onClick={handleSceneNext}
                  disabled={nextLoading}
                >
                  <span>
                    {nextLoading
                      ? "Un instant…"
                      : "Continuer la scène"}
                  </span>

                  <span>→</span>
                </button>

              )

            )

          ) : (

            <button
              className="primary"
              onClick={() =>
                advanceGame("done")
              }
              disabled={nextLoading}
            >
              <span>
                {nextLoading
                  ? "Un instant…"
                  : "C'est fait"}
              </span>

              <span>→</span>
            </button>

          )}


              <div className="alternative-actions">

                <button
                  className="text-action"

                  onClick={() =>
                    advanceGame(
                      "alternative"
                    )
                  }

                  disabled={
                    nextLoading
                  }
                >
                  Autre proposition
                </button>


                <button
                  className="text-action pass-action"

                  onClick={() =>
                    advanceGame(
                      "pass"
                    )
                  }

                  disabled={
                    nextLoading
                  }
                >
                  Passer
                </button>

              </div>

            </div>


          /* WAITING PLAYER */

          ) : (

            <div className="waiting-turn">

              {sceneState?.is_multistep &&
              sceneState?.is_private ? (

                !mySceneStepRead ? (

                  <button
                    className="primary"
                    onClick={handleSceneRead}
                    disabled={nextLoading}
                  >
                    <span>
                      {nextLoading
                        ? "Un instant…"
                        : "J'ai lu"}
                    </span>

                    <span>✓</span>
                  </button>

                ) : !partnerSceneStepRead ? (

                  <div className="ready-box">
                    <div className="check">
                      ✓
                    </div>

                    <div>
                      <strong>
                        Tu as lu.
                      </strong>

                      <span>
                        On attend l'autre.
                      </span>
                    </div>
                  </div>

                ) : (

                  <div className="ready-box">
                    <div className="check">
                      ✓
                    </div>

                    <div>
                      <strong>
                        Vous avez lu.
                      </strong>

                      <span>
                        {activePlayerName} peut continuer.
                      </span>
                    </div>
                  </div>

                )

              ) : (

                <p className="waiting-text">
                  À {activePlayerName} de jouer.
                </p>

              )}

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