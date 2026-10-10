import { useEffect, useRef, useState } from "react";
import Footer from "./Footer.jsx";
import { PROTOCOL_LAST_SEEN_CARD_KEY, clearGameSession, getGameSession } from "./gameSession.js";
import HowToPlay from "./HowToPlay.jsx";
import { getCurrentPushSubscription, registerPushNotifications } from "./pushNotifications.js";
import { BackIcon } from "./ScreenHeader.jsx";
import { SettingsGroup, SettingsRow, SettingsSheet } from "./SettingsParts.jsx";
import { supabase } from "./supabaseClient.js";

/* =========================================================
   SETTINGS
   ========================================================= */

const CARD_STYLE_LABELS = {
  vanilla: "Vanilla",
  kinky: "Kinky",
  both: "Les deux",
};

const DURATION_LABELS = {
  short: "Courte",
  normal: "Normale",
  long: "Longue",
};

export default function SettingsScreen({
  navigate,
  couple,
  onCoupleChanged,
}) {
  // get_protocol_couple renvoie « id » (et non « couple_id »)
  const coupleId =
    couple?.id || couple?.couple_id || null;

  const [showHowTo, setShowHowTo] =
    useState(false);

  // panneau de détail ouvert : pairing, ambiance, notifications, lovense
  const [sheet, setSheet] =
    useState(null);
  const [permission, setPermission] =
    useState(() => {
      if (!("Notification" in window)) {
        return "unsupported";
      }

      return Notification.permission;
    });

  const [subscribed, setSubscribed] =
    useState(false);

  const [checkingSubscription, setCheckingSubscription] =
    useState(true);

  const [requesting, setRequesting] =
    useState(false);

  const [message, setMessage] =
    useState("");

  const [deleteAccountLoading, setDeleteAccountLoading] =
    useState(false);

  const [deleteAccountMessage, setDeleteAccountMessage] =
    useState("");

  const [coupleInviteCode, setCoupleInviteCode] =
    useState("");

  const [coupleJoinCode, setCoupleJoinCode] =
    useState("");

  const [coupleActionLoading, setCoupleActionLoading] =
    useState(false);

  const [coupleMessage, setCoupleMessage] =
    useState("");

  const [directorMode, setDirectorMode] =
    useState("classic");

  const [directorProfile, setDirectorProfile] =
    useState(null);

  const [directorDuration, setDirectorDuration] =
    useState("normal");

  const [directorLoading, setDirectorLoading] =
    useState(true);

  const [directorSaving, setDirectorSaving] =
    useState(false);

  const [directorMessage, setDirectorMessage] =
    useState("");

  const [hasLocalGameSession, setHasLocalGameSession] =
    useState(() => getGameSession().valid);

  const [lovenseQr, setLovenseQr] =
    useState("");

  const [lovenseCode, setLovenseCode] =
    useState("");

  const [lovenseLoading, setLovenseLoading] =
    useState(false);

  const [lovenseMessage, setLovenseMessage] =
    useState("");

  const [lovenseOpening, setLovenseOpening] =
    useState(false);

  const [lovenseTestLoading, setLovenseTestLoading] =
    useState(false);

  const [lovenseTestMessage, setLovenseTestMessage] =
    useState("");

  const [lovenseConnected, setLovenseConnected] =
    useState(false);

  const [lovenseStatusLoading, setLovenseStatusLoading] =
    useState(true);

  const [lovenseToyName, setLovenseToyName] =
    useState("");

  const [lovenseSdkError, setLovenseSdkError] =
    useState("");

  const [
    lovenseDisconnectLoading,
    setLovenseDisconnectLoading,
  ] =
    useState(false);

  const [
    lovenseDisconnectMessage,
    setLovenseDisconnectMessage,
  ] =
    useState("");

  const lovenseSdkRef =
    useRef(null);
  
  const isStandalone =
    window.matchMedia?.(
      "(display-mode: standalone)"
    )?.matches ||
    window.navigator.standalone === true;

  useEffect(() => {

    let active =
      true;


    const checkSubscription =
      async () => {

        if (
          !(
            "Notification" in
            window
          ) ||
          Notification.permission !==
            "granted"
        ) {

          if (
            active
          ) {
            setSubscribed(
              false
            );

            setCheckingSubscription(
              false
            );
          }

          return;
        }


        try {

          const subscription =
            await getCurrentPushSubscription();


          if (
            !subscription
          ) {

            if (
              active
            ) {
              setSubscribed(
                false
              );
            }

            return;
          }


          /*
          * Une subscription existe déjà.
          *
          * On la réenregistre silencieusement
          * pour le compte Auth actuellement connecté.
          *
          * Ça permet aussi de migrer automatiquement
          * les anciennes installations ownerKey.
          */

          const result =
            await registerPushNotifications({
              supabaseClient:
                supabase,
            });


          if (
            active
          ) {
            setSubscribed(
              Boolean(
                result?.subscription
              )
            );
          }


        } catch (err) {

          console.error(
            "PUSH SUBSCRIPTION CHECK ERROR:",
            err
          );


          if (
            active
          ) {
            setSubscribed(
              false
            );
          }


        } finally {

          if (
            active
          ) {
            setCheckingSubscription(
              false
            );
          }

        }

      };


    checkSubscription();


    return () => {
      active =
        false;
    };

  }, []);

  const forgetLocalGame = () => {
    const confirmed = window.confirm(
      "Oublier cette partie sur cet appareil ?\n\n" +
      "La partie restera enregistrée dans PROTOCOL, " +
      "mais cet appareil ne pourra plus la reprendre automatiquement."
    );

    if (!confirmed) {
      return;
    }

    clearGameSession();

    localStorage.removeItem(
      PROTOCOL_LAST_SEEN_CARD_KEY
    );

    setHasLocalGameSession(false);

    setMessage(
      "La partie a été oubliée sur cet appareil."
    );
  };
  
  const logout = async () => {
    try {
      setMessage("");

      const { error } =
        await supabase.auth.signOut();

      if (error) {
        throw error;
      }

    } catch (err) {
      console.error(
        "LOGOUT ERROR:",
        err
      );

      setMessage(
        err?.message ||
        "Impossible de se déconnecter."
      );
    }
  };

  const deleteAccount = async () => {

    if (deleteAccountLoading) {
      return;
    }

    const confirmed =
      window.confirm(
        "Supprimer définitivement ton compte ?\n\n" +
        "Ton profil sera supprimé.\n\n" +
        "Si tu es lié à un partenaire, les données communes du couple, " +
        "les parties et leur historique seront également supprimés.\n\n" +
        "Le compte de ton partenaire restera actif.\n\n" +
        "Cette action est irréversible."
      );

    if (!confirmed) {
      return;
    }


    const confirmationText =
      window.prompt(
        'Pour confirmer la suppression, écris exactement : SUPPRIMER'
      );

    if (confirmationText !== "SUPPRIMER") {
      return;
    }


    try {

      setDeleteAccountLoading(true);
      setDeleteAccountMessage("");


      const {
        data,
        error,
      } =
        await supabase.functions.invoke(
          "delete-account",
          {
            method: "POST",
          }
        );


      if (error) {
        throw error;
      }


      if (!data?.ok) {
        throw new Error(
          data?.error ||
          "La suppression du compte a échoué."
        );
      }


      /*
      * Le compte a maintenant été supprimé
      * côté Supabase.
      *
      * On nettoie la session locale.
      */

      try {

        await supabase.auth.signOut({
          scope: "local",
        });

      } catch (signOutError) {

        console.warn(
          "LOCAL SIGNOUT AFTER DELETE:",
          signOutError
        );

      }


      /*
      * Partie éventuellement mémorisée
      * sur cet appareil.
      */

      clearGameSession();

      localStorage.removeItem(
        PROTOCOL_LAST_SEEN_CARD_KEY
      );


      /*
      * Nettoyage du stockage Supabase.
      *
      * On cible uniquement PROTOCOL et
      * la session Supabase de ce projet.
      */

      Object.keys(localStorage).forEach(
        (key) => {

          if (
            key.startsWith("protocol-") ||
            key.startsWith(
              "sb-vwgbixhqprdlxqcuijdz"
            )
          ) {

            localStorage.removeItem(
              key
            );

          }

        }
      );


      Object.keys(sessionStorage).forEach(
        (key) => {

          if (
            key.startsWith("protocol-") ||
            key.startsWith(
              "sb-vwgbixhqprdlxqcuijdz"
            )
          ) {

            sessionStorage.removeItem(
              key
            );

          }

        }
      );


      /*
      * Hard reload :
      * on détruit aussi tout l'état React
      * encore présent en mémoire.
      */

      window.location.replace("/");


    } catch (err) {

      console.error(
        "DELETE ACCOUNT ERROR:",
        err
      );

      setDeleteAccountMessage(
        err?.message ||
        "Impossible de supprimer le compte."
      );

      setDeleteAccountLoading(false);

    }

  };

    useEffect(() => {

      let active = true;

      const loadDirectorSettings =
        async () => {

          if (!coupleId) {
            if (active) {
              setDirectorLoading(false);
            }

            return;
          }

          try {

            setDirectorLoading(true);
            setDirectorMessage("");

            const {
              data,
              error,
            } =
              await supabase.rpc(
                "get_protocol_couple_settings"
              );

            if (error) {
              throw error;
            }

            if (!active) {
              return;
            }

            setDirectorMode(
              data?.director_mode ||
                "classic"
            );

            setDirectorProfile(
              data?.director_profile ?? null
            );

            setDirectorDuration(
              data?.director_duration ||
                "normal"
            );

          } catch (err) {

            console.error(
              "DIRECTOR SETTINGS LOAD ERROR:",
              err
            );

            if (active) {
              setDirectorMessage(
                "Impossible de charger le mode de soirée."
              );
            }

          } finally {

            if (active) {
              setDirectorLoading(false);
            }

          }
        };

      loadDirectorSettings();

      return () => {
        active = false;
      };

    }, [coupleId]);


    /* Style des cartes (Sur mesure) : Vanilla, Kinky ou Les deux.
       null tant que la migration n'est pas appliquée : la ligne
       reste alors masquée. */
    const [cardStyle, setCardStyle] =
      useState(null);

    useEffect(() => {
      let active = true;

      if (!coupleId) {
        return undefined;
      }

      supabase
        .rpc("get_protocol_card_style")
        .then(({ data, error }) => {
          if (active && !error && data) {
            setCardStyle(data);
          }
        });

      return () => {
        active = false;
      };
    }, [coupleId]);

    const saveCardStyle =
      async (value) => {
        const previous = cardStyle;

        setCardStyle(value);
        setDirectorMessage("");

        const { error } =
          await supabase.rpc(
            "set_protocol_card_style",
            { p_style: value }
          );

        if (error) {
          console.error(
            "CARD STYLE SAVE ERROR:",
            error
          );
          setCardStyle(previous);
          setDirectorMessage(
            "Impossible d’enregistrer ce réglage."
          );
          return;
        }

        setDirectorMessage(
          "Réglage enregistré."
        );
      };

    /* L'enveloppe (écrite à 60 % de la partie, ouverte à la fin).
       null tant que la migration n'est pas appliquée. */
    const [envelopeEnabled, setEnvelopeEnabled] =
      useState(null);

    useEffect(() => {
      let active = true;

      if (!coupleId) {
        return undefined;
      }

      supabase
        .rpc("get_protocol_envelope_enabled")
        .then(({ data, error }) => {
          if (active && !error && typeof data === "boolean") {
            setEnvelopeEnabled(data);
          }
        });

      return () => {
        active = false;
      };
    }, [coupleId]);

    const saveEnvelope =
      async (value) => {
        const previous = envelopeEnabled;

        setEnvelopeEnabled(value);
        setDirectorMessage("");

        const { error } =
          await supabase.rpc(
            "set_protocol_envelope_enabled",
            { p_enabled: value }
          );

        if (error) {
          console.error(
            "ENVELOPE SETTING ERROR:",
            error
          );
          setEnvelopeEnabled(previous);
          setDirectorMessage(
            "Impossible d’enregistrer ce réglage."
          );
          return;
        }

        setDirectorMessage(
          "Réglage enregistré."
        );
      };

    /* Missions secrètes (désactivées par défaut).
       null tant que la migration n'est pas appliquée. */
    const [missionsEnabled, setMissionsEnabled] =
      useState(null);

    useEffect(() => {
      let active = true;

      if (!coupleId) {
        return undefined;
      }

      supabase
        .rpc("get_protocol_missions_enabled")
        .then(({ data, error }) => {
          if (active && !error && typeof data === "boolean") {
            setMissionsEnabled(data);
          }
        });

      return () => {
        active = false;
      };
    }, [coupleId]);

    const saveMissions =
      async (value) => {
        const previous = missionsEnabled;

        setMissionsEnabled(value);
        setDirectorMessage("");

        const { error } =
          await supabase.rpc(
            "set_protocol_missions_enabled",
            { p_enabled: value }
          );

        if (error) {
          console.error(
            "MISSIONS SETTING ERROR:",
            error
          );
          setMissionsEnabled(previous);
          setDirectorMessage(
            "Impossible d’enregistrer ce réglage."
          );
          return;
        }

        setDirectorMessage(
          "Réglage enregistré."
        );
      };

    const saveDirectorSettings =
      async ({
        mode = directorMode,
        profile = directorProfile,
        duration = directorDuration,
      } = {}) => {

        try {

          setDirectorSaving(true);
          setDirectorMessage("");

          const normalizedProfile =
            mode === "classic"
              ? null
              : profile;

          const {
            data,
            error,
          } =
            await supabase.rpc(
              "set_protocol_couple_settings",
              {
                p_director_mode:
                  mode,

                p_director_profile:
                  normalizedProfile,

                p_director_duration:
                  duration,
              }
            );

          if (error) {
            throw error;
          }

          setDirectorMode(
            data?.director_mode ||
              mode
          );

          setDirectorProfile(
            data?.director_profile ??
              normalizedProfile
          );

          setDirectorDuration(
            data?.director_duration ||
              duration
          );

          setDirectorMessage(
            "Réglage enregistré."
          );

        } catch (err) {

          console.error(
            "DIRECTOR SETTINGS SAVE ERROR:",
            err
          );

          setDirectorMessage(
            err?.message ||
              "Impossible d’enregistrer ce réglage."
          );

        } finally {

          setDirectorSaving(false);

        }
      };

  const createCoupleInvite =
    async () => {
      try {
        setCoupleActionLoading(true);
        setCoupleMessage("");
        setCoupleInviteCode("");

        const {
          data,
          error,
        } =
          await supabase.rpc(
            "create_protocol_couple_invite"
          );

        if (error) {
          throw error;
        }

        if (!data?.code) {
          throw new Error(
            "Code d’association introuvable."
          );
        }

        setCoupleInviteCode(
          data.code
        );

        setCoupleMessage(
          "Transmets ce code à ton partenaire. Il reste valable 24 heures."
        );

      } catch (err) {
        console.error(
          "COUPLE INVITE ERROR:",
          err
        );

        setCoupleMessage(
          err?.message ||
          "Impossible de créer le code."
        );

      } finally {
        setCoupleActionLoading(false);
      }
    };


  const joinCouple =
    async () => {

      const cleanCode =
        coupleJoinCode
          .trim()
          .toUpperCase();

      if (!cleanCode) {
        return;
      }

      try {
        setCoupleActionLoading(true);
        setCoupleMessage("");

        const {
          data,
          error,
        } =
          await supabase.rpc(
            "join_protocol_couple",
            {
              p_code: cleanCode,
            }
          );

        if (error) {
          throw error;
        }

        if (!data?.success) {
          throw new Error(
            "Association impossible."
          );
        }

        setCoupleJoinCode("");

        setCoupleMessage(
          "Partenaire associé."
        );

        onCoupleChanged?.();

      } catch (err) {
        console.error(
          "COUPLE JOIN ERROR:",
          err
        );

        setCoupleMessage(
          err?.message ||
          "Code incorrect ou expiré."
        );

      } finally {
        setCoupleActionLoading(false);
      }
    };

  const activatePushNotifications =
    async () => {

      if (
        !(
          "Notification" in
          window
        )
      ) {
        setPermission(
          "unsupported"
        );

        return;
      }


      try {

        setRequesting(
          true
        );

        setMessage(
          ""
        );


        const result =
          await registerPushNotifications({
            supabaseClient:
              supabase,
          });


        setPermission(
          Notification.permission
        );


        setSubscribed(
          Boolean(
            result?.subscription
          )
        );


        setMessage(
          "Cet appareil est enregistré pour ton compte PROTOCOL."
        );


      } catch (err) {

        console.error(
          "PUSH ACTIVATION ERROR:",
          err
        );


        if (
          "Notification" in
          window
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

        setRequesting(
          false
        );

      }

    };

    const syncLovenseSdkState =
      async (
        instance =
          lovenseSdkRef.current
      ) => {

        if (!instance) {
          return false;
        }

        try {

          /*
          * Le SDK Lovense peut retourner
          * ces valeurs directement ou via
          * une Promise selon sa version.
          * await fonctionne dans les deux cas.
          */

          const appStatus =
            await instance
              .getAppStatus();

          const onlineToysRaw =
            await instance
              .getOnlineToys();

          const deviceInfoRaw =
            await instance
              .getDeviceInfo();


          const onlineToys =
            Array.isArray(
              onlineToysRaw
            )
              ? onlineToysRaw
              : onlineToysRaw &&
                  typeof onlineToysRaw ===
                    "object"
                ? Object.values(
                    onlineToysRaw
                  )
                : [];


          const deviceInfo =
            deviceInfoRaw &&
            typeof deviceInfoRaw ===
              "object"
              ? deviceInfoRaw
              : {};


          console.log(
            "LOVENSE SDK STATE:",
            {
              appStatus,
              toyCount:
                onlineToys.length,

              deviceInfo,
            }
          );


          const {
            data,
            error,
          } =
            await supabase.functions.invoke(
              "lovense-sync",
              {
                body: {
                  connected:
                    Boolean(
                      appStatus
                    ),

                  toys:
                    onlineToys,

                  deviceInfo,
                },
              }
            );


          if (error) {
            throw error;
          }


          if (!data?.success) {
            throw new Error(
              data?.error ||
              "Impossible de synchroniser Lovense."
            );
          }


          const connected =
            Boolean(
              data.connected
            );


          setLovenseConnected(
            connected
          );


          setLovenseToyName(
            onlineToys?.[0]?.name ||
            onlineToys?.[0]?.nickname ||
            ""
          );


          return connected;

        } catch (err) {

          console.error(
            "LOVENSE SDK SYNC ERROR:",
            err
          );

          return false;
        }
      };
    
    const openLovenseRemote =
      async () => {

        try {

          setLovenseOpening(
            true
          );

          setLovenseSdkError(
            ""
          );

          setLovenseMessage(
            ""
          );


          if (
            !window.LovenseBasicSdk
          ) {
            throw new Error(
              "Le SDK Lovense n’est pas chargé."
            );
          }


          /*
          * AuthToken Basic SDK.
          *
          * Aucun owner_key,
          * aucun prénom,
          * aucune identité choisie
          * par le navigateur.
          */

          const {
            data,
            error,
          } =
            await supabase
              .functions
              .invoke(
                "lovense-auth",
                {
                  body: {},
                }
              );


          if (error) {
            throw error;
          }


          if (
            !data?.success ||
            !data?.authToken ||
            !data?.uid
          ) {
            throw new Error(
              data?.error ||
              "Impossible d’initialiser Lovense."
            );
          }


          const sdk =
            new window
              .LovenseBasicSdk({
                platform:
                  "PROTOCOL",

                authToken:
                  data.authToken,

                uid:
                  data.uid,

                /*
                * Lovense Remote,
                * pas Lovense Connect.
                */
                debug:
                  true,
              });


          /*
          * On conserve l'instance.
          *
          * Elle pourra être interrogée
          * quand l'utilisateur revient
          * de Lovense Remote.
          */

          lovenseSdkRef.current =
            sdk;


          /* =========================================
            SDK ERROR
            ========================================= */

          sdk.on(
            "sdkError",
            (
              sdkError
            ) => {

              console.error(
                "LOVENSE SDK ERROR FULL:",
                {
                  code:
                    sdkError?.code,

                  message:
                    sdkError?.message,

                  raw:
                    sdkError,
                }
              );


              setLovenseSdkError(
                sdkError?.code
                  ? `${sdkError.code} — ${sdkError.message}`
                  : sdkError?.message ||
                    "Lovense Remote n’a pas pu être ouvert."
              );
            }
          );


          /* =========================================
            APP STATUS CHANGE
            ========================================= */

          sdk.on(
            "appStatusChange",
            async (
              status
            ) => {

              console.log(
                "LOVENSE APP STATUS:",
                status
              );

              await syncLovenseSdkState(
                sdk
              );
            }
          );


          /* =========================================
            TOYS CHANGE
            ========================================= */

          sdk.on(
            "toyInfoChange",
            async (
              toys
            ) => {

              console.log(
                "LOVENSE TOY INFO:",
                toys
              );

              await syncLovenseSdkState(
                sdk
              );
            }
          );


          sdk.on(
            "toyOnlineChange",
            async (
              status
            ) => {

              console.log(
                "LOVENSE TOY ONLINE:",
                status
              );

              await syncLovenseSdkState(
                sdk
              );
            }
          );


          /* =========================================
            DEVICE INFO CHANGE
            ========================================= */

          sdk.on(
            "deviceInfoChange",
            async (
              deviceInfo
            ) => {

              console.log(
                "LOVENSE DEVICE INFO:",
                deviceInfo
              );

              await syncLovenseSdkState(
                sdk
              );
            }
          );


          /* =========================================
            READY
            ========================================= */

          sdk.on(
            "ready",
            async (
              instance
            ) => {

              try {

                lovenseSdkRef.current =
                  instance;


                /*
                * Première vérification.
                *
                * Si Lovense est déjà connecté,
                * inutile d'ouvrir l'app.
                */

                const alreadyConnected =
                  await syncLovenseSdkState(
                    instance
                  );


                if (
                  alreadyConnected
                ) {

                  setLovenseMessage(
                    "Lovense Remote est connecté."
                  );

                  await checkLovenseStatus();

                  return;
                }


                /*
                * Sinon on ouvre Lovense Remote.
                *
                * La documentation Lovense prévoit
                * précisément connectLovenseAPP()
                * pour le flux mobile sans scan QR.
                */

                instance
                  .connectLovenseAPP();


                setLovenseMessage(
                  "Autorise PROTOCOL dans Lovense Remote, puis reviens dans PROTOCOL."
                );

              } catch (
                err
              ) {

                console.error(
                  "LOVENSE OPEN APP ERROR:",
                  err
                );


                setLovenseSdkError(
                  err?.message ||
                  "Impossible d’ouvrir Lovense Remote."
                );

              } finally {

                setLovenseOpening(
                  false
                );

              }
            }
          );


        } catch (
          err
        ) {

          console.error(
            "LOVENSE CONNECTION ERROR:",
            err
          );


          setLovenseSdkError(
            err?.message ||
            "Impossible de connecter Lovense."
          );


          setLovenseOpening(
            false
          );
        }
      };

  const connectLovense =
    async () => {
      try {
        setLovenseLoading(true);
        setLovenseMessage("");
        setLovenseQr("");
        setLovenseCode("");

        const {
          data,
          error,
        } =
          await supabase.functions.invoke(
            "lovense-connect",
            {
              body: {},
            }
          );

        if (error) {
          throw error;
        }

        if (!data?.success) {
          throw new Error(
            data?.error ||
            "Impossible de générer le QR Lovense."
          );
        }

        setLovenseQr(
          data.qr || ""
        );

        setLovenseCode(
          data.code || ""
        );

        setLovenseMessage(
          "Scanne ce QR avec Lovense Remote sur le téléphone connecté au jouet."
        );

      } catch (err) {
        console.error(
          "LOVENSE CONNECT ERROR:",
          err
        );

        setLovenseMessage(
          err?.message ||
          "Impossible de connecter Lovense."
        );

      } finally {
        setLovenseLoading(false);
      }
    };

  const checkLovenseStatus =
    async () => {
      try {
        setLovenseStatusLoading(true);

        const {
          data,
          error,
        } =
          await supabase.functions.invoke(
            "lovense-status",
            {
              body: {},
            }
          );

        if (error) {
          throw error;
        }

        if (!data?.success) {
          throw new Error(
            data?.error ||
            "Impossible de vérifier Lovense."
          );
        }

        setLovenseConnected(
          Boolean(
            data.connected
          )
        );

        setLovenseToyName(
          data?.toys?.[0]?.name ||
          ""
        );

      } catch (err) {
        console.error(
          "LOVENSE STATUS ERROR:",
          err
        );

        setLovenseConnected(false);
        setLovenseToyName("");

      } finally {
        setLovenseStatusLoading(false);
      }
    };

  useEffect(() => {
    checkLovenseStatus();
  }, []);

  useEffect(() => {

    const handleLovenseReturn =
      async () => {

        if (
          document.visibilityState !==
          "visible"
        ) {
          return;
        }


        /*
        * On laisse quelques centaines
        * de ms au SDK pour restaurer
        * sa connexion après le retour
        * depuis Lovense Remote.
        */

        await new Promise(
          (
            resolve
          ) =>
            window.setTimeout(
              resolve,
              450
            )
        );


        if (
          lovenseSdkRef.current
        ) {

          await syncLovenseSdkState(
            lovenseSdkRef.current
          );
        }


        await checkLovenseStatus();
      };


    document.addEventListener(
      "visibilitychange",
      handleLovenseReturn
    );


    window.addEventListener(
      "pageshow",
      handleLovenseReturn
    );


    return () => {

      document.removeEventListener(
        "visibilitychange",
        handleLovenseReturn
      );


      window.removeEventListener(
        "pageshow",
        handleLovenseReturn
      );

    };

  }, []);

  const testLovense =
    async () => {
      try {
        setLovenseTestLoading(true);
        setLovenseTestMessage("");

        const {
          data,
          error,
        } =
          await supabase.functions.invoke(
            "lovense-command",
            {
              body: {
                action:
                  "test",
              },
            }
          );

        if (error) {
          throw error;
        }

        if (!data?.success) {
          throw new Error(
            data?.error ||
            "La commande Lovense a échoué."
          );
        }

        setLovenseTestMessage(
          "Test envoyé au Lush."
        );

      } catch (err) {
        console.error(
          "LOVENSE TEST ERROR:",
          err
        );

        setLovenseTestMessage(
          err?.message ||
          "Impossible de tester le Lush."
        );

      } finally {
        setLovenseTestLoading(false);
      }
    };
      
  const disconnectLovense =
    async () => {

      const confirmed =
        window.confirm(
          "Déconnecter le jouet Lovense de PROTOCOL ?"
        );

      if (
        !confirmed
      ) {
        return;
      }


      try {

        setLovenseDisconnectLoading(
          true
        );

        setLovenseDisconnectMessage(
          ""
        );

        setLovenseTestMessage(
          ""
        );

        setLovenseMessage(
          ""
        );

        setLovenseSdkError(
          ""
        );


        const {
          data,
          error,
        } =
          await supabase
            .functions
            .invoke(
              "lovense-disconnect",
              {
                body: {},
              }
            );


        if (
          error
        ) {
          throw error;
        }


        if (
          !data?.success
        ) {
          throw new Error(
            data?.error ||
            "Impossible de déconnecter Lovense."
          );
        }


        /*
        * Reset immédiat de l'UI.
        *
        * Le backend est déjà la source
        * de vérité, mais on évite ici
        * d'attendre un nouvel appel status
        * pour mettre l'écran à jour.
        */

        setLovenseConnected(
          false
        );

        setLovenseToyName(
          ""
        );

        setLovenseQr(
          ""
        );

        setLovenseCode(
          ""
        );


        /*
        * On oublie aussi l'instance SDK
        * actuelle dans cette session.
        *
        * Important :
        * on ne tente pas de déconnecter
        * Lovense Remote elle-même.
        * On supprime seulement l'association
        * active côté PROTOCOL.
        */

        lovenseSdkRef.current =
          null;


        setLovenseDisconnectMessage(
          "Le jouet a été déconnecté de PROTOCOL."
        );


      } catch (
        err
      ) {

        console.error(
          "LOVENSE DISCONNECT ERROR:",
          err
        );


        setLovenseDisconnectMessage(
          err?.message ||
          "Impossible de déconnecter le jouet."
        );


      } finally {

        setLovenseDisconnectLoading(
          false
        );

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

  const directorProfiles = [
                          {
                            value: "classic",
                            label: "Classique",
                            description:
                              "Équilibré, varié et progressif.",
                          },
                          {
                            value: "complice",
                            label: "Complice",
                            description:
                              "Plus de vérités, d'échanges et de proximité.",
                          },
                          {
                            value: "sensual",
                            label: "Sensuel",
                            description:
                              "Gestes, sensations et scènes plus présentes.",
                          },
                          {
                            value: "provocative",
                            label: "Provocateur",
                            description:
                              "Davantage de défis, de duels et d'imprévus.",
                          },
                          {
                            value: "unrestrained",
                            label: "Débridé",
                            description:
                              "Une progression plus intense dans les limites de votre calibration.",
                          },
                        ];

  const notificationValue =
    status.label.charAt(0) +
    status.label.slice(1).toLowerCase();

  const notificationTone =
    permission === "granted" && subscribed
      ? "on"
      : permission === "denied"
        ? "off"
        : permission === "granted"
          ? "wait"
          : undefined;

  return (
    <main className="app protocol-settings-page">

      <header className="header protocol-settings-header">
        <button
          className="back protocol-settings-back"
          onClick={() => navigate("/")}
          aria-label="Retour"
        >
          <BackIcon />
        </button>

        <div className="protocol-settings-heading">
          <span className="logo protocol-settings-logo">
            PROTOCOL
          </span>

          <span className="protocol-settings-subtitle">
            {couple?.partner?.display_name
              ? `Avec ${couple.partner.display_name}`
              : "Ton espace"}
          </span>
        </div>
      </header>


      <section className="protocol-settings">

        <section className="protocol-settings-intro">
          <p className="kicker">
            RÉGLAGES
          </p>

          <h1>
            Votre espace.
          </h1>

          <p className="intro">
            {couple?.partner ? (
              <>
                Avec{" "}
                <strong>
                  {couple.partner.display_name ||
                    "ton partenaire"}
                </strong>
                {" "}· associés.
              </>
            ) : (
              "Ce qui se règle à deux, et ce qui reste sur ce téléphone."
            )}
          </p>
        </section>

        {!couple?.partner && (
          <SettingsGroup title="Le duo">
            <SettingsRow
              label="Associer ton partenaire"
              hint="Invitations, messages et parties, à deux."
              onClick={() => setSheet("pairing")}
            />
          </SettingsGroup>
        )}

        {couple?.partner && (
          <SettingsGroup title="Le jeu">
            <SettingsRow
              label="Mode de soirée"
              hint={
                directorLoading
                  ? "Chargement…"
                  : directorMode === "custom"
                    ? [
                        cardStyle && CARD_STYLE_LABELS[cardStyle],
                        DURATION_LABELS[directorDuration],
                      ]
                        .filter(Boolean)
                        .join(" · ")
                    : "Le rythme PROTOCOL original."
              }
              value={
                directorLoading
                  ? null
                  : directorMode === "custom"
                    ? `Sur mesure · ${
                        directorProfiles.find(
                          (option) => option.value === directorProfile
                        )?.label || "Classique"
                      }`
                    : "Spontané"
              }
              onClick={() => setSheet("mode")}
              disabled={directorLoading}
            />

            <SettingsRow
              label="Mes cartes"
              hint="Vos actions, vérités et duels, privés à votre duo."
              onClick={() =>
                navigate("/settings/custom-library")
              }
            />

            <SettingsRow
              label="Comment on joue"
              onClick={() => setShowHowTo(true)}
            />
          </SettingsGroup>
        )}

        <SettingsGroup title="Ce téléphone">
          <SettingsRow
            label="Notifications"
            value={
              checkingSubscription
                ? "Vérification…"
                : notificationValue
            }
            tone={notificationTone}
            onClick={() => setSheet("notifications")}
          />

          <SettingsRow
            label="Lovense"
            value={
              lovenseStatusLoading
                ? "Vérification…"
                : lovenseConnected
                  ? lovenseToyName || "Connecté"
                  : "Non connecté"
            }
            tone={lovenseConnected ? "on" : undefined}
            onClick={() => setSheet("lovense")}
          />
        </SettingsGroup>

        <SettingsGroup title="Compte">
          <SettingsRow
            label="Confidentialité"
            onClick={() => navigate("/privacy")}
          />

          <SettingsRow
            label="Partie mémorisée"
            hint="Pour reprendre une partie sur ce téléphone."
            value={hasLocalGameSession ? null : "Aucune"}
          >
            {hasLocalGameSession && (
              <button
                type="button"
                className="settings-inline-action"
                onClick={forgetLocalGame}
              >
                Oublier cette partie
              </button>
            )}
          </SettingsRow>

          <SettingsRow
            label="Se déconnecter"
            onClick={logout}
          />
        </SettingsGroup>

        <div className="settings-danger-zone">
          {deleteAccountMessage && (
            <p className="settings-feedback">
              {deleteAccountMessage}
            </p>
          )}

          <SettingsRow
            label={
              deleteAccountLoading
                ? "Suppression…"
                : "Supprimer mon compte"
            }
            hint="Définitif : ton compte et les données qui lui sont associées."
            onClick={deleteAccount}
            disabled={deleteAccountLoading}
            danger
          />
        </div>

        {showHowTo && (
          <HowToPlay
            onClose={() =>
              setShowHowTo(false)
            }
          />
        )}

        {sheet === "pairing" && (
          <SettingsSheet
            eyebrow="LE DUO"
            title="Votre duo."
            onClose={() => setSheet(null)}
          >

            <>

              <p className="settings-card-copy">
                Associe vos comptes une seule fois pour
                partager invitations, messages et expériences,
                même en dehors d’une partie.
              </p>


              <button
                type="button"
                className="settings-primary-action"
                onClick={createCoupleInvite}
                disabled={coupleActionLoading}
              >
                <span>
                  {coupleActionLoading
                    ? "Préparation…"
                    : "Créer un code partenaire"}
                </span>

                <span className="settings-action-arrow">
                  →
                </span>
              </button>


              {coupleInviteCode && (

                <div className="settings-code-box">

                  <span className="settings-card-eyebrow">
                    CODE PARTENAIRE
                  </span>

                  <strong>
                    {coupleInviteCode}
                  </strong>

                  <small>
                    Code partenaire · valable pendant 24 heures
                  </small>

                </div>

              )}


              <div className="settings-subsection">

                <span className="settings-card-eyebrow">
                  J’AI DÉJÀ UN CODE
                </span>

                <input
                  className="settings-code-input"
                  type="text"
                  value={coupleJoinCode}
                  onChange={(event) =>
                    setCoupleJoinCode(
                      event.target.value
                        .replace(
                          /[^a-fA-F0-9]/g,
                          ""
                        )
                        .toUpperCase()
                        .slice(0, 10)
                    )
                  }
                  maxLength={10}
                  autoComplete="off"
                  placeholder="CODE PARTENAIRE"
                />

                <button
                  type="button"
                  className="settings-secondary-action"
                  onClick={joinCouple}
                  disabled={
                    coupleActionLoading ||
                    coupleJoinCode.length !== 10
                  }
                >
                  Associer ce compte
                </button>

              </div>

            </>

            {coupleMessage && (
              <p className="settings-feedback">
                {coupleMessage}
              </p>
            )}
          </SettingsSheet>
        )}

        {sheet === "mode" && (
          <SettingsSheet
            eyebrow="LE JEU"
            title="Mode de soirée."
            onClose={() => setSheet(null)}
          >
            <div className="mode-sheet">
              <div
                className="settings-segmented"
                role="group"
                aria-label="Mode de soirée"
              >
                {[
                  ["classic", "Spontané"],
                  ["custom", "Sur mesure"],
                ].map(([value, label]) => (
                  <button
                    key={value}
                    type="button"
                    aria-pressed={directorMode === value}
                    className={directorMode === value ? "is-active" : undefined}
                    onClick={() => {
                      if (value === "classic") {
                        setDirectorMode("classic");
                        setDirectorProfile(null);
                        saveDirectorSettings({ mode: "classic", profile: null });
                        return;
                      }

                      const nextProfile = directorProfile || "classic";

                      setDirectorMode("custom");
                      setDirectorProfile(nextProfile);
                      saveDirectorSettings({ mode: "custom", profile: nextProfile });
                    }}
                    disabled={directorSaving}
                  >
                    {label}
                  </button>
                ))}
              </div>

              <p className="mode-sheet-hint">
                {directorMode === "custom"
                  ? "Une ambiance plus affirmée, réglée par vous."
                  : "Le rythme PROTOCOL original : le jeu choisit tout."}
              </p>

              {directorMode === "custom" && (
                <>
                  {cardStyle && (
                    <section className="mode-sheet-section">
                      <h3>Cartes</h3>

                      <div
                        className="settings-segmented"
                        role="group"
                        aria-label="Style des cartes"
                      >
                        {Object.entries(CARD_STYLE_LABELS).map(([value, label]) => (
                          <button
                            key={value}
                            type="button"
                            aria-pressed={cardStyle === value}
                            className={cardStyle === value ? "is-active" : undefined}
                            onClick={() => saveCardStyle(value)}
                          >
                            {label}
                          </button>
                        ))}
                      </div>

                      <p className="mode-sheet-hint">
                        {cardStyle === "vanilla"
                          ? "Pratiques classiques, sans le côté kinky."
                          : cardStyle === "kinky"
                            ? "Le kinky prend le dessus dès que ça monte."
                            : "Toute la bibliothèque."}
                      </p>
                    </section>
                  )}

                  <section className="mode-sheet-section">
                    <h3>Ambiance</h3>

                    <div className="director-profile-grid">
                      {directorProfiles.map((option) => (
                        <button
                          key={option.value}
                          type="button"
                          className={
                            directorProfile === option.value
                              ? "director-profile-option is-active"
                              : "director-profile-option"
                          }
                          onClick={() => {
                            setDirectorProfile(option.value);
                            saveDirectorSettings({
                              mode: "custom",
                              profile: option.value,
                            });
                          }}
                          disabled={directorSaving}
                        >
                          <strong>{option.label}</strong>
                          <span>{option.description}</span>
                        </button>
                      ))}
                    </div>
                  </section>

                  <section className="mode-sheet-section">
                    <h3>Durée</h3>

                    <div
                      className="settings-segmented"
                      role="group"
                      aria-label="Durée"
                    >
                      {Object.entries(DURATION_LABELS).map(([value, label]) => (
                        <button
                          key={value}
                          type="button"
                          aria-pressed={directorDuration === value}
                          className={directorDuration === value ? "is-active" : undefined}
                          onClick={() => {
                            setDirectorDuration(value);
                            saveDirectorSettings({ duration: value });
                          }}
                          disabled={directorSaving}
                        >
                          {label}
                        </button>
                      ))}
                    </div>
                  </section>
                </>
              )}

              {envelopeEnabled !== null && (
                <section className="mode-sheet-section">
                  <h3>L’enveloppe</h3>

                  <div
                    className="settings-segmented"
                    role="group"
                    aria-label="L’enveloppe"
                  >
                    {[
                      [true, "Oui"],
                      [false, "Non"],
                    ].map(([value, label]) => (
                      <button
                        key={label}
                        type="button"
                        aria-pressed={envelopeEnabled === value}
                        className={envelopeEnabled === value ? "is-active" : undefined}
                        onClick={() => saveEnvelope(value)}
                      >
                        {label}
                      </button>
                    ))}
                  </div>

                  <p className="mode-sheet-hint">
                    Vers la fin de la partie, chacun écrit en secret ce
                    qu’il veut pour la fin de soirée. Les enveloppes
                    s’ouvrent à la dernière carte.
                  </p>
                </section>
              )}

              {missionsEnabled !== null && (
                <section className="mode-sheet-section">
                  <h3>Missions secrètes</h3>

                  <div
                    className="settings-segmented"
                    role="group"
                    aria-label="Missions secrètes"
                  >
                    {[
                      [true, "Oui"],
                      [false, "Non"],
                    ].map(([value, label]) => (
                      <button
                        key={label}
                        type="button"
                        aria-pressed={missionsEnabled === value}
                        className={missionsEnabled === value ? "is-active" : undefined}
                        onClick={() => saveMissions(value)}
                      >
                        {label}
                      </button>
                    ))}
                  </div>

                  <p className="mode-sheet-hint">
                    Au lancement, chacun reçoit en secret une mission
                    discrète à réussir pendant la soirée. On les révèle
                    à la fin.
                  </p>
                </section>
              )}

              {directorMessage && (
                <p className="mode-sheet-hint mode-sheet-feedback">
                  {directorMessage}
                </p>
              )}
            </div>
          </SettingsSheet>
        )}

        {sheet === "notifications" && (
          <SettingsSheet
            eyebrow="NOTIFICATIONS"
            title={
              checkingSubscription
                ? "On vérifie cet appareil."
                : status.title
            }
            onClose={() => setSheet(null)}
          >
          <p className="settings-card-copy">
            {checkingSubscription
              ? "PROTOCOL vérifie si cet iPhone possède déjà un abonnement Push."
              : status.text}
          </p>


          {!isStandalone &&
            permission !== "granted" && (

              <p className="settings-feedback">
                Sur iPhone, ouvre PROTOCOL depuis
                l’icône ajoutée à l’écran d’accueil.
              </p>

            )}

          {permission === "default" &&
            isStandalone &&
            !checkingSubscription && (

              <button
                type="button"
                className="settings-primary-action"
                onClick={activatePushNotifications}
                disabled={requesting}
              >
                <span>
                  {requesting
                    ? "Activation…"
                    : "Activer les notifications"}
                </span>

                <span className="settings-action-arrow">
                  →
                </span>
              </button>

            )}

          {permission === "granted" &&
            !subscribed &&
            !checkingSubscription && (

              <button
                type="button"
                className="settings-primary-action"
                onClick={activatePushNotifications}
                disabled={requesting}
              >
                <span>
                  {requesting
                    ? "Enregistrement…"
                    : "Finaliser l’enregistrement"}
                </span>

                <span className="settings-action-arrow">
                  →
                </span>
              </button>

            )}


          {permission === "granted" &&
            subscribed && (

              <div className="settings-confirmation">

                <span className="settings-confirmation-icon">
                  ✓
                </span>

                <div>

                  <strong>
                    Notifications activées
                  </strong>

                  <span>
                    Cet appareil est associé à ton compte.
                  </span>

                </div>

              </div>

            )}


          {message && (
            <p className="settings-feedback">
              {message}
            </p>
          )}
          </SettingsSheet>
        )}

        {sheet === "lovense" && (
          <SettingsSheet
            eyebrow="LOVENSE"
            title={
              lovenseConnected
                ? "Lush 4 prêt."
                : "Connecter le Lush 4."
            }
            onClose={() => setSheet(null)}
          >
          {/* =======================================
              STATUS
              ======================================= */}

          <div className="settings-status-row settings-lovense-status">

            <span
              className={
                lovenseConnected
                  ? "settings-status-dot is-active"
                  : "settings-status-dot"
              }
            />

            <span>
              {lovenseStatusLoading
                ? "VÉRIFICATION"
                : lovenseConnected
                  ? "CONNECTÉ"
                  : "NON CONNECTÉ"}
            </span>

          </div>


          {/* =======================================
              CONNECTÉ
              ======================================= */}

          {!lovenseStatusLoading &&
            lovenseConnected && (

              <>

                <p className="settings-connected-device">
                  {lovenseToyName
                    ? `${lovenseToyName} disponible`
                    : "Jouet Lovense disponible"}
                </p>


                <p className="settings-card-copy">
                  Lovense Remote doit rester active
                  en arrière-plan pour permettre
                  à PROTOCOL de contrôler le jouet.
                </p>


                <button
                  type="button"
                  className="settings-primary-action"
                  onClick={testLovense}
                  disabled={
                    lovenseTestLoading
                  }
                >

                  <span>
                    {lovenseTestLoading
                      ? "Envoi…"
                      : "Tester le Lush"}
                  </span>

                  {!lovenseTestLoading && (
                    <span className="settings-action-arrow">
                      →
                    </span>
                  )}

                </button>


                {lovenseTestMessage && (
                  <p className="settings-feedback">
                    {lovenseTestMessage}
                  </p>
                )}


                <button
                  type="button"
                  className="settings-text-action"
                  onClick={disconnectLovense}
                  disabled={
                    lovenseDisconnectLoading
                  }
                >
                  {lovenseDisconnectLoading
                    ? "Déconnexion…"
                    : "Déconnecter le jouet"}
                </button>


                {lovenseDisconnectMessage && (
                  <p className="settings-feedback">
                    {lovenseDisconnectMessage}
                  </p>
                )}

              </>

            )}


          {/* =======================================
              NON CONNECTÉ
              ======================================= */}

          {!lovenseStatusLoading &&
            !lovenseConnected && (

              <>

                <p className="settings-card-copy">
                  Connecte Lovense Remote à PROTOCOL
                  pour permettre au jeu de contrôler
                  le jouet.
                </p>


                {!lovenseQr && (

                  <>

                    <button
                      type="button"
                      className="settings-primary-action settings-lovense-open"
                      onClick={openLovenseRemote}
                      disabled={
                        lovenseOpening
                      }
                    >

                      <span>
                        {lovenseOpening
                          ? "Ouverture…"
                          : "Ouvrir Lovense Remote"}
                      </span>

                      <span className="settings-action-arrow">
                        →
                      </span>

                    </button>


                    {lovenseSdkError && (
                      <p className="settings-feedback">
                        {lovenseSdkError}
                      </p>
                    )}


                    <button
                      type="button"
                      className="settings-text-action"
                      onClick={connectLovense}
                      disabled={
                        lovenseLoading ||
                        lovenseOpening
                      }
                    >
                      {lovenseLoading
                        ? "Préparation du QR…"
                        : "Utiliser le QR"}
                    </button>

                  </>

                )}


                {lovenseQr && (

                  <div className="settings-lovense-qr">

                    <div className="settings-status-row">

                      <span className="settings-status-dot is-pending" />

                      <span>
                        EN ATTENTE D’ASSOCIATION
                      </span>

                    </div>


                    <div className="settings-qr-frame">

                      <img
                        src={lovenseQr}
                        alt="QR de connexion Lovense"
                      />

                    </div>


                    <strong className="settings-qr-copy">
                      Scanne avec Lovense Remote
                      <br />
                      sur le téléphone connecté au jouet
                    </strong>


                    {lovenseCode && (
                      <small className="settings-qr-code">
                        Code : {lovenseCode}
                      </small>
                    )}


                    <button
                      type="button"
                      className="settings-secondary-action"
                      onClick={() => {
                        setLovenseQr("");
                        setLovenseCode("");
                        setLovenseMessage("");
                      }}
                    >
                      Annuler
                    </button>

                  </div>

                )}


                {lovenseMessage &&
                  !lovenseQr && (

                    <p className="settings-feedback">
                      {lovenseMessage}
                    </p>

                  )}


                {lovenseDisconnectMessage && (
                  <p className="settings-feedback">
                    {lovenseDisconnectMessage}
                  </p>
                )}

              </>

            )}
          </SettingsSheet>
        )}
      </section>

      <Footer />

    </main>
  );
}
