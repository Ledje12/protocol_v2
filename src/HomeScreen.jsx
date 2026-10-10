import { useEffect, useState } from "react";
import { INTENSITY_LEVELS } from "./gameConstants.js";
import { clearGameSession, getGameSession, getLastSeenCard, saveGameSession, saveLastSeenCard, saveProfileAsGameIdentity } from "./gameSession.js";
import { hasSeenHowToPlay } from "./howto.js";
import HowToPlay from "./HowToPlay.jsx";
import PairingPanel from "./PairingPanel.jsx";
import { SettingsSheet } from "./SettingsParts.jsx";
import { supabase } from "./supabaseClient.js";
import { useUnreadCounts } from "./unread.js";
import UnreadBadge from "./UnreadBadge.jsx";
import { PhotoDayHomeNotice } from "./PhotoDay.jsx";

function HomeIcon({
  name,
  size = 24,
  strokeWidth = 1.6,
}) {
  const common = {
    width: size,
    height: size,
    viewBox: "0 0 24 24",
    fill: "none",
    stroke: "currentColor",
    strokeWidth,
    strokeLinecap: "round",
    strokeLinejoin: "round",
    "aria-hidden": true,
  };

  if (name === "play") {
    return (
      <svg {...common}>
        <path d="M8 5.5v13l10-6.5-10-6.5Z" />
      </svg>
    );
  }

  if (name === "sparkles") {
    return (
      <svg {...common}>
        <path d="M12 3l1.15 3.1L16 7.25l-2.85 1.15L12 11.5 10.85 8.4 8 7.25l2.85-1.15L12 3Z" />
        <path d="M18.25 13.5l.7 1.8 1.8.7-1.8.7-.7 1.8-.7-1.8-1.8-.7 1.8-.7.7-1.8Z" />
        <path d="M6 13l.9 2.4 2.35.85-2.35.9L6 19.5l-.9-2.35-2.35-.9 2.35-.85L6 13Z" />
      </svg>
    );
  }

  if (name === "join") {
    return (
      <svg {...common}>
        <path d="M14 5h4a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2h-4" />
        <path d="M10 8l4 4-4 4" />
        <path d="M14 12H4" />
      </svg>
    );
  }

  if (name === "heart") {
    return (
      <svg {...common}>
        <path d="M20.8 4.6a5.4 5.4 0 0 0-7.6 0L12 5.8l-1.2-1.2a5.4 5.4 0 0 0-7.6 7.6L12 21l8.8-8.8a5.4 5.4 0 0 0 0-7.6Z" />
      </svg>
    );
  }

  if (name === "dice") {
    return (
      <svg {...common}>
        <rect x="3.5" y="3.5" width="17" height="17" rx="4" />
        <circle cx="8" cy="8" r=".8" fill="currentColor" stroke="none" />
        <circle cx="16" cy="8" r=".8" fill="currentColor" stroke="none" />
        <circle cx="12" cy="12" r=".8" fill="currentColor" stroke="none" />
        <circle cx="8" cy="16" r=".8" fill="currentColor" stroke="none" />
        <circle cx="16" cy="16" r=".8" fill="currentColor" stroke="none" />
      </svg>
    );
  }

  if (name === "moon") {
    return (
      <svg {...common}>
        <path d="M20.5 14.2A8.5 8.5 0 0 1 9.8 3.5 8.7 8.7 0 1 0 20.5 14.2Z" />
      </svg>
    );
  }

  if (name === "book") {
    return (
      <svg {...common}>
        <path d="M4 19.5a2.5 2.5 0 0 1 2.5-2.5H20" />
        <path d="M6.5 3H20v18H6.5A2.5 2.5 0 0 1 4 18.5v-13A2.5 2.5 0 0 1 6.5 3Z" />
      </svg>
    );
  }

  if (name === "mail") {
    return (
      <svg {...common}>
        <rect x="3" y="5" width="18" height="14" rx="3" />
        <path d="m4.5 7 7.5 6 7.5-6" />
      </svg>
    );
  }

  if (name === "settings") {
    return (
      <svg {...common}>
        <circle cx="12" cy="12" r="3" />
        <path d="M19.4 15a1.7 1.7 0 0 0 .35 1.9l.05.05-2.85 2.85-.05-.05A1.7 1.7 0 0 0 15 19.4a1.7 1.7 0 0 0-1 .6 1.7 1.7 0 0 0-.4 1.1V21H9.6v-.1A1.7 1.7 0 0 0 8.2 19.3a1.7 1.7 0 0 0-1.9.35l-.05.05-2.85-2.85.05-.05A1.7 1.7 0 0 0 3.8 15a1.7 1.7 0 0 0-.6-1 1.7 1.7 0 0 0-1.1-.4H2V9.6h.1A1.7 1.7 0 0 0 3.7 8.2a1.7 1.7 0 0 0-.35-1.9l-.05-.05L6.15 3.4l.05.05A1.7 1.7 0 0 0 8.1 3.8a1.7 1.7 0 0 0 1-.6 1.7 1.7 0 0 0 .4-1.1V2h4v.1a1.7 1.7 0 0 0 1.4 1.6 1.7 1.7 0 0 0 1.9-.35l.05-.05 2.85 2.85-.05.05a1.7 1.7 0 0 0-.35 1.9 1.7 1.7 0 0 0 .6 1 1.7 1.7 0 0 0 1.1.4h.1v4h-.1a1.7 1.7 0 0 0-1.6 1.5Z" />
      </svg>
    );
  }

  return null;
}

