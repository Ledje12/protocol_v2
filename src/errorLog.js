import { supabase } from "./supabaseClient.js";

/* =========================================================
   JOURNAL DES ERREURS
   Les erreurs de l'app (plantage, promesse rejetée, action qui
   échoue et que l'écran note avec console.error) sont envoyées
   à la table protocol_client_errors de Supabase, sans service
   extérieur. Aucun contenu de carte ni de message : seulement
   le message d'erreur, la pile, la page et la version.
   Garde-fous : doublons ignorés, 20 envois par session au plus,
   rien hors connexion, et jamais d'erreur en cascade.
   ========================================================= */

const MAX_PER_SESSION = 20;

// bruit connu, sans intérêt pour comprendre un bug
const IGNORED = [
  /lovense/i,
  /realtime|websocket/i,
  /ResizeObserver loop/i,
  /AbortError|signal is aborted/i,
  /Load failed|Failed to fetch|NetworkError/i,
];

const APP_VERSION =
  typeof __APP_VERSION__ !== "undefined" ? __APP_VERSION__ : "dev";

const seen = new Set();
let sent = 0;

// envois l'un après l'autre, jamais en parallèle
let queue = Promise.resolve();

const describe = (value) => {
  if (value instanceof Error) {
    return { message: value.message || value.name, stack: value.stack };
  }

  // erreurs Supabase / PostgREST : { message, code, details, hint }
  if (value && typeof value === "object" && typeof value.message === "string") {
    const code = value.code ? ` [${value.code}]` : "";
    return { message: value.message + code, stack: value.stack || null };
  }

  return { message: String(value), stack: null };
};

// La page, sans le code de partie (inutile pour comprendre le bug).
const currentPath = () =>
  window.location.pathname.replace(/\/game\/[^/]+/, "/game/:code");

export function reportError(source, error, label = "") {
  try {
    const { message, stack } = describe(error);
    const text = label ? `${label} ${message}` : message;

    if (
      !message ||
      sent >= MAX_PER_SESSION ||
      !navigator.onLine ||
      IGNORED.some((pattern) => pattern.test(text))
    ) {
      return;
    }

    const key = `${source}|${text}`;

    if (seen.has(key)) {
      return;
    }

    seen.add(key);
    sent += 1;

    const payload = {
      p_source: source,
      p_message: text.slice(0, 1000),
      p_stack: stack ? String(stack).slice(0, 4000) : null,
      p_app_version: APP_VERSION,
      p_user_agent: navigator.userAgent.slice(0, 300),
      p_context: {
        path: currentPath(),
        standalone: window.matchMedia?.("(display-mode: standalone)").matches,
      },
    };

    queue = queue
      .then(() => supabase.rpc("log_client_error", payload))
      .catch(() => {});
  } catch {
    // le journal ne doit jamais provoquer d'erreur lui-même
  }
}

export function installErrorLog() {
  window.addEventListener("error", (event) => {
    reportError("window", event.error || event.message);
  });

  window.addEventListener("unhandledrejection", (event) => {
    reportError("promise", event.reason);
  });

  // Les écrans notent leurs échecs ainsi :
  //   console.error("CHOOSE TYPE ERROR:", err)
  // On garde ceux qui portent une vraie erreur.
  const original = console.error.bind(console);

  console.error = (...args) => {
    original(...args);

    const error = args.find(
      (arg) =>
        arg instanceof Error ||
        (arg && typeof arg === "object" && typeof arg.message === "string")
    );

    // React répète ainsi (« %o … ») un plantage déjà noté par
    // ErrorBoundary : on ne le compte pas deux fois
    const reactEcho = typeof args[0] === "string" && args[0].startsWith("%");

    if (error && !reactEcho) {
      const label = typeof args[0] === "string" ? args[0] : "";
      reportError("screen", error, label);
    }
  };
}
