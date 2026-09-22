import {
  useEffect,
  useRef,
  useState,
} from "react";
import { createClient } from "@supabase/supabase-js";
import "./notifications.css";
import "./home-dashboard.css";
import LibraryScreen from "./LibraryScreen.jsx";
import CardScreen from "./CardScreen.jsx";
import InvitationsScreen from "./InvitationsScreen.jsx";
import MessagesScreen from "./MessagesScreen.jsx";
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
        persistSession: true,
        autoRefreshToken: true,
        detectSessionInUrl: true,
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

/* =========================================================
   GAME SESSION SECURITY
   ========================================================= */

const PROTOCOL_SESSION_KEY =
  "protocol-active-game";

function saveGameSession(
  code,
  playerNumber,
  playerToken
) {
  const normalizedCode =
    String(code || "")
      .trim()
      .toUpperCase();

  const session = {
    code: normalizedCode,
    playerNumber: Number(playerNumber),
    playerToken,
    savedAt: new Date().toISOString(),
  };

  localStorage.setItem(
    PROTOCOL_SESSION_KEY,
    JSON.stringify(session)
  );
}

function getGameSession(code = null) {
  try {
    const raw =
      localStorage.getItem(
        PROTOCOL_SESSION_KEY
      );

    if (!raw) {
      return {
        code: null,
        playerNumber: null,
        playerToken: null,
        valid: false,
      };
    }

    const session =
      JSON.parse(raw);

    const sessionCode =
      String(session?.code || "")
        .trim()
        .toUpperCase();

    const requestedCode =
      code
        ? String(code)
            .trim()
            .toUpperCase()
        : null;

    const playerNumber =
      Number(session?.playerNumber);

    const playerToken =
      session?.playerToken || null;

    const valid =
      Boolean(sessionCode) &&
      [1, 2].includes(playerNumber) &&
      Boolean(playerToken) &&
      (
        !requestedCode ||
        requestedCode === sessionCode
      );

    return {
      ...session,
      code: sessionCode,
      playerNumber,
      playerToken,
      valid,
    };

  } catch (error) {
    console.error(
      "GAME SESSION READ ERROR:",
      error
    );

    return {
      code: null,
      playerNumber: null,
      playerToken: null,
      valid: false,
    };
  }
}

function clearGameSession() {
  localStorage.removeItem(
    PROTOCOL_SESSION_KEY
  );
}

const PROTOCOL_LAST_SEEN_CARD_KEY =
  "protocol-last-seen-card";

function getLastSeenCard(code) {
  try {
    const raw =
      localStorage.getItem(
        PROTOCOL_LAST_SEEN_CARD_KEY
      );

    if (!raw) {
      return null;
    }

    const seen =
      JSON.parse(raw);

    const normalizedCode =
      String(code || "")
        .trim()
        .toUpperCase();

    if (
      seen?.code !== normalizedCode
    ) {
      return null;
    }

    return seen?.cardId ?? null;

  } catch (error) {
    console.error(
      "LAST SEEN CARD READ ERROR:",
      error
    );

    return null;
  }
}

