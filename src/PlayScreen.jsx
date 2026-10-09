import { useEffect, useRef, useState } from "react";
import Footer from "./Footer.jsx";
import { TYPE_LABELS } from "./gameConstants.js";
import { getGameSession } from "./gameSession.js";
import LoadingScreen from "./LoadingScreen.jsx";
import StateScreen from "./StateScreen.jsx";
import { supabase } from "./supabaseClient.js";
import CardRating from "./CardRating.jsx";

/* =========================================================
   PLAY
   ========================================================= */

export default function PlayScreen({
  code,
  navigate,
}) {
  const [finalStats, setFinalStats] =
    useState(null);

  // carte de fin : la même pour les deux joueurs (choisie à partir du code)
  const [closingCard, setClosingCard] =
    useState(null);

  const [rematchLoading, setRematchLoading] =
    useState(false);

  const [rematchError, setRematchError] =
    useState("");

  const {
    playerNumber,
    valid: hasGameSession,
  } = getGameSession(code);

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

  const [stopLoading, setStopLoading] =
    useState(false);

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

  /* =========================================
     SHARED CARD TIMER
     ========================================= */

  const [timerRemaining, setTimerRemaining] =
    useState(null);

  const [timerRunning, setTimerRunning] =
    useState(false);

  const [timerEndAt, setTimerEndAt] =
    useState(null);

  const [timerUpdating, setTimerUpdating] =
    useState(false);


  const timerInitialSeconds =
    Number(card?.timer_seconds) > 0
      ? Number(card.timer_seconds)
      : null;

  const timerMatchesCurrentCard =
    Boolean(
      game &&
      card &&
      (
        (
          (game.timer_card_source || "official") ===
            "official" &&
          (card.card_source || "official") ===
            "official" &&
          Number(game.timer_card_id) ===
            Number(card.id)
        )
        ||
        (
          game.timer_card_source ===
            "custom" &&
          card.card_source ===
            "custom" &&
          Number(game.timer_custom_card_id) ===
            Number(card.id)
        )
      )
    );


  /*
   * DUEL
   *
   * Un duel chronométré utilise la durée
   * totale de la carte, divisée en deux.
   *
   * Exemple :
   * timer_seconds = 120
   *
   * manche 1 = 60 sec
   * manche 2 = 60 sec
   */
  const timerIsDuel =
    card?.type === "duel" &&
    Boolean(timerInitialSeconds);

  const timerHalfSeconds =
    timerIsDuel
      ? timerInitialSeconds / 2
      : null;


  /*
   * Calcule le temps restant à partir
   * de l'état partagé Supabase.
   *
   * timer_remaining_seconds =
   * durée restante au dernier START/PAUSE.
   *
   * timer_started_at =
   * moment où le chrono a été lancé/repris.
   */
  const getSharedTimerRemaining = () => {
    if (
      !timerInitialSeconds ||
      !game ||
      !timerMatchesCurrentCard
    ) {
      return timerInitialSeconds;
    }

    const baseRemaining =
      Number(
        game.timer_remaining_seconds
      );

    const safeBase =
      Number.isFinite(baseRemaining)
        ? Math.max(
            0,
            baseRemaining
          )
        : timerInitialSeconds;

    if (
      !game.timer_running ||
      !game.timer_started_at
    ) {
      return safeBase;
    }

    const startedAt =
      new Date(
        game.timer_started_at
      ).getTime();

    if (!Number.isFinite(startedAt)) {
      return safeBase;
    }

    const elapsedSeconds =
      Math.max(
        0,
        (
          Date.now() -
          startedAt
        ) / 1000
      );

    return Math.max(
      0,
      Math.ceil(
        safeBase -
        elapsedSeconds
      )
    );
  };


  /*
   * Synchronisation de l'affichage local
   * depuis l'état partagé.
   */
  const syncTimer = () => {
    if (!timerInitialSeconds) {
      setTimerRemaining(null);
      setTimerRunning(false);
      setTimerEndAt(null);
      return;
    }

    const remaining =
      getSharedTimerRemaining();

    setTimerRemaining(
      remaining
    );

    const sharedRunning =
      Boolean(
        game?.timer_running &&
        game?.timer_started_at &&
        timerMatchesCurrentCard &&
        remaining > 0
      );

    setTimerRunning(
      sharedRunning
    );

    if (sharedRunning) {
      setTimerEndAt(
        Date.now() +
          remaining * 1000
      );
    } else {
      setTimerEndAt(null);
    }
  };


  /*
   * DÉMARRER / REPRENDRE
   *
   * N'importe lequel des deux appareils
   * peut lancer le chrono.
   *
   * L'heure absolue est enregistrée dans
   * Supabase puis reçue par les deux écrans.
   */
  const startTimer = async () => {
    if (
      !timerInitialSeconds ||
      timerUpdating ||
      !hasGameSession
    ) {
      return;
    }

    try {
      setTimerUpdating(true);

      const sameCard =
        timerMatchesCurrentCard;

      const currentRemaining =
        sameCard &&
        Number(
          game?.timer_remaining_seconds
        ) >= 0
          ? getSharedTimerRemaining()
          : timerInitialSeconds;

      const seconds =
        currentRemaining > 0
          ? currentRemaining
          : timerInitialSeconds;

      const {
        error: timerError,
      } = await supabase.rpc(
        "update_protocol_timer",
        {
          p_game_code: code,
          p_card_id:
            card.id,
          p_started_at:
            null,
          p_remaining_seconds:
            seconds,
          p_running:
            true,
        }
      );

      if (timerError) {
        throw timerError;
      }

      setTimerRemaining(
        seconds
      );

      setTimerRunning(true);

      setTimerEndAt(
        Date.now() +
          seconds * 1000
      );

      await loadState();

    } catch (err) {
      console.error(
        "TIMER START ERROR:",
        err
      );

      setError(
        err?.message ||
        "Impossible de démarrer le chrono."
      );

    } finally {
      setTimerUpdating(false);
    }
  };


  /*
   * PAUSE PARTAGÉE
   */
  const pauseTimer = async () => {
    if (
      !timerInitialSeconds ||
      timerUpdating ||
      !hasGameSession
    ) {
      return;
    }

    try {
      setTimerUpdating(true);

      const remaining =
        getSharedTimerRemaining();

      const {
        error: timerError,
      } = await supabase.rpc(
        "update_protocol_timer",
        {
          p_game_code: code,
          p_card_id:
            card.id,
          p_started_at:
            null,
          p_remaining_seconds:
            remaining,
          p_running:
            false,
        }
      );

      if (timerError) {
        throw timerError;
      }

      setTimerRemaining(
        remaining
      );

      setTimerRunning(false);
      setTimerEndAt(null);

      await loadState();

    } catch (err) {
      console.error(
        "TIMER PAUSE ERROR:",
        err
      );

      setError(
        err?.message ||
        "Impossible de mettre le chrono en pause."
      );

    } finally {
      setTimerUpdating(false);
    }
  };


  /*
   * RESET PARTAGÉ
   */
  const resetTimer = async () => {
    if (
      !timerInitialSeconds ||
      timerUpdating ||
      !hasGameSession
    ) {
      return;
    }

    try {
      setTimerUpdating(true);

      const {
        error: timerError,
      } = await supabase.rpc(
        "update_protocol_timer",
        {
          p_game_code: code,
          p_card_id:
            card.id,
          p_started_at:
            null,
          p_remaining_seconds:
            timerInitialSeconds,
          p_running:
            false,
        }
      );

      if (timerError) {
        throw timerError;
      }

      setTimerRemaining(
        timerInitialSeconds
      );

      setTimerRunning(false);
      setTimerEndAt(null);

      await loadState();

    } catch (err) {
      console.error(
        "TIMER RESET ERROR:",
        err
      );

      setError(
        err?.message ||
        "Impossible de réinitialiser le chrono."
      );

    } finally {
      setTimerUpdating(false);
    }
  };


  const formatTimer = (seconds) => {
    const safeSeconds =
      Math.max(
        0,
        Math.ceil(
          Number(seconds) || 0
        )
      );

    const minutes =
      Math.floor(
        safeSeconds / 60
      );

    const remainingSeconds =
      safeSeconds % 60;

    return `${minutes}:${String(
      remainingSeconds
    ).padStart(2, "0")}`;
  };


  /* =========================================
     TIMER LIFECYCLE
     ========================================= */


  /*
   * Dès que :
   *
   * - la carte change
   * - le timer partagé change
   * - Realtime recharge game
   *
   * on recale l'affichage local.
   */
  useEffect(() => {
    syncTimer();

  }, [
      card?.id,
      card?.card_source,
      card?.timer_seconds,

      game?.timer_card_source,
      game?.timer_card_id,
      game?.timer_custom_card_id,
      game?.timer_started_at,
      game?.timer_remaining_seconds,
      game?.timer_running,
    ]);


  /*
   * Animation locale.
   *
   * Supabase fournit la référence temporelle.
   * Date.now() fournit l'affichage fluide.
   *
   * On ne fait donc PAS une requête Supabase
   * toutes les 250 ms, évidemment.
   */
  useEffect(() => {
    if (
      !timerRunning ||
      !game?.timer_started_at
    ) {
      return;
    }

    const interval =
      window.setInterval(
        () => {
          const remaining =
            getSharedTimerRemaining();

          setTimerRemaining(
            remaining
          );

          if (remaining <= 0) {
            setTimerRunning(false);
            setTimerEndAt(null);
          }
        },
        250
      );

    return () => {
      window.clearInterval(
        interval
      );
    };

  }, [
    timerRunning,
    game?.timer_started_at,
    game?.timer_remaining_seconds,
    game?.timer_card_id,
    card?.id,
  ]);


  /*
   * Retour d'arrière-plan iOS / focus navigateur.
   *
   * On recalcule depuis l'heure absolue.
   * Le chrono ne "gèle" donc pas lorsque
   * Safari/PWA suspend JavaScript.
   */
  useEffect(() => {
    const handleVisibilityChange =
      () => {
        if (
          document.visibilityState ===
          "visible"
        ) {
          syncTimer();
        }
      };

    document.addEventListener(
      "visibilitychange",
      handleVisibilityChange
    );

    window.addEventListener(
      "focus",
      syncTimer
    );

    return () => {
      document.removeEventListener(
        "visibilitychange",
        handleVisibilityChange
      );

      window.removeEventListener(
        "focus",
        syncTimer
      );
    };

  }, [
    game?.timer_started_at,
    game?.timer_remaining_seconds,
    game?.timer_running,
    game?.timer_card_id,
    card?.id,
  ]);


  const timerDisplaySeconds =
    timerRemaining ??
    timerInitialSeconds ??
    0;


  /*
   * Cercle = progression GLOBALE.
   */
  const timerProgress =
    timerInitialSeconds
      ? Math.max(
          0,
          Math.min(
            1,
            timerDisplaySeconds /
              timerInitialSeconds
          )
        )
      : 0;


  const timerCompleted =
    Boolean(timerInitialSeconds) &&
    timerDisplaySeconds === 0;


  /*
   * DUEL
   *
   * Première moitié :
   * joueur actif de la carte.
   *
   * Deuxième moitié :
   * partenaire.
   */
  const timerDuelRound =
    timerIsDuel &&
    timerHalfSeconds !== null
      ? timerDisplaySeconds >
        timerHalfSeconds
        ? 1
        : 2
      : null;


  /*
   * Temps affiché pour la manche.
   *
   * 120 total :
   *
   * 120 -> Joueur actif 1:00
   *  90 -> Joueur actif 0:30
   *  60 -> Partenaire   1:00
   *  30 -> Partenaire   0:30
   *   0 -> TERMINÉ      0:00
   */
  const timerRoundSeconds =
    timerIsDuel &&
    timerHalfSeconds !== null
      ? timerCompleted
        ? 0
        : timerDuelRound === 1
          ? timerDisplaySeconds -
            timerHalfSeconds
          : timerDisplaySeconds
      : timerDisplaySeconds;


  /*
   * Phase affichée par l'annonce de carte : quand la
   * phase vient de changer, l'annonce la met en avant
   * (remplace l'ancien bandeau séparé, qui recouvrait
   * l'en-tête). Calculé une fois par annonce.
   */
  const [revealPhase, setRevealPhase] =
    useState({
      key: null,
      phase: null,
      isNew: false,
    });
  const loadStateInFlightRef =
    useRef(false);

  const loadStatePendingRef =
    useRef(false);

  /* chargement relancé en attente : les appels qui arrivent
     pendant un chargement en cours attendent son résultat
     (sinon le premier affichage restait bloqué sur
     « Préparation… », sans partie ni erreur) */
  const loadStateQueuedRef =
    useRef(null);

  const currentCardRef =
    useRef(null);

  useEffect(() => {
    currentCardRef.current =
      card;
  }, [card]);

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
      "mark_scene_step_read_guarded",
      {
        p_game_code:
          code,

        p_expected_card_id:
          card?.id,

        p_expected_scene_step_no:
          game?.scene_step_no,
      }
    );

    if (error) {
      throw error;
    }

    if (data?.stale) {
      await loadState();
      return;
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
      "advance_scene_step_guarded",
      {
        p_game_code:
          code,

        p_expected_card_id:
          card?.id,

        p_expected_scene_step_no:
          game?.scene_step_no,
      }
    );

    if (error) {
      throw error;
    }

    if (data?.stale) {
      await loadState();
      return;
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

    /*
    * A18
    * Un seul chargement d'état à la fois.
    */
    if (
      loadStateInFlightRef.current
    ) {
      loadStatePendingRef.current =
        true;

      if (!loadStateQueuedRef.current) {
        let resolve;
        let reject;

        const promise =
          new Promise((ok, ko) => {
            resolve = ok;
            reject = ko;
          });

        // une erreur que personne n'attend reste silencieuse
        promise.catch(() => {});

        loadStateQueuedRef.current = {
          promise,
          resolve,
          reject,
        };
      }

      return loadStateQueuedRef.current.promise;
    }


    loadStateInFlightRef.current =
      true;


    try {

      if (!hasGameSession) {
        throw new Error(
          "Session de partie invalide."
        );
      }


      const {
        data,
        error: gameError,
      } = await supabase.rpc(
        "get_protocol_game",
        {
          p_game_code: code,
        }
      );


      if (gameError) {
        throw gameError;
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


      /*
      * Partie terminée.
      */
      if (
        gameData.status ===
        "finished"
      ) {
        setGame(gameData);
        setCard(null);

        currentCardRef.current =
          null;

        return;
      }


      /*
      * Revanche.
      */
      if (
        gameData.status ===
        "ready"
      ) {
        setGame(gameData);
        setCard(null);

        currentCardRef.current =
          null;

        navigate(
          `/game/${code}`
        );

        return;
      }


      /*
      * Pause globale.
      */
      if (
        gameData.status ===
        "paused"
      ) {

        setGame(gameData);


        const currentCard =
          currentCardRef.current;


        if (
          !currentCard ||
          currentCard.card_source !==
            gameData.current_card_source ||
          Number(
            currentCard.source_id
          ) !==
            Number(
              gameData.current_card_source ===
                "custom"
                ? gameData.current_custom_card_id
                : gameData.current_card_id
            )
        ) {

          const {
            data: pausedCard,
            error: pausedCardError,
          } = await supabase.rpc(
            "get_protocol_current_card",
            {
              p_game_code: code,
            }
          );


          if (pausedCardError) {
            throw pausedCardError;
          }


          setCard(pausedCard);

          currentCardRef.current =
            pausedCard;


          await Promise.all([
            loadSceneState(
              pausedCard
            ),
            loadActiveRules(),
          ]);
        }


        return;
      }


      /*
      * Route play mais partie
      * pas encore réellement en cours.
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
      } = await supabase.rpc(
        "get_protocol_current_card",
        {
          p_game_code: code,
        }
      );


      if (cardError) {
        throw cardError;
      }


      setGame(gameData);
      setCard(cardData);

      currentCardRef.current =
        cardData;


      await Promise.all([
        loadSceneState(
          cardData
        ),
        loadActiveRules(),
      ]);


    } finally {

      loadStateInFlightRef.current =
        false;


      if (
        loadStatePendingRef.current
      ) {

        loadStatePendingRef.current =
          false;

        const queued =
          loadStateQueuedRef.current;

        loadStateQueuedRef.current =
          null;

        loadState().then(
          queued?.resolve,
          (err) => {
            if (queued) {
              queued.reject(err);
            } else {
              console.warn(
                "PLAY RELOAD ERROR:",
                err
              );
            }
          }
        );
      }
    }
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
              err?.message === "Partie introuvable."
                ? "Partie introuvable."
                : "Impossible de charger la partie."
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
    };

  }, [code]);


      /* =========================================
        FINAL STATS
        ========================================= */

      useEffect(() => {
        if (
          !game ||
          game.status !== "finished"
        ) {
          return;
        }

        let active = true;

        const loadFinalStats = async () => {
          try {
            const {
              data,
              error: statsError,
            } = await supabase.rpc(
              "get_protocol_final_stats",
              {
                p_game_code: code,
              }
            );

            if (statsError) {
              throw statsError;
            }

            if (active) {
              setFinalStats(data);
            }

            const {
              data: closingCards,
            } = await supabase
              .from("protocol_cards")
              .select("id, title, prompt")
              .eq("library_version", "closing")
              .eq("active", true)
              .order("id");

            if (active && closingCards?.length) {
              let hash = 0;
              for (const ch of code) {
                hash = (hash * 31 + ch.charCodeAt(0)) >>> 0;
              }
              setClosingCard(
                closingCards[hash % closingCards.length]
              );
            }

          } catch (err) {
            console.error(
              "FINAL STATS ERROR:",
              err
            );
          }
        };

        loadFinalStats();

        return () => {
          active = false;
        };
      }, [
        game?.status,
        code,
      ]);

  /* =========================================
      GLOBAL STOP
      ========================================= */

    const stopProtocol =
      async () => {
        if (
          stopLoading ||
          !hasGameSession ||
          game?.status !== "playing"
        ) {
          return;
        }

        try {
          setStopLoading(true);
          setError("");

        setGame(
          (previous) =>
            previous
              ? {
                  ...previous,
                  status:
                    "paused",
                }
              : previous
        );

          /*
          * Le STOP Lovense part immédiatement,
          * mais ne bloque jamais la pause
          * de la partie.
          */
          supabase.functions
            .invoke(
              "lovense-command",
              {
                body: {
                  action:
                    "stop",
                },
              }
            )
            .then(
              ({
                data:
                  lovenseData,
                error:
                  lovenseError,
              }) => {

                if (
                  lovenseError ||
                  !lovenseData
                    ?.success
                ) {
                  console.warn(
                    "LOVENSE STOP WARNING:",
                    lovenseError ||
                      lovenseData?.error
                  );
                }

              }
            )
            .catch(
              (lovenseErr) => {

                console.warn(
                  "LOVENSE STOP ERROR:",
                  lovenseErr
                );

              }
            );


          /*
          * 2. Pause globale de la partie.
          */
          const {
            error: stopError,
          } = await supabase.rpc(
            "stop_protocol_game",
            {
              p_game_code: code,
            }
          );

          if (stopError) {
            throw stopError;
          }

          /*
          * Mise à jour immédiate de ce téléphone.
          * L'autre suivra via le polling.
          */
          await loadState();

        } catch (err) {

          console.error(
            "PROTOCOL STOP ERROR:",
            err
          );


          await loadState()
            .catch(() => {});


          setError(
            err?.message ||
              "Impossible de mettre la partie en pause."
          );

        } finally {
          setStopLoading(false);
        }
      };


    const resumeProtocol =
      async () => {
        if (
          stopLoading ||
          !hasGameSession ||
          game?.status !== "paused"
        ) {
          return;
        }

        try {
          setStopLoading(true);
          setError("");

          const {
            error: resumeError,
          } = await supabase.rpc(
            "resume_protocol_game",
            {
              p_game_code: code,
            }
          );

          if (resumeError) {
            throw resumeError;
          }

          await loadState();

        } catch (err) {
          console.error(
            "PROTOCOL RESUME ERROR:",
            err
          );

          setError(
            err?.message ||
              "Impossible de reprendre la partie."
          );

        } finally {
          setStopLoading(false);
        }
      };



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
          "advance_protocol_guarded",
          {
            p_game_code:
              code,

            p_action:
              action,

            p_duel_winner:
              duelWinner,

            p_expected_turn_no:
              game?.turn_no,

            p_expected_card_id:
              card?.id,

            p_expected_card_source:
              card?.card_source ||
              "official",
          }
        );

        if (rpcError) {
          throw rpcError;
        }

        if (data?.stale) {
          await loadState();
          return;
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

        /* message humain : l'erreur technique reste en console */
        setError(
          /not active player/i.test(err?.message || "")
            ? "C'est à l'autre de valider ce tour."
            : "Impossible de continuer. Réessaie dans un instant."
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
          "buy_protocol_bonus_guarded",
          {
            p_game_code:
              code,

            p_bonus:
              bonus,

            p_expected_turn_no:
              game?.turn_no,

            p_expected_card_id:
              card?.id,

            p_expected_card_source:
              card?.card_source ||
              "official",
          }
        );

        if (rpcError) {
          throw rpcError;
        }

        if (data?.stale) {
          await loadState();
          return;
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
          "use_choose_type_guarded",
          {
            p_game_code:
              code,

            p_card_type:
              cardType,

            p_expected_turn_no:
              game?.turn_no,

            p_expected_card_id:
              card?.id,

            p_expected_card_source:
              card?.card_source ||
              "official",
          }
        );

        if (data?.stale) {
          await loadState();
          return;
        }

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
        finalStats?.max_intensity ||
        game.shared_profile?.intensity ||
        null;


      const startRematch =
        async () => {

          try {

            setRematchLoading(true);
            setRematchError("");

            const {
              data,
              error: rematchRpcError,
            } = await supabase.rpc(
              "rematch_protocol",
              {
                p_game_code: code,
              }
            );


            if (rematchRpcError) {
              throw rematchRpcError;
            }


            console.log(
              "REMATCH READY:",
              data
            );


            navigate(
              `/game/${code}`
            );


          } catch (err) {

            console.error(
              "REMATCH ERROR:",
              err
            );


            setRematchError(
              err?.message ||
              "Impossible de préparer la revanche."
            );


          } finally {

            setRematchLoading(false);

          }

        };


      const closeProtocol = () => {
        navigate("/");
      };


      return (

        <main className="app final-page final-wow-page">

          <div className="final-glow final-glow-top" />
          <div className="final-glow final-glow-bottom" />


          <header className="header final-header">

            <span className="logo">
              PROTOCOL
            </span>

            <span className="pill final-pill">
              Terminé
            </span>

          </header>


          <section className="final-screen final-wow-screen">


            {/* =====================================
                REVEAL
                ===================================== */}

            <div className="final-reveal">

              <p className="kicker final-reveal-kicker">
                SESSION TERMINÉE
              </p>



              <h1 className="final-winner-title">
                Vous êtes allés
                <br />
                jusqu'au bout.
              </h1>

            </div>


            {/* =====================================
                SCORE
                ===================================== */}

            <div className="final-wow-score">

              <div
                className={
                  winner === 1
                    ? "final-wow-player final-wow-winner"
                    : "final-wow-player"
                }
              >

                <span>
                  {player1Name}
                </span>

                <strong>
                  {score1}
                </strong>

              </div>


              <div className="final-wow-separator">
                <span>—</span>
              </div>


              <div
                className={
                  winner === 2
                    ? "final-wow-player final-wow-winner"
                    : "final-wow-player"
                }
              >

                <span>
                  {player2Name}
                </span>

                <strong>
                  {score2}
                </strong>

              </div>

            </div>

            <p className="final-result-copy">
              {winnerName
                ? `${winnerName} termine en tête.`
                : "Vous terminez à égalité."}
            </p>


            {/* =====================================
                SESSION SUMMARY
                ===================================== */}

            {finalStats && (
              <div className="final-session-summary">

                <span>
                  {finalStats.total_cards} DÉFIS
                </span>

                <span className="final-session-dot">
                  ·
                </span>

                <span>
                  {finalStats.duels} DUELS
                </span>

                <span className="final-session-dot">
                  ·
                </span>

                <span>
                  {finalStats.scenes}{" "}
                  {finalStats.scenes === 1
                    ? "SCÈNE"
                    : "SCÈNES"}
                </span>

              </div>
            )}


            {/* =====================================
                CARTE DE FIN
                ===================================== */}

            {closingCard && (
              <section className="final-closing-card">
                <p className="final-closing-card-kicker">
                  Le mot de la fin
                </p>
                <h2>
                  {closingCard.title}
                </h2>
                <p>
                  {closingCard.prompt}
                </p>
              </section>
            )}


            {/* =====================================
                CLOSING
                ===================================== */}

            <div className="final-wow-closing final-afterglow">

              <span className="final-symbol">
                <span className="protocol-diamond" aria-hidden="true" />
              </span>

              <div className="final-afterglow-copy">

                <p className="final-afterglow-lead">
                  Le jeu s'arrête ici.
                  <br />
                  <strong>
                    Pas forcément la soirée.
                  </strong>
                </p>

                <p className="final-afterglow-text">
                  Vous connaissez maintenant un peu mieux
                  <br />
                  les envies et les réactions de l'autre.
                  <br />
                  <span>
                    À vous de décider ce que vous en faites.
                  </span>
                </p>

              </div>

            </div>


            {/* =====================================
                ACTIONS
                ===================================== */}

            {rematchError && (

              <p className="error">
                {rematchError}
              </p>

            )}


            <div className="final-wow-actions">

              <button
                className="primary final-rematch"
                onClick={startRematch}
                disabled={rematchLoading}
              >

                <span>
                  {rematchLoading
                    ? "Préparation…"
                    : "Rejouer ensemble"}
                </span>

                <span>
                  ↻
                </span>

              </button>


              <p className="final-rematch-hint">
                Même duo.
                {" "}
                Nouvelle calibration.
                {" "}
                Aucun code à réencoder.
              </p>


              <button
                type="button"
                className="final-close-button"
                onClick={closeProtocol}
                disabled={rematchLoading}
              >
                Terminer le Protocol
              </button>

            </div>

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

  const duelReward =
    card?.intensity >= 5
      ? 6
      : card?.intensity >= 3
        ? 4
        : 2;

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

  /*
   * Nouvelle annonce de carte : on retient si la phase
   * a changé depuis l'annonce précédente (modèle React
   * « information du rendu précédent », sans ref).
   */
  const revealKey =
    `${card.id}-${sceneState?.step_no || 0}`;

  if (revealPhase.key !== revealKey) {
    setRevealPhase({
      key: revealKey,
      phase: game.phase,
      isNew:
        revealPhase.phase !== game.phase,
    });
  }

  return (
    <main className="app play-page">

      <div className="glow glow-center" />


      {/* =====================================
          GLOBAL STOP
          ===================================== */}

      {game.status === "paused" ? (

        <div className="protocol-stop-overlay">

          <div className="protocol-stop-panel">

            <span className="protocol-stop-label">
              PROTOCOL EN PAUSE
            </span>

            <h1>
              STOP
            </h1>

            <p>
              La partie est arrêtée pour vous deux.
            </p>

            <p className="protocol-stop-copy">
              Prenez le temps nécessaire.
              Rien ne reprend automatiquement.
            </p>

            <button
              type="button"
              className="protocol-resume-button"
              onClick={resumeProtocol}
              disabled={stopLoading}
            >
              {stopLoading
                ? "Reprise…"
                : "Reprendre ensemble"}
            </button>

          </div>

        </div>

      ) : null}


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


        {game.status !== "paused" && (
          <button
            type="button"
            className="protocol-stop-button"
            onClick={stopProtocol}
            disabled={stopLoading}
            aria-label="Arrêter immédiatement le Protocol"
          >
            STOP
          </button>
        )}

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
          {myBonuses.choose_type_armed ? (
            <span className="bonus-toggle-armed">
              Prochaine : {TYPE_LABELS[myBonuses.choose_type_armed] || myBonuses.choose_type_armed}
            </span>
          ) : (
            <>{myScore} pts</>
          )}
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
            <span className="bonus-button-content">
              <span className="bonus-button-title">
                Double récompense
              </span>

              <small>
                Double les points de ta prochaine carte réussie.
              </small>
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
            <span className="bonus-button-content">
              <span className="bonus-button-title">
                Prendre la main
              </span>

              <small>
                Joue aussi le prochain tour à la place de l'autre.
              </small>
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
                myBonuses.choose_type ||
                myBonuses.choose_type_armed
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
              (
                !myBonuses.choose_type &&
                !myBonuses.choose_type_armed &&
                myScore < 2
              )
            }
          >
            <span className="bonus-button-content">
              <span className="bonus-button-title">
                Imposer le type
              </span>

              <small>
                Choisis le type de la prochaine carte.
              </small>
            </span>

            <strong>
              {myBonuses.choose_type_armed
                ? (TYPE_LABELS[myBonuses.choose_type_armed] || myBonuses.choose_type_armed)
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

            
            {myBonuses.choose_type_armed && (

              <button
                onClick={() =>
                  chooseNextType(
                    "auto"
                  )
                }
                disabled={nextLoading}
              >
                <span>↺</span>
                Automatique
              </button>

            )}

          </div>

        </div>
      )}


      {/* =====================================
          TAKE CONTROL
          ===================================== */}

      {myBonuses.take_control && isMyTurn && (
        <button
          className="activate-bonus"

          onClick={async () => {
            try {
              setNextLoading(true);
              setError("");

              const {
                data,
                error: bonusError,
              } = await supabase.rpc(
                "use_take_control_guarded",
                {
                  p_game_code:
                    code,

                  p_expected_turn_no:
                    game?.turn_no,

                  p_expected_card_id:
                    card?.id,

                  p_expected_card_source:
                    card?.card_source ||
                    "official",
                }
              );

              if (bonusError) {
                throw bonusError;
              }

              if (data?.stale) {
                await loadState();
                return;
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

      <section
        className={
          `play play-type-${card.type} ${
            card.intensity >= 5
              ? "play-intensity-max"
              : ""
          }`
        }
      >

        {/* =====================================
            CARD REVEAL
            ===================================== */}

        <div
          key={
            `reveal-${card.id}-${sceneState?.step_no || 0}`
          }
          className={
            `card-reveal card-reveal-${card.type}${
              revealPhase.isNew &&
              phaseLabels[game.phase]
                ? " card-reveal-new-phase"
                : ""
            }`
          }
          aria-hidden="true"
        >

          {card.type === "duel" ? (

            <div className="card-reveal-inner card-reveal-duel-inner">

              <span className="card-reveal-kicker">
                DUEL
              </span>

              <div className="card-reveal-faceoff">

                <strong className="card-reveal-player card-reveal-player-left">
                  {player1Name}
                </strong>

                <span className="card-reveal-vs">
                  VS
                </span>

                <strong className="card-reveal-player card-reveal-player-right">
                  {player2Name}
                </strong>

              </div>

              <span className="card-reveal-whisper">
                UN SEUL GAGNE
              </span>

            </div>

          ) : (

            <div className="card-reveal-inner">

              <span className="card-reveal-kicker">
                {isMyTurn
                  ? `${myName.toUpperCase()} · À TOI`
                  : activePlayerName.toUpperCase()}
              </span>

              <strong className="card-reveal-type">
                {typeLabels[card.type]}
              </strong>

              {revealPhase.isNew &&
              phaseLabels[game.phase] ? (
                <span className="card-reveal-phase">
                  <i aria-hidden="true" />
                  {phaseLabels[game.phase]}
                  <i aria-hidden="true" />
                </span>
              ) : (
                <span className="card-reveal-whisper">
                  {card.intensity >= 5
                    ? "INTENSITÉ MAX"
                    : phaseLabels[game.phase]}
                </span>
              )}

            </div>

          )}

        </div>


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


          <span className="play-meta-turn">
            {isMyTurn
              ? `À toi, ${myName}`
              : `Au tour de ${activePlayerName}`}
          </span>


          <span className="play-meta-progress">
            {phaseLabels[game.phase] && (
              <small>
                {phaseLabels[game.phase]
                  .toLowerCase()
                  .replace(/^./, (c) => c.toUpperCase())}
              </small>
            )}
            <strong>
              {game.turn_no}
              <span>/</span>
              {game.target_turns}
            </strong>
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
            className={
              `game-card game-card-${card.type} card-reveal-content ${
                card.intensity >= 5
                  ? "game-card-intensity-max"
                  : ""
              }`
            }
          >

          {card.title && (
            <p className="kicker">
              {/* passe 2 : titre en sérif, casse d'origine */}
              {card.title}
            </p>
          )}

        {sceneState?.is_multistep && (
          <div className="scene-progress">

            {/* étapes : barres dans la couleur de la scène */}
            <span
              className="scene-progress-steps"
              aria-hidden="true"
            >
              {Array.from({
                length: sceneState.step_count || 0,
              }).map((_, index) => (
                <i
                  key={index}
                  className={
                    index < sceneState.step_no
                      ? "is-done"
                      : ""
                  }
                />
              ))}
            </span>

            <span>
              Étape {sceneState.step_no}
              {" / "}
              {sceneState.step_count}
              {sceneState.is_private && " · Privé"}
            </span>

          </div>
        )}

        {/* le titre d'étape n'apparaît que s'il
            diffère du titre de la carte */}
        {sceneState?.title &&
          sceneState.title !== card.title && (
          <p className="scene-step-title">
            {sceneState.title}
          </p>
        )}

        <p
          className={`card-prompt ${promptSizeClass}`}
        >
          {displayPrompt}
        </p>


        {timerInitialSeconds && (
          <div
            className={
              timerCompleted
                ? "protocol-timer protocol-timer-complete"
                : timerRunning
                  ? "protocol-timer protocol-timer-running"
                  : "protocol-timer"
            }
          >

            <div
              className="protocol-timer-ring"
              style={{
                "--timer-progress":
                  `${timerProgress * 360}deg`,
              }}
            >
              <div className="protocol-timer-inner">

                <span className="protocol-timer-label">
                  {timerCompleted
                    ? "TERMINÉ"
                    : timerIsDuel
                      ? timerDuelRound === 1
                        ? (
                            game?.active_player === 1
                              ? game?.player_1_name || "JOUEUR 1"
                              : game?.player_2_name || "JOUEUR 2"
                          )
                        : (
                            game?.active_player === 1
                              ? game?.player_2_name || "JOUEUR 2"
                              : game?.player_1_name || "JOUEUR 1"
                          )
                      : timerRunning
                        ? "EN COURS"
                        : "CHRONO"}
                </span>

                <strong>
                  {formatTimer(
                    timerIsDuel
                      ? timerRoundSeconds
                      : timerDisplaySeconds
                  )}
                </strong>

              </div>
            </div>


            <div className="protocol-timer-controls">

              {timerCompleted ? (

                <button
                  type="button"
                  className="protocol-timer-main"
                  onClick={resetTimer}
                >
                  RÉINITIALISER
                </button>

              ) : timerRunning ? (

                <button
                  type="button"
                  className="protocol-timer-main"
                  onClick={pauseTimer}
                >
                  PAUSE
                </button>

              ) : (

                <button
                  type="button"
                  className="protocol-timer-main"
                  onClick={startTimer}
                >
                  {timerRemaining !== null &&
                  timerRemaining <
                    timerInitialSeconds
                    ? "REPRENDRE"
                    : "DÉMARRER"}
                </button>

              )}


              {!timerRunning &&
                !timerCompleted &&
                timerRemaining !== null &&
                timerRemaining <
                  timerInitialSeconds && (

                  <button
                    type="button"
                    className="protocol-timer-reset"
                    onClick={resetTimer}
                  >
                    RÉINITIALISER
                  </button>

                )}

            </div>

          </div>
        )}

        </div>

          {/* avis facultatif et privé : n'influence pas le tirage */}
          <CardRating
            key={`${card.card_source || "official"}-${card.id}`}
            supabase={supabase}
            cardSource={card.card_source || "official"}
            cardId={card.id}
            className="card-rating-play"
          />


        {/* ===================================
            ACTIONS
            =================================== */}

        <div
          key={`actions-${card.id}-${sceneState?.step_no || 0}`}
          className="play-bottom card-reveal-actions"
        >


          {/* DUEL */}

          {card.type === "duel" ? (

            <div className="duel-actions">

              <p className="duel-question">
                Qui remporte ce duel ?
              </p>

              {/* seul le joueur qui a la main désigne le gagnant
                  (le serveur refuse sinon) */}
              {!isMyTurn && (
                <p className="duel-hint">
                  {activePlayerName} désigne le gagnant.
                </p>
              )}


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
                    nextLoading ||
                    !isMyTurn
                  }
                >
                  <span>
                    {player1Name}
                  </span>

                  <strong>
                    +{duelReward}
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
                    nextLoading ||
                    !isMyTurn
                  }
                >
                  <span>
                    {player2Name}
                  </span>

                  <strong>
                    +{duelReward}
                  </strong>
                </button>

              </div>


              {isMyTurn && (
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
              )}

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

                <div className="waiting-presence">
                  <span
                    className="protocol-diamond"
                    aria-hidden="true"
                  />

                  <p className="waiting-text">
                    À <em>{activePlayerName}</em> de jouer.
                  </p>

                  <small>
                    Laisse-toi porter.
                  </small>
                </div>

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