/* =========================================================
   HOME
   ========================================================= */

export default function HomeScreen({
  navigate,
  profile,
  hasPartner = true,
  onPaired,
}) {
  const unread =
    useUnreadCounts(
      supabase,
      profile?.user_id
    );

  // « Comment on joue » : une fois, quand le duo est formé
  const [showHowTo, setShowHowTo] =
    useState(() => !hasSeenHowToPlay());

  /*
   * Partie créée par le partenaire et qui l'attend :
   * on propose de la rejoindre sans taper le code.
   * (fonction get_partner_waiting_game, migration 20261009090000)
   */
  const [partnerGame, setPartnerGame] =
    useState(null);

  useEffect(() => {
    let active = true;

    const check = async () => {
      const { data, error: partnerGameError } =
        await supabase.rpc(
          "get_partner_waiting_game"
        );

      if (active && !partnerGameError) {
        const row =
          Array.isArray(data)
            ? data[0]
            : data;

        setPartnerGame(
          row?.code ? row : null
        );
      }
    };

    check();

    const timer =
      window.setInterval(check, 8000);

    const onVisible = () => {
      if (document.visibilityState === "visible") {
        check();
      }
    };

    document.addEventListener(
      "visibilitychange",
      onVisible
    );

    return () => {
      active = false;
      window.clearInterval(timer);
      document.removeEventListener(
        "visibilitychange",
        onVisible
      );
    };
  }, []);

  const [loading, setLoading] =
    useState(false);

  const [error, setError] =
    useState("");

  const [inviteLoading, setInviteLoading] =
    useState(false);

  const [inviteMessage, setInviteMessage] =
    useState("");

  const [resumeGame, setResumeGame] =
    useState(null);

  const [resumeLoading, setResumeLoading] =
    useState(true);

  const [resumeHasUpdate, setResumeHasUpdate] =
    useState(false);

  const [joinOpen, setJoinOpen] =
    useState(false);

  const [joinCode, setJoinCode] =
    useState("");

  const [joinLoading, setJoinLoading] =
    useState(false);

  const [joinError, setJoinError] =
    useState("");

    useEffect(() => {
      let active = true;

      const checkResumeGame = async () => {
        const session =
          getGameSession();

        if (!session.valid) {
          if (active) {
            setResumeGame(null);
            setResumeLoading(false);
          }

          return;
        }

        try {
          const {
            data,
            error: rpcError,
          } = await supabase.rpc(
            "get_protocol_game",
            {
              p_game_code: session.code,
            }
          );

          if (rpcError) {
            throw rpcError;
          }

          const game =
            Array.isArray(data)
              ? data[0]
              : data;

          if (!game) {
            throw new Error(
              "Partie introuvable."
            );
          }

          if (!active) {
            return;
          }

          const partnerName =
            session.playerNumber === 1
              ? game.player_2_name
              : game.player_1_name;

          setResumeGame({
            ...game,
            sessionCode: session.code,
            playerNumber:
              session.playerNumber,
            partnerName:
              partnerName || null,
          });

          const currentCardId =
            game.current_card_id ?? null;

          const lastSeenCardId =
            getLastSeenCard(session.code);

          /*
          * Première détection :
          * on initialise simplement la carte vue.
          * Pas de faux badge rouge.
          */
          if (
            currentCardId &&
            lastSeenCardId === null
          ) {
            saveLastSeenCard(
              session.code,
              currentCardId
            );

            setResumeHasUpdate(false);

          /*
          * Une autre carte est maintenant
          * active sur le serveur.
          */
          } else if (
            currentCardId &&
            lastSeenCardId !== null &&
            Number(currentCardId) !==
              Number(lastSeenCardId)
          ) {
            setResumeHasUpdate(true);

          } else {
            setResumeHasUpdate(false);
          }

        } catch (err) {
          console.warn(
            "RESUME GAME CHECK:",
            err
          );

          /*
          * La partie n'existe plus
          * ou l'utilisateur n'y a plus accès.
          *
          * On oublie uniquement la session
          * locale. Supabase reste intact.
          */
          clearGameSession();

          if (active) {
            setResumeGame(null);
          }

        } finally {
          if (active) {
            setResumeLoading(false);
          }
        }
      };

      checkResumeGame();

      return () => {
        active = false;
      };
    }, []);

    const resumeCurrentGame = async () => {
      if (!resumeGame) {
        return;
      }

      const code =
        resumeGame.sessionCode;

      if (resumeGame.current_card_id) {
        saveLastSeenCard(
          code,
          resumeGame.current_card_id
        );
      }

      setResumeHasUpdate(false);

      /*
      * On reprend directement au bon
      * endroit selon l'état réel
      * de la partie dans Supabase.
      */

      if (
        resumeGame.status === "playing" ||
        resumeGame.status === "finished"
      ) {
        navigate(
          `/game/${code}/play`
        );

        return;
      }

      if (
        resumeGame.status === "calibrating" ||
        resumeGame.status ===
          "calibration_ready"
      ) {
        navigate(
          `/game/${code}/calibration`
        );

        return;
      }

      /*
      * Si l'identité du joueur local
      * n'existe pas encore, retour
      * à l'écran d'identité.
      */

      const myName =
        resumeGame.playerNumber === 1
          ? resumeGame.player_1_name
          : resumeGame.player_2_name;

      const mySex =
        resumeGame.playerNumber === 1
          ? resumeGame.player_1_sex
          : resumeGame.player_2_sex;

      if (!myName || !mySex) {
        const session =
          getGameSession(code);

        if (!session.valid) {
          clearGameSession();
          navigate("/");
          return;
        }

        try {
          await saveProfileAsGameIdentity({
            code,
          });

        } catch (err) {
          console.error(
            "RESUME IDENTITY SYNC ERROR:",
            err
          );

          setError(
            err?.message ||
            "Impossible de restaurer ton profil dans cette partie."
          );

          return;
        }
      }

      /*
      * waiting / ready / autre état
      * pré-jeu : lobby.
      */

      navigate(
        `/game/${code}`
      );
    };
  
  const sendInvitation = async (
    signal = "tonight"
  ) => {

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
            signal,
          },
        }
      );

      if (functionError) {
        throw functionError;
      }

      if (!data?.success) {
        throw new Error(
          data?.error ||
            "Impossible d’envoyer le signal."
        );
      }

      const messages = {
        secret:
          "Secret proposé.",

        challenge:
          "Défi proposé.",

        tonight:
          "Invitation envoyée.",
      };

      setInviteMessage(
        messages[signal] ||
          "Signal envoyé."
      );

    } catch (err) {

      console.error(
        "SEND INVITATION ERROR:",
        err
      );

      // message lisible : l'erreur technique reste dans la console.
      // Cas fréquent : l'autre n'a pas activé les notifications,
      // le signe ne peut alors pas lui parvenir.
      let reason =
        err?.message || "";

      try {
        const body =
          await err?.context?.json?.();

        reason =
          body?.error || reason;
      } catch {
        // corps illisible : on garde le message générique
      }

      setInviteMessage(
        /aucun appareil actif/i.test(reason)
          ? "Ton partenaire n’a pas activé les notifications : le signe ne peut pas lui parvenir pour l’instant."
          : "Le signal n’a pas pu partir. Réessaie dans un instant."
      );

    } finally {

      setInviteLoading(
        false
      );

    }

  };

  const joinGameFromHome = async (
    event,
    codeToJoin = joinCode
  ) => {
    event?.preventDefault();

    if (codeToJoin.length !== 6) {
      return;
    }

    try {
      setJoinLoading(true);
      setJoinError("");

      const normalized =
        codeToJoin.toUpperCase();

      const {
        data,
        error: rpcError,
      } = await supabase.rpc(
        "join_protocol_game",
        {
          p_game_code: normalized,
        }
      );

      if (rpcError) {
        throw rpcError;
      }

      const joinedGame =
        Array.isArray(data)
          ? data[0]
          : data;

      if (
        !joinedGame?.code ||
        ![1, 2].includes(
          Number(joinedGame?.player_no)
        )
      ) {
        throw new Error(
          "Réponse de connexion invalide."
        );
      }

      saveGameSession(
        joinedGame.code,
        joinedGame.player_no
      );

      await saveProfileAsGameIdentity({
        code: joinedGame.code,
      });

      setJoinOpen(false);

      navigate(
        `/game/${joinedGame.code}`
      );

    } catch (err) {
      console.error(
        "JOIN FROM HOME ERROR:",
        err
      );

      setJoinError(
        err?.message ||
          "Impossible de rejoindre cette partie."
      );

    } finally {
      setJoinLoading(false);
    }
  };
  
  /* Lancer une partie : un seul téléphone posé entre vous,
     ou chacun le sien. Le dernier choix est proposé en premier. */
  const PLAY_MODE_KEY = "protocol-play-mode";

  const [showLaunchChoice, setShowLaunchChoice] =
    useState(false);

  const lastPlayMode = (() => {
    try {
      return localStorage.getItem(PLAY_MODE_KEY) || "two";
    } catch {
      return "two";
    }
  })();

  const rememberPlayMode = (mode) => {
    try {
      localStorage.setItem(PLAY_MODE_KEY, mode);
    } catch {
      // stockage indisponible : sans conséquence
    }
  };

  const createSingleDeviceGame = async () => {
    try {
      setLoading(true);
      setError("");
      rememberPlayMode("single");

      const { data: newCode, error: rpcError } =
        await supabase.rpc("create_single_device_game");

      if (rpcError) {
        throw rpcError;
      }

      if (!newCode) {
        throw new Error("Réponse de création invalide.");
      }

      saveGameSession(newCode, 1, { singleDevice: true });
      setShowLaunchChoice(false);
      navigate(`/game/${newCode}/calibration`);
    } catch (err) {
      console.error("CREATE SINGLE DEVICE GAME ERROR:", err);
      setShowLaunchChoice(false);
      setError(
        "Impossible de lancer la partie sur ce téléphone. Réessaie dans un instant."
      );
    } finally {
      setLoading(false);
    }
  };

  /* « À distance » : une journée de défis photo, dans Messages */
  const startPhotoDay = async () => {
    rememberPlayMode("remote");
    setShowLaunchChoice(false);

    try {
      setLoading(true);
      setError("");

      const { error: rpcError } = await supabase.rpc("start_photo_day");

      // une journée est déjà lancée : on la rejoint
      if (rpcError && !/already running/i.test(rpcError.message)) {
        throw rpcError;
      }

      if (!rpcError) {
        // prévient l'autre (notification) ; sans gravité si ça échoue
        await supabase.functions
          .invoke("send-message", {
            body: {
              body: "Je te lance une journée de défis photo, à distance. Tu acceptes ?",
            },
          })
          .catch(() => {});
      }

      navigate("/messages");
    } catch (err) {
      console.error("START PHOTO DAY ERROR:", err);
      setError(
        /no photo challenge/i.test(err?.message || "")
          ? "Les défis photo ne sont pas encore écrits."
          : "Impossible de lancer la journée à distance. Réessaie dans un instant."
      );
    } finally {
      setLoading(false);
    }
  };

  const createGame = async () => {
    rememberPlayMode("two");
    setShowLaunchChoice(false);

    try {
      setLoading(true);
      setError("");

      const {
        data,
        error: rpcError,
      } = await supabase.rpc(
        "create_protocol_game"
      );

      if (rpcError) {
        throw rpcError;
      }

      const createdGame =
        Array.isArray(data)
          ? data[0]
          : data;

      if (
        !createdGame?.code ||
        ![1, 2].includes(
          Number(createdGame?.player_no)
        )
      ) {
        throw new Error(
          "Réponse de création invalide."
        );
      }

      saveGameSession(
        createdGame.code,
        createdGame.player_no
      );

      await saveProfileAsGameIdentity({
        code: createdGame.code,
      });

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
    <main className="app protocol-home-page">

      {showLaunchChoice && (
        <SettingsSheet
          eyebrow="NOUVELLE PARTIE"
          title="Comment jouez-vous ?"
          onClose={() => setShowLaunchChoice(false)}
        >
          <div className="launch-choice">
            {[
              {
                mode: "single",
                title: "Sur un seul téléphone",
                text: "Posé entre vous. Vous vous le passez pour les choix secrets.",
                onClick: createSingleDeviceGame,
              },
              {
                mode: "two",
                title: "Chacun le sien",
                text: "Un code, chacun rejoint la partie sur son téléphone.",
                onClick: createGame,
              },
              {
                mode: "remote",
                title: "À distance",
                text: "Toute la journée, chacun de son côté : des défis photo, à tour de rôle.",
                onClick: startPhotoDay,
              },
            ]
              .sort((a, b) =>
                a.mode === lastPlayMode ? -1 : b.mode === lastPlayMode ? 1 : 0
              )
              .map((option) => (
                <button
                  key={option.mode}
                  type="button"
                  className={
                    option.mode === lastPlayMode
                      ? "launch-choice-option is-last"
                      : "launch-choice-option"
                  }
                  onClick={option.onClick}
                  disabled={loading}
                >
                  <strong>{option.title}</strong>
                  <span>{option.text}</span>
                </button>
              ))}
          </div>
        </SettingsSheet>
      )}
      {hasPartner && showHowTo && (
        <HowToPlay
          onClose={() =>
            setShowHowTo(false)
          }
        />
      )}

      {/* =========================================
          HEADER
          ========================================= */}

      <header className="protocol-home-header">

        <div className="protocol-home-brand">

          <span className="protocol-home-brand-name">
            PROTOCOL
          </span>

        </div>

      </header>


      <section className="protocol-home-dashboard">

        {/* =========================================
            LE PARTENAIRE ATTEND
            ========================================= */}

        {partnerGame && (
          <section
            className="protocol-home-waiting"
            aria-live="polite"
          >
            <div className="protocol-home-waiting-copy">
              <span
                className="protocol-diamond"
                aria-hidden="true"
              />

              <p>
                <em>{partnerGame.host_name}</em>
                {" "}
                t’attend.
              </p>

              <small>
                Une partie vient d’être lancée.
              </small>
            </div>

            <button
              type="button"
              className="protocol-home-waiting-join"
              disabled={joinLoading}
              onClick={() =>
                joinGameFromHome(
                  null,
                  partnerGame.code
                )
              }
            >
              {joinLoading
                ? "Un instant…"
                : "Rejoindre"}
            </button>

            {joinError && !joinOpen && (
              <p className="protocol-home-message is-error">
                {joinError}
              </p>
            )}
          </section>
        )}


        {/* =========================================
            HERO
            ========================================= */}

        <section className="protocol-home-hero-card">

          <div className="protocol-home-hero-image" />

          <div className="protocol-home-hero-gradient" />

          <div className="protocol-home-hero-content">


            {/* TOP */}

            <div className="protocol-home-hero-copy">

              <p className="protocol-home-eyebrow">
                PLUS LOIN ENSEMBLE
              </p>


              <div className="protocol-home-title-line">

                <h1>
                  Ce soir
                </h1>


                {resumeGame?.shared_profile?.intensity && (

                  <div className="protocol-home-level">
                    <span
                      className="type-intensity"
                      aria-hidden="true"
                    >
                      {Array.from({
                        length: 5,
                      }).map((_, index) => (
                        <i
                          key={index}
                          className={
                            index <
                            Number(
                              resumeGame.shared_profile.intensity
                            )
                              ? "is-active"
                              : ""
                          }
                        />
                      ))}
                    </span>
                    <strong>
                      {INTENSITY_LEVELS.find(
                        (level) =>
                          level.value ===
                          Number(
                            resumeGame.shared_profile.intensity
                          )
                      )?.title ||
                        `Niveau ${resumeGame.shared_profile.intensity}`}
                    </strong>
                  </div>
                )}

              </div>


              <div className="protocol-home-status">

                <span className="protocol-status-dot is-active" />

                <div>

                  <strong>
                    Laissez le jeu prendre les commandes.
                  </strong>

                  <p>
                    À deux. À votre rythme. Sans prévoir la suite.
                  </p>

                </div>

              </div>

            </div>


            {/* ACTIONS */}

            {!hasPartner ? (
              <PairingPanel
                supabase={supabase}
                onPaired={onPaired}
              />
            ) : (
            <div className="protocol-home-hero-actions">

              {error && (
                <p className="protocol-home-message is-error">
                  {error}
                </p>
              )}

              {inviteMessage && (
                <p className="protocol-home-message">
                  {inviteMessage}
                </p>
              )}


              {/* 1 — LANCER */}

              <button
                type="button"
                className="protocol-home-primary"
                onClick={() => setShowLaunchChoice(true)}
                disabled={loading}
              >

                <HomeIcon
                  name="play"
                  size={24}
                  strokeWidth={1.7}
                />

                <span>
                  {loading
                    ? "Création…"
                    : "Lancer une partie"}
                </span>

              </button>


              {/* 2 — REJOINDRE */}

              <button
                type="button"
                className="protocol-home-join-main"
                onClick={() => {
                  setJoinCode("");
                  setJoinError("");
                  setJoinOpen(true);
                }}
              >

                <HomeIcon
                  name="join"
                  size={20}
                />

                <span>
                  Rejoindre une partie
                </span>

              </button>


              {/* 3 — REPRENDRE */}

              {resumeGame && !resumeLoading && (

                <button
                  type="button"
                  className="protocol-home-resume-link"
                  onClick={resumeCurrentGame}
                >

                  <HomeIcon
                    name="play"
                    size={15}
                    strokeWidth={1.6}
                  />

                  <span>
                    Reprendre la partie
                  </span>

                  <small>
                    {resumeGame.sessionCode}
                  </small>

                  {resumeHasUpdate && (
                    <i className="protocol-home-live-dot" />
                  )}

                </button>

              )}

            </div>
            )}

          </div>

        </section>



        {/* =========================================
            NAVIGATION
            ========================================= */}

        <nav className="protocol-home-nav">

          <button
            type="button"
            onClick={() =>
              navigate("/library")
            }
          >

            <HomeIcon
              name="book"
              size={24}
            />

            <strong>
              Bibliothèque
            </strong>

            <small>
              NOS CARTES
            </small>

          </button>


          <button
            type="button"
            onClick={() =>
              navigate("/invitations")
            }
          >

            <span className="protocol-home-nav-icon">

              <HomeIcon
                name="mail"
                size={24}
              />

              <UnreadBadge
                count={unread.invitations}
                label="invitations non ouvertes"
              />

            </span>

            <strong>
              Invitations
            </strong>

            <small>
              À DEUX
            </small>

          </button>


          <button
            type="button"
            onClick={() =>
              navigate("/settings")
            }
          >

            <HomeIcon
              name="settings"
              size={24}
            />

            <strong>
              Réglages
            </strong>

            <small>
              VOTRE ESPACE
            </small>

          </button>

        </nav>



        {/* =========================================
            SIGNAUX
            ========================================= */}

        {/* les signes supposent un partenaire associé */}
        {hasPartner && (
          <PhotoDayHomeNotice
            supabase={supabase}
            onOpen={() => navigate("/messages")}
          />
        )}

        {hasPartner && (
        <section className="protocol-home-signals">

          <div className="protocol-home-section-title">

            <span className="protocol-home-section-line" />

            <h2>
              Lui faire signe
            </h2>

            <small>
              PETITES ENVIES · GRANDS MOMENTS
            </small>

          </div>


          <div className="protocol-home-signal-grid">


            <button
              type="button"
                onClick={() =>
                  navigate(
                    "/messages"
                  )
                }
              disabled={inviteLoading}
            >

              <span className="protocol-home-icon-pink">

                <HomeIcon
                  name="sparkles"
                  size={28}
                />

                <UnreadBadge
                  count={unread.messages}
                  label="messages non lus"
                />

              </span>

              <strong>
                Un message ?
              </strong>

            </button>


            <button
              type="button"
              onClick={() =>
                sendInvitation("challenge")
              }
              disabled={inviteLoading}
            >

              <span className="protocol-home-icon-pink">

                <HomeIcon
                  name="dice"
                  size={28}
                />

              </span>

              <strong>
                Un défi ?
              </strong>

            </button>


            <button
              type="button"
              onClick={() =>
                sendInvitation("tonight")
              }
              disabled={inviteLoading}
            >

              <span className="protocol-home-icon-pink">

                <HomeIcon
                  name="moon"
                  size={28}
                />

              </span>

              <strong>
                Ce soir ?
              </strong>

            </button>

          </div>

        </section>
        )}



        {/* =========================================
            FOOTER
            ========================================= */}

        <footer className="protocol-home-footer">

          <span />

          <p>
            Privé · Discret · À deux
          </p>

          <span />

        </footer>


      </section>



      {/* =========================================
          JOIN BOTTOM SHEET
          ========================================= */}

      {joinOpen && (

        <div
          className="protocol-join-overlay"
          onClick={() =>
            setJoinOpen(false)
          }
        >

          <div
            className="protocol-join-sheet"
            onClick={(event) =>
              event.stopPropagation()
            }
          >

            <button
              type="button"
              className="protocol-join-close"
              onClick={() =>
                setJoinOpen(false)
              }
              aria-label="Fermer"
            >
              ×
            </button>


            <p className="protocol-home-eyebrow">
              REJOINDRE
            </p>


            <h2>
              Entre le code.
            </h2>


            <p className="protocol-join-copy">
              Le code à six caractères
              affiché sur le téléphone de
              ton partenaire.
            </p>


            <form
              onSubmit={joinGameFromHome}
            >

              <input
                value={joinCode}
                onChange={(event) => {

                  setJoinCode(
                    event.target.value
                      .toUpperCase()
                      .replace(
                        /[^A-Z0-9]/g,
                        ""
                      )
                      .slice(0, 6)
                  );

                  setJoinError("");

                }}
                placeholder="······"
                maxLength={6}
                autoFocus
                autoComplete="off"
                spellCheck="false"
              />


              {joinError && (

                <p className="protocol-home-message is-error">
                  {joinError}
                </p>

              )}


              <button
                type="submit"
                className="protocol-join-submit"
                disabled={
                  joinCode.length !== 6 ||
                  joinLoading
                }
              >

                <span>
                  {joinLoading
                    ? "Connexion…"
                    : "Rejoindre la partie"}
                </span>

                <span>
                  →
                </span>

              </button>

            </form>

          </div>

        </div>

      )}

    </main>
  );
}