function saveLastSeenCard(
  code,
  cardId
) {
  if (!code || !cardId) {
    return;
  }

  localStorage.setItem(
    PROTOCOL_LAST_SEEN_CARD_KEY,
    JSON.stringify({
      code: String(code)
        .trim()
        .toUpperCase(),
      cardId: Number(cardId),
    })
  );
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

  if (path === "/library") {

    const params =
      new URLSearchParams(
        window.location.search
      );

    const challengeId =
      params.get("challenge");

    return {
      screen: "library",
      code: null,
      challengeId,
    };
  }

  if (path === "/messages") {
    return {
      screen:
        "messages",
      code:
        null,
    };
  }

  if (path === "/invitations") {
    return {
      screen: "invitations",
      code: null,
    };
  }

  if (path === "/join") {
    return {
      screen: "join",
      code: null,
    };
  }

  const cardMatch =
    path.match(
      /^\/card\/(\d+)\/?$/
    );

  if (cardMatch) {
    const params =
      new URLSearchParams(
        window.location.search
      );

    const requestedActiveKey =
      params.get("for");

    const activeKey =
      requestedActiveKey === "jerome" ||
      requestedActiveKey === "audrey"
        ? requestedActiveKey
        : null;

    const invitationId =
      params.get("invite");

    const from =
      params.get("from");

    const challengeId =
      params.get("challenge");

    return {
      screen: "card",

      cardId: Number(
        cardMatch[1]
      ),

      activeKey,

      invitationId,

      from,

      challengeId,
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

function AuthScreen({ onAuthenticated }) {
  const [email, setEmail] =
    useState("");

  const [code, setCode] =
    useState("");

  const [step, setStep] =
    useState("email");

  const [loading, setLoading] =
    useState(false);

  const [message, setMessage] =
    useState("");

  const sendCode =
    async (event) => {
      event.preventDefault();

      try {
        setLoading(true);
        setMessage("");

        const normalizedEmail =
          email.trim().toLowerCase();

        const { error } =
          await supabase.auth.signInWithOtp({
            email: normalizedEmail,
            options: {
              shouldCreateUser: true,
            },
          });

        if (error) {
          throw error;
        }

        setStep("code");

        setMessage(
          "Code envoyé par email."
        );

      } catch (err) {
        setMessage(
          err?.message ||
          "Impossible d’envoyer le code."
        );

      } finally {
        setLoading(false);
      }
    };

  const verifyCode =
    async (event) => {
      event.preventDefault();

      try {
        setLoading(true);
        setMessage("");

        const normalizedEmail =
          email.trim().toLowerCase();

        const { data, error } =
          await supabase.auth.verifyOtp({
            email: normalizedEmail,
            token: code.trim(),
            type: "email",
          });

        if (error) {
          throw error;
        }

        if (!data?.session) {
          throw new Error(
            "Session Supabase introuvable."
          );
        }

        onAuthenticated?.(
          data.session
        );

      } catch (err) {
        setMessage(
          err?.message ||
          "Code incorrect ou expiré."
        );

      } finally {
        setLoading(false);
      }
    };

  return (
    <main className="protocol-home">

      <section className="protocol-panel">

        <h1>
          PROTOCOL
        </h1>

        {step === "email" && (

          <form onSubmit={sendCode}>

            <label>
              Email
            </label>

            <input
              type="email"
              value={email}
              onChange={(event) =>
                setEmail(
                  event.target.value
                )
              }
              required
              autoComplete="email"
            />

            <button
              type="submit"
              disabled={loading}
            >
              {loading
                ? "Envoi…"
                : "Recevoir mon code"}
            </button>

          </form>

        )}

        {step === "code" && (

          <form onSubmit={verifyCode}>

            <label>
              Code reçu
            </label>

            <input
              type="text"
              inputMode="numeric"
              value={code}
              onChange={(event) =>
                setCode(
                  event.target.value
                    .replace(/\D/g, "")
                    .slice(0, 6)
                )
              }
              maxLength={6}
              required
              autoComplete="one-time-code"
            />

            <button
              type="submit"
              disabled={
                loading ||
                code.length !== 6
              }
            >
              {loading
                ? "Connexion…"
                : "Entrer"}
            </button>

          </form>

        )}

        {message && (
          <p>
            {message}
          </p>
        )}

      </section>

    </main>
  );
}

/* =========================================================
   APP
   ========================================================= */

function App() {
  const [authSession, setAuthSession] =
    useState(null);

  const [authLoading, setAuthLoading] =
    useState(true);

  useEffect(() => {
    let active = true;

    supabase.auth
      .getSession()
      .then(({ data }) => {
        if (!active) {
          return;
        }

        setAuthSession(
          data?.session ?? null
        );

        setAuthLoading(false);
      });

    const {
      data: authListener,
    } =
      supabase.auth.onAuthStateChange(
        (_event, session) => {

          setAuthSession(
            session ?? null
          );

          setAuthLoading(false);
        }
      );

    return () => {
      active = false;

      authListener?.subscription?.unsubscribe();
    };
  }, []);

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

  useEffect(() => {

    /*
    * PRIVACY SCREEN
    *
    * Masque le contenu PROTOCOL lorsque
    * l'app passe en arrière-plan.
    */

    const existing =
      document.getElementById(
        "protocol-privacy-screen"
      );

    if (existing) {
      existing.remove();
    }


    const privacyScreen =
      document.createElement("div");

    privacyScreen.id =
      "protocol-privacy-screen";

    privacyScreen.setAttribute(
      "aria-hidden",
      "true"
    );


    privacyScreen.innerHTML = `
      <div class="protocol-privacy-content">

        <div class="protocol-privacy-logo">
          PROTOCOL
        </div>

        <div class="protocol-privacy-version">
          <span></span>
          <small>V2</small>
          <span></span>
        </div>

        <div class="protocol-privacy-symbol">
          ◇
        </div>

        <p>
          Privé · Discret · À deux
        </p>

      </div>
    `;


    document.body.appendChild(
      privacyScreen
    );


    const showPrivacyScreen = () => {

      privacyScreen.classList.add(
        "is-visible"
      );

    };


    const hidePrivacyScreen = () => {

      privacyScreen.classList.remove(
        "is-visible"
      );

    };


    const handleVisibilityChange = () => {

      if (
        document.visibilityState ===
        "hidden"
      ) {

        showPrivacyScreen();

      } else {

        hidePrivacyScreen();

      }

    };


    const handlePageHide = () => {

      showPrivacyScreen();

    };


    const handlePageShow = () => {

      if (
        document.visibilityState ===
        "visible"
      ) {

        hidePrivacyScreen();

      }

    };


    document.addEventListener(
      "visibilitychange",
      handleVisibilityChange
    );

    window.addEventListener(
      "pagehide",
      handlePageHide
    );

    window.addEventListener(
      "pageshow",
      handlePageShow
    );


    /*
    * Etat initial.
    */

    handleVisibilityChange();


    return () => {

      document.removeEventListener(
        "visibilitychange",
        handleVisibilityChange
      );

      window.removeEventListener(
        "pagehide",
        handlePageHide
      );

      window.removeEventListener(
        "pageshow",
        handlePageShow
      );

      privacyScreen.remove();

    };

  }, []);

  if (authLoading) {
    return null;
  }

  if (!authSession) {
    return (
      <AuthScreen
        onAuthenticated={
          setAuthSession
        }
      />
    );
  }

  if (route.screen === "settings") {
    return (
      <SettingsScreen
        navigate={navigate}
      />
    );
  }

  if (
    route.screen ===
    "messages"
  ) {

    const ownerKey =
      getPushOwner();

    if (
      !ownerKey
    ) {
      navigate(
        "/settings",
        true
      );

      return null;
    }


    return (
      <MessagesScreen
        supabase={
          supabase
        }

        ownerKey={
          ownerKey
        }

        onBack={() =>
          navigate("/")
        }
      />
    );
  }

  if (route.screen === "invitations") {

    const ownerKey =
      getPushOwner();

    if (!ownerKey) {
      navigate(
        "/settings",
        true
      );

      return null;
    }

    return (
      <InvitationsScreen
        supabase={supabase}
        ownerKey={ownerKey}
        onBack={() =>
          navigate("/")
        }
        onOpenCard={({
          cardId,
          activeKey,
          invitationId,
        }) => {

          navigate(
            `/card/${cardId}?for=${activeKey}&invite=${invitationId}&from=invitations`
          );

        }}
      />
    );
  }

  if (route.screen === "library") {
    const ownerKey = getPushOwner();

    if (!ownerKey) {
      navigate("/settings", true);
      return null;
    }

    return (
      <LibraryScreen
        supabase={supabase}
        ownerKey={ownerKey}
        onBack={() => navigate("/")}
        onOpenCard={(cardId) => {
          const recipientKey =
            ownerKey === "jerome"
              ? "audrey"
              : "jerome";

          const challengeQuery =
            route.challengeId
              ? `&challenge=${route.challengeId}`
              : "";

          navigate(
            `/card/${cardId}?for=${recipientKey}${challengeQuery}`
          );
        }}
      />
    );
  }

  if (route.screen === "card") {
    const ownerKey =
      getPushOwner();

    if (!ownerKey) {
      navigate(
        "/settings",
        true
      );

      return null;
    }

    const activeKey =
      route.activeKey ||
      (
        ownerKey === "jerome"
          ? "audrey"
          : "jerome"
      );

    return (
      <CardScreen
        supabase={supabase}

        cardId={
          route.cardId
        }

        ownerKey={
          ownerKey
        }

        activeKey={
          activeKey
        }

        invitationId={
          route.invitationId
        }

        challengeId={
          route.challengeId
        }

        onBack={() =>
          navigate(
            route.from === "invitations"
              ? "/invitations"
              : route.challengeId
                ? `/library?challenge=${route.challengeId}`
                : "/library"
          )
        }
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

function HomeScreen({ navigate }) {
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
              p_player_no:
                session.playerNumber,
              p_player_token:
                session.playerToken,
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
          * Le token n'est plus valide,
          * la partie n'existe plus,
          * ou elle n'est plus accessible.
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

    const resumeCurrentGame = () => {
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
        navigate(
          `/game/${code}/identity`
        );

        return;
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
        secret: "Secret proposé.",
        challenge: "Défi proposé.",
        tonight: "Invitation envoyée.",
      };

      setInviteMessage(
        messages[signal] || "Signal envoyé."
      );

    } catch (err) {
      console.error(
        "SEND INVITATION ERROR:",
        err
      );

      setInviteMessage(
        err?.message ||
          "Impossible d’envoyer le signal."
      );

    } finally {
      setInviteLoading(false);
    }
  };

  const joinGameFromHome = async (
    event
  ) => {
    event?.preventDefault();

    if (joinCode.length !== 6) {
      return;
    }

    try {
      setJoinLoading(true);
      setJoinError("");

      const normalized =
        joinCode.toUpperCase();

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
        !joinedGame?.player_token
      ) {
        throw new Error(
          "Réponse de connexion invalide."
        );
      }

      saveGameSession(
        joinedGame.code,
        joinedGame.player_no,
        joinedGame.player_token
      );

      setJoinOpen(false);

      navigate(
        `/game/${joinedGame.code}/identity`
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
  
  const createGame = async () => {
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
        !createdGame?.player_token
      ) {
        throw new Error(
          "Réponse de création invalide."
        );
      }

      saveGameSession(
        createdGame.code,
        createdGame.player_no,
        createdGame.player_token
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
    <main className="app protocol-home-page">

      {/* =========================================
          HEADER
          ========================================= */}

      <header className="protocol-home-header">

        <div className="protocol-home-brand">

          <span className="protocol-home-brand-name">
            PROTOCOL
          </span>

          <div className="protocol-home-brand-sub">
            <span />
            <small>V2</small>
            <span />
          </div>

        </div>

      </header>


      <section className="protocol-home-dashboard">


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

                    <div className="protocol-level-dots">
                      <span />
                      <span />
                      <span />
                    </div>

                    <strong>
                      Niveau{" "}
                      {
                        resumeGame
                          .shared_profile
                          .intensity
                      }
                    </strong>

                    <small>
                      PLUS INTENSE
                    </small>

                  </div>

                )}

              </div>


              <div className="protocol-home-status">

                <span className="protocol-status-dot is-active" />

                <div>

                  <strong>
                    Ce soir, laissez le jeu prendre les commandes.
                  </strong>

                  <p>
                    À deux. À votre rythme. Sans prévoir la suite.
                  </p>

                </div>

              </div>

            </div>


            {/* ACTIONS */}

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
                onClick={createGame}
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

              {resumeHasUpdate && (
                <i />
              )}

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

        <section className="protocol-home-signals">

          <div className="protocol-home-section-title">

            <span className="protocol-home-section-line" />

            <h2>
              Un signe ?
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

              </span>

              <strong>
                Un secret ?
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
                placeholder="XXXXXX"
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

  const [hasLocalGameSession, setHasLocalGameSession] =
    useState(() => getGameSession().valid);

  const [lovenseHost, setLovenseHost] =
    useState("jerome");

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

    const openLovenseRemote =
      async () => {
        try {
          setLovenseOpening(true);
          setLovenseSdkError("");

          if (
            !window.LovenseBasicSdk
          ) {
            throw new Error(
              "Le SDK Lovense n’est pas chargé."
            );
          }

          const {
            data,
            error,
          } =
            await supabase.functions.invoke(
              "lovense-auth",
              {
                body: {
                  owner_key:
                    lovenseHost,
                },
              }
            );

          if (error) {
            throw error;
          }

          if (
            !data?.success ||
            !data?.authToken
          ) {
            throw new Error(
              data?.error ||
              "Impossible d’initialiser Lovense."
            );
          }

          const sdk =
            new window.LovenseBasicSdk({
              platform:
                "PROTOCOL",

              authToken:
                data.authToken,

              uid:
                data.uid,

              /*
              * Remote App par défaut.
              * Donc PAS appType: "connect".
              */
              debug: true,
            });

          sdk.on(
            "sdkError",
            (sdkError) => {
              console.error(
                "LOVENSE SDK ERROR FULL:",
                {
                  code: sdkError?.code,
                  message: sdkError?.message,
                  raw: sdkError,
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

          sdk.on(
            "ready",
            async (instance) => {
              try {
                const qrTest =
                  await instance.getQrcode();

                console.log(
                  "LOVENSE SDK QRCODE:",
                  qrTest
                );

                instance.connectLovenseAPP();

                setLovenseMessage(
                  "Lovense Remote va s’ouvrir. Si iOS affiche la page Lovense à la place, utilise la connexion par QR."
                );

              } catch (err) {
                console.error(
                  "LOVENSE OPEN APP ERROR:",
                  err
                );

                setLovenseSdkError(
                  err?.message ||
                  "Impossible d’ouvrir Lovense Remote."
                );

              } finally {
                setLovenseOpening(false);
              }
            }
          );

        } catch (err) {
          console.error(
            "LOVENSE CONNECTION ERROR:",
            err
          );

          setLovenseSdkError(
            err?.message ||
            "Impossible de connecter Lovense."
          );

          setLovenseOpening(false);
        }
      };
    
      const connectLovense = async () => {
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
                body: {
                  owner_key: lovenseHost,
                },
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
            lovenseHost === "jerome"
              ? "Scanne ce QR avec Lovense Remote sur le téléphone de Jérôme."
              : "Scanne ce QR avec Lovense Remote sur le téléphone d’Audrey."
          );

        } 
        catch (err) {
          console.error(
            "LOVENSE CONNECT ERROR:",
            err
          );

          setLovenseMessage(
            err?.message ||
            "Impossible de connecter Lovense."
          );

        } 
        finally {
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
              body: {
                host:
                  lovenseHost,
              },
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
          Boolean(data.connected)
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
    }, [lovenseHost]);

    useEffect(() => {
    const handleLovenseReturn = () => {
      if (
        document.visibilityState ===
        "visible"
      ) {
        checkLovenseStatus();
      }
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
  }, [lovenseHost]);

  const testLovense = async () => {
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
              host:
                lovenseHost,
              intensity: 5,
              duration: 2,
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
              <div
                style={{
                  marginTop: "10px",
                }}
              >
                <span
                  className="notification-eyebrow"
                  style={{
                    display: "block",
                    marginBottom: "10px",
                  }}
                >
                  CET APPAREIL APPARTIENT À
                </span>

                <div
                  style={{
                    display: "grid",
                    gridTemplateColumns: "1fr 1fr",
                    gap: "10px",
                  }}
                >
                  <button
                    type="button"
                    className="secondary"
                    onClick={() => {
                      if (owner !== "jerome") {
                        setSubscribed(false);
                      }

                      setOwner("jerome");
                      setMessage("");
                    }}
                    aria-pressed={
                      owner === "jerome"
                    }
                    style={
                      owner === "jerome"
                        ? {
                            borderColor:
                              "rgba(255,255,255,.9)",
                            background:
                              "rgba(255,255,255,.12)",
                          }
                        : undefined
                    }
                  >
                    <span>Jérôme</span>
                  </button>

                  <button
                    type="button"
                    className="secondary"
                    onClick={() => {
                      if (owner !== "audrey") {
                        setSubscribed(false);
                      }

                      setOwner("audrey");
                      setMessage("");
                    }}
                    aria-pressed={
                      owner === "audrey"
                    }
                    style={
                      owner === "audrey"
                        ? {
                            borderColor:
                              "rgba(255,255,255,.9)",
                            background:
                              "rgba(255,255,255,.12)",
                          }
                        : undefined
                    }
                  >
                    <span>Audrey</span>
                  </button>
                </div>
              </div>
            )}

          {message && (
            <p className="notification-message">
              {message}
            </p>
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

        <div className="settings-section-card">

          <div className="settings-section-heading">
            <span className="settings-section-eyebrow">
              LOVENSE
            </span>

            <h2>
              Connecter le Lush 4.
            </h2>
          </div>

          <p
            style={{
              margin: "0 0 16px",
              opacity: 0.72,
              lineHeight: 1.5,
            }}
          >
            Connecte Lovense Remote à PROTOCOL
            pour permettre au jeu de contrôler
            le jouet.
          </p>


          {!lovenseQr && (
            <>
              <span
                className="settings-section-eyebrow"
                style={{
                  display: "block",
                  marginBottom: "10px",
                }}
              >
                LE LUSH EST CONNECTÉ AU TÉLÉPHONE DE
              </span>

              <div
                style={{
                  display: "grid",
                  gridTemplateColumns: "1fr 1fr",
                  gap: "10px",
                  marginBottom: "14px",
                }}
              >
                <button
                  type="button"
                  className="secondary"
                  onClick={() => {
                    setLovenseHost("jerome");
                    setLovenseMessage("");
                  }}
                  aria-pressed={
                    lovenseHost === "jerome"
                  }
                  style={
                    lovenseHost === "jerome"
                      ? {
                          borderColor:
                            "rgba(255,255,255,.9)",
                          background:
                            "rgba(255,255,255,.12)",
                        }
                      : undefined
                  }
                >
                  <span>
                    Jérôme
                  </span>
                </button>

                <button
                  type="button"
                  className="secondary"
                  onClick={() => {
                    setLovenseHost("audrey");
                    setLovenseMessage("");
                  }}
                  aria-pressed={
                    lovenseHost === "audrey"
                  }
                  style={
                    lovenseHost === "audrey"
                      ? {
                          borderColor:
                            "rgba(255,255,255,.9)",
                          background:
                            "rgba(255,255,255,.12)",
                        }
                      : undefined
                  }
                >
                  <span>
                    Audrey
                  </span>
                  </button>
              </div>

              <div
                style={{
                  marginBottom: "14px",
                }}
              >
                <span
                  className="notification-status"
                >
                  {lovenseStatusLoading
                    ? "VÉRIFICATION"
                    : lovenseConnected
                      ? "CONNECTÉ"
                      : "NON CONNECTÉ"}
                </span>

                {!lovenseStatusLoading &&
                  lovenseConnected && (
                    <p
                      style={{
                        margin: "8px 0 0",
                        opacity: 0.7,
                        fontSize: "0.84rem",
                      }}
                    >
                      {lovenseToyName
                        ? `${lovenseToyName} disponible`
                        : "Jouet Lovense disponible"}
                    </p>
                  )}
              </div>

              <button
                type="button"
                className="notification-enable"
                onClick={openLovenseRemote}
                disabled={lovenseOpening}
              >
                <span>
                  {lovenseOpening
                    ? "Ouverture…"
                    : "Ouvrir Lovense Remote"}
                </span>

                <span className="notification-arrow">
                  →
                </span>
              </button>

              {lovenseSdkError && (
                <p
                  style={{
                    margin: "12px 0 0",
                    fontSize: "0.82rem",
                    lineHeight: 1.45,
                    opacity: 0.7,
                  }}
                >
                  {lovenseSdkError}
                </p>
              )}

              <div
                style={{
                  marginTop: "14px",
                  textAlign: "center",
                }}
              >
                <button
                  type="button"
                  onClick={connectLovense}
                  disabled={
                    lovenseLoading ||
                    lovenseOpening
                  }
                  style={{
                    appearance: "none",
                    border: "none",
                    background: "transparent",
                    padding: "6px 8px",
                    color: "inherit",
                    font: "inherit",
                    fontSize: "0.82rem",
                    opacity: 0.62,
                    textDecoration: "underline",
                    textUnderlineOffset: "3px",
                    cursor: "pointer",
                  }}
                >
                  {lovenseLoading
                    ? "Préparation du QR…"
                    : "L’app ne s’ouvre pas ? Utiliser le QR"}
                </button>
              </div>
            </>
          )}


          {lovenseQr && (
            <div
              style={{
                display: "grid",
                justifyItems: "center",
                gap: "16px",
                marginTop: "12px",
              }}
            >

              <span
                className="notification-status"
                style={{
                  justifySelf: "start",
                }}
              >
                EN ATTENTE D’ASSOCIATION
              </span>

              <div
                style={{
                  background: "#fff",
                  padding: "12px",
                  borderRadius: "20px",
                }}
              >
                <img
                  src={lovenseQr}
                  alt="QR de connexion Lovense"
                  style={{
                    width: "220px",
                    height: "220px",
                    display: "block",
                  }}
                />
              </div>

              <strong
                style={{
                  textAlign: "center",
                  lineHeight: 1.35,
                }}
              >
                Scanne avec Lovense Remote
                <br />
                sur le téléphone de{" "}
                {lovenseHost === "jerome"
                  ? "Jérôme"
                  : "Audrey"}
              </strong>

              {lovenseCode && (
                <span
                  style={{
                    opacity: 0.45,
                    fontSize: "0.78rem",
                  }}
                >
                  Code : {lovenseCode}
                </span>
              )}

              <button
                type="button"
                className="secondary"
                onClick={() => {
                  setLovenseQr("");
                  setLovenseCode("");
                  setLovenseMessage("");
                }}
                style={{
                  width: "100%",
                  marginTop: "4px",
                }}
              >
                Régénérer le QR
              </button>

            </div>
          )}

          {lovenseMessage && !lovenseQr && (
            <p
              className="notification-message"
              style={{
                marginTop: "14px",
              }}
            >
              {lovenseMessage}
            </p>
          )}

          <div
            style={{
              marginTop: "18px",
              paddingTop: "18px",
              borderTop:
                "1px solid rgba(255,255,255,0.08)",
            }}
          >
            <span className="notification-eyebrow">
              TEST
            </span>

            <p
              style={{
                margin: "8px 0 14px",
                opacity: 0.7,
                fontSize: "0.86rem",
                lineHeight: 1.45,
              }}
            >
              Envoie une vibration légère
              de 2 secondes au jouet connecté.
            </p>

            <button
              type="button"
              className="secondary"
              onClick={testLovense}
              disabled={
                lovenseTestLoading ||
                !lovenseConnected
              }
              style={{
                width: "100%",
              }}
            >
              {lovenseTestLoading
                ? "Envoi…"
                : "Tester le Lush"}
            </button>

            {lovenseTestMessage && (
              <p
                style={{
                  margin: "12px 0 0",
                  fontSize: "0.82rem",
                  opacity: 0.7,
                }}
              >
                {lovenseTestMessage}
              </p>
            )}
          </div>

          </div>

          <div className="settings-section-card">
          <div className="settings-section-heading">
            <span className="settings-section-eyebrow">
              CONFIDENTIALITÉ
            </span>

            <h2>
              Ce qui reste entre vous
              reste entre vous.
            </h2>
          </div>

          <div className="settings-privacy-list">
            <div className="settings-privacy-item">
              <span className="settings-privacy-icon">
                ◇
              </span>

              <div>
                <strong>
                  Notifications discrètes
                </strong>

                <span>
                  Le contenu sensible des cartes
                  n’est jamais affiché dans les
                  notifications.
                </span>
              </div>
            </div>

            <div className="settings-privacy-item">
              <span className="settings-privacy-icon">
                ◇
              </span>

              <div>
                <strong>
                  Session privée
                </strong>

                <span>
                  L’accès à une partie repose sur
                  un identifiant propre à cet appareil.
                </span>
              </div>
            </div>

            <div className="settings-privacy-item">
              <span className="settings-privacy-icon">
                ◇
              </span>

              <div>
                <strong>
                  Contrôle local
                </strong>

                <span>
                  Tu peux oublier la partie mémorisée
                  sur cet appareil à tout moment.
                </span>
              </div>
            </div>
          </div>
        </div>

        <div className="settings-device-card">
          <div>
            <span className="settings-section-eyebrow">
              CET APPAREIL
            </span>

            <h3>
              Session mémorisée
            </h3>

            <p>
              PROTOCOL conserve localement l’accès
              nécessaire pour reprendre cette partie.
            </p>
          </div>

          {hasLocalGameSession ? (
            <button
              type="button"
              className="settings-forget-button"
              onClick={forgetLocalGame}
            >
              <span>
                Oublier cette partie
              </span>

              <span>×</span>
            </button>
          ) : (
            <div className="settings-device-empty">
              Aucune partie mémorisée sur cet appareil.
            </div>
          )}
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
      !joinedGame?.player_token
    ) {
      throw new Error(
        "Réponse de connexion invalide."
      );
    }

    saveGameSession(
      joinedGame.code,
      joinedGame.player_no,
      joinedGame.player_token
    );

    navigate(
      `/game/${joinedGame.code}/identity`
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
    const {
      playerNumber,
      playerToken,
      valid: hasGameSession,
    } = getGameSession(code);

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

          if (!hasGameSession) {
            if (active) {
              setInitialLoading(false);
            }

            return;
          }

          try {
            const {
              data,
              error: loadError,
            } = await supabase.rpc(
              "get_protocol_game",
              {
                p_game_code: code,
                p_player_no:
                  playerNumber,
                p_player_token:
                  playerToken,
              }
            );

            if (loadError) {
              throw loadError;
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

            if (playerNumber === 1) {
              setName(
                game.player_1_name || ""
              );

              setSex(
                game.player_1_sex || null
              );

            } else {
              setName(
                game.player_2_name || ""
              );

              setSex(
                game.player_2_sex || null
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

    }, [
      code,
      playerNumber,
      playerToken,
      hasGameSession,
    ]);


    const saveIdentity =
      async () => {

        const cleanName =
          name.trim();

        if (
          cleanName.length < 1 ||
          !sex ||
          !hasGameSession
        ) {
          return;
        }

        try {
          setLoading(true);
          setError("");

          const {
            error: rpcError,
          } = await supabase.rpc(
            "save_protocol_identity",
            {
              p_game_code: code,
              p_player_no:
                playerNumber,
              p_player_token:
                playerToken,
              p_name:
                cleanName,
              p_sex:
                sex,
            }
          );

          if (rpcError) {
            throw rpcError;
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


    if (!hasGameSession) {
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

  const {
    playerNumber,
    playerToken,
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
        p_player_no:
          playerNumber,
        p_player_token:
          playerToken,
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
        "set_protocol_ready_secure",
        {
          p_game_code: code,
          p_player_no:
            playerNumber,
          p_player_token:
            playerToken,
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

  if (!hasGameSession) {
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
  const {
    playerNumber,
    playerToken,
    valid: hasGameSession,
  } = getGameSession(code);

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
            p_player_no: playerNumber,
            p_player_token: playerToken,
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
    playerNumber,
    playerToken,
    hasGameSession,
    navigate,
  ]);

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
          "submit_calibration_secure",
          {
            p_game_code: code,
            p_player_no:
              playerNumber,
            p_player_token:
              playerToken,
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
                      "start_protocol_secure",
                      {
                        p_game_code: code,
                        p_player_no:
                          playerNumber,
                        p_player_token:
                          playerToken,
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

function PhaseTransition({
  phase,
  label,
}) {
  const previousPhaseRef =
    useRef(null);

  const [visible, setVisible] =
    useState(false);

  useEffect(() => {
    if (!phase) {
      return;
    }

    /*
     * Premier affichage :
     * on montre aussi WARMUP.
     */
    const phaseChanged =
      previousPhaseRef.current !== phase;

    if (!phaseChanged) {
      return;
    }

    previousPhaseRef.current =
      phase;

    setVisible(true);

    const timer =
      window.setTimeout(() => {
        setVisible(false);
      }, 1450);

    return () => {
      window.clearTimeout(timer);
    };
  }, [phase]);

  if (!visible) {
    return null;
  }

  return (
    <div
      className={
        `phase-transition phase-transition-${phase}`
      }
      aria-hidden="true"
    >
      <div className="phase-transition-line" />

      <span className="phase-transition-small">
        PROTOCOL
      </span>

      <strong>
        {label}
      </strong>

      <span className="phase-transition-mark">
        ◇
      </span>
    </div>
  );
}
  
function PlayScreen({
  code,
  navigate,
}) {
  const [finalStats, setFinalStats] =
    useState(null);

  const [rematchLoading, setRematchLoading] =
    useState(false);

  const [rematchError, setRematchError] =
    useState("");

  const {
    playerNumber,
    playerToken,
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
      Number(game.timer_card_id) !==
        Number(card?.id)
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
        Number(game?.timer_card_id) ===
          Number(card?.id) &&
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
        Number(game?.timer_card_id) ===
        Number(card?.id);

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

      const startedAt =
        new Date().toISOString();

      const {
        error: timerError,
      } = await supabase.rpc(
        "update_protocol_timer",
        {
          p_game_code: code,
          p_player_no:
            playerNumber,
          p_player_token:
            playerToken,
          p_card_id:
            card.id,
          p_started_at:
            startedAt,
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
          p_player_no:
            playerNumber,
          p_player_token:
            playerToken,
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
          p_player_no:
            playerNumber,
          p_player_token:
            playerToken,
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
    card?.timer_seconds,

    game?.timer_card_id,
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
        "get_scene_state_secure",
        {
          p_game_code: code,
          p_player_no:
            playerNumber,
          p_player_token:
            playerToken,
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
    "get_active_rules_secure",
    {
      p_game_code: code,
      p_player_no:
        playerNumber,
      p_player_token:
        playerToken,
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
      "mark_scene_step_read_secure",
      {
        p_game_code: code,
        p_player_no:
          playerNumber,
        p_player_token:
          playerToken,
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
      "advance_scene_step_secure",
      {
        p_game_code: code,
        p_player_no:
          playerNumber,
        p_player_token:
          playerToken,
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
        p_player_no:
          playerNumber,
        p_player_token:
          playerToken,
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
    * REVANCHE :
    * lorsqu'un des deux joueurs relance
    * la partie, Supabase remet le statut
    * à "ready".
    */
    if (
      gameData.status ===
      "ready"
    ) {
      setGame(gameData);
      setCard(null);

      navigate(
        `/game/${code}/calibration`
      );

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
              "get_protocol_final_stats_secure",
              {
                p_game_code: code,
                p_player_no:
                  playerNumber,
                p_player_token:
                  playerToken,
              }
            );

            if (statsError) {
              throw statsError;
            }

            if (active) {
              setFinalStats(data);
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
        playerNumber,
        playerToken,
      ]);



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
          "advance_protocol_secure",
          {
            p_game_code: code,
            p_player_no:
              playerNumber,
            p_player_token:
              playerToken,
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
          "buy_protocol_bonus_secure",
          {
            p_game_code: code,
            p_player_no:
              playerNumber,
            p_player_token:
              playerToken,
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
          "use_choose_type_secure",
          {
            p_game_code: code,
            p_player_no:
              playerNumber,
            p_player_token:
              playerToken,
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
              "rematch_protocol_secure",
              {
                p_game_code: code,
                p_player_no:
                  playerNumber,
                p_player_token:
                  playerToken,
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
              `/game/${code}/calibration`
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
              TERMINÉ
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


              {winnerName ? (

                <>

                  <p className="final-reveal-small">
                    CE SOIR
                  </p>

                  <h1 className="final-winner-title">
                    {winnerName}
                    <br />
                    l'emporte.
                  </h1>

                </>

              ) : (

                <>

                  <p className="final-reveal-small">
                    CE SOIR
                  </p>

                  <h1 className="final-winner-title">
                    Égalité.
                  </h1>

                </>

              )}

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
                CLOSING
                ===================================== */}

            <div className="final-wow-closing final-afterglow">

              <span className="final-symbol">
                ◇
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
                    ? "PRÉPARATION…"
                    : "REVANCHE"}
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
                TERMINER LE PROTOCOL
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

  return (
    <main className="app play-page">

      <div className="glow glow-center" />

      <PhaseTransition
        phase={game.phase}
        label={
          phaseLabels[game.phase] ||
          game.phase?.toUpperCase()
        }
      />


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
                "use_take_control_secure",
                {
                  p_game_code:
                    code,

                  p_player_no:
                    playerNumber,

                  p_player_token:
                    playerToken,
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
            `card-reveal card-reveal-${card.type}`
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

              <span className="card-reveal-whisper">
                {card.intensity >= 5
                  ? "INTENSITÉ MAX"
                  : phaseLabels[game.phase]}
              </span>

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
                    nextLoading
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