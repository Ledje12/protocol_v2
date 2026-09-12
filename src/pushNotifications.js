/* =========================================================
   PROTOCOL
   PUSH NOTIFICATIONS
   ========================================================= */


/* =========================================================
   CONFIG
   ========================================================= */

const VAPID_PUBLIC_KEY =
  import.meta.env.VITE_VAPID_PUBLIC_KEY;


/* =========================================================
   DEVICE ID
   ========================================================= */

/*
 * Chaque installation de PROTOCOL reçoit
 * un identifiant permanent.
 *
 * Il reste stocké dans localStorage,
 * donc :
 *
 * - ton iPhone garde toujours le même ID
 * - l'iPhone d'Audrey possède son propre ID
 */

function getDeviceId() {
  const storageKey =
    "protocol-push-device-id";

  let deviceId =
    localStorage.getItem(storageKey);

  if (deviceId) {
    return deviceId;
  }

  if (!crypto?.randomUUID) {
    throw new Error(
      "Impossible de générer l'identifiant de cet appareil."
    );
  }

  deviceId =
    crypto.randomUUID();

  localStorage.setItem(
    storageKey,
    deviceId
  );

  return deviceId;
}


/* =========================================================
   VAPID CONVERSION
   ========================================================= */

/*
 * PushManager.subscribe() attend la clé VAPID
 * sous forme Uint8Array.
 *
 * La variable Vercel est stockée en Base64 URL-safe.
 */

function urlBase64ToUint8Array(
  base64String
) {
  const padding =
    "=".repeat(
      (4 - (base64String.length % 4)) % 4
    );

  const base64 =
    (
      base64String + padding
    )
      .replace(/-/g, "+")
      .replace(/_/g, "/");

  const rawData =
    window.atob(base64);

  return Uint8Array.from(
    [...rawData].map(
      (character) =>
        character.charCodeAt(0)
    )
  );
}


/* =========================================================
   SUPPORT
   ========================================================= */

export function getPushSupport() {
  if (
    !("serviceWorker" in navigator)
  ) {
    return {
      supported: false,
      reason:
        "Les Service Workers ne sont pas disponibles.",
    };
  }

  if (
    !("PushManager" in window)
  ) {
    return {
      supported: false,
      reason:
        "Web Push n'est pas disponible sur cet appareil.",
    };
  }

  if (
    !("Notification" in window)
  ) {
    return {
      supported: false,
      reason:
        "Les notifications ne sont pas disponibles.",
    };
  }

  return {
    supported: true,
    reason: null,
  };
}


/* =========================================================
   EXISTING SUBSCRIPTION
   ========================================================= */

export async function getCurrentPushSubscription() {
  const support =
    getPushSupport();

  if (!support.supported) {
    return null;
  }

  const registration =
    await navigator.serviceWorker.ready;

  return registration.pushManager
    .getSubscription();
}


/* =========================================================
   CREATE / REGISTER SUBSCRIPTION
   ========================================================= */

/*
 * ownerKey :
 *
 *   "jerome"
 *   ou
 *   "audrey"
 *
 *
 * supabaseClient :
 *
 *   le client Supabase déjà créé dans App.jsx.
 */

export async function registerPushNotifications({
  ownerKey,
  supabaseClient,
}) {
  /* ---------------------------------------------------------
     VALIDATIONS
     --------------------------------------------------------- */

  if (
    ownerKey !== "jerome" &&
    ownerKey !== "audrey"
  ) {
    throw new Error(
      "Utilisateur PROTOCOL invalide."
    );
  }

  if (!supabaseClient) {
    throw new Error(
      "Client Supabase indisponible."
    );
  }

  if (!VAPID_PUBLIC_KEY) {
    throw new Error(
      "VITE_VAPID_PUBLIC_KEY est absente."
    );
  }


  /* ---------------------------------------------------------
     SUPPORT
     --------------------------------------------------------- */

  const support =
    getPushSupport();

  if (!support.supported) {
    throw new Error(
      support.reason
    );
  }


  /* ---------------------------------------------------------
     PERMISSION
     --------------------------------------------------------- */

  let permission =
    Notification.permission;

  /*
   * Si la permission n'a jamais été demandée,
   * cette fonction peut encore la demander.
   *
   * Dans notre interface elle sera appelée
   * directement après un clic utilisateur.
   */

  if (permission === "default") {
    permission =
      await Notification.requestPermission();
  }

  if (permission !== "granted") {
    throw new Error(
      "Les notifications ne sont pas autorisées sur cet appareil."
    );
  }


  /* ---------------------------------------------------------
     SERVICE WORKER
     --------------------------------------------------------- */

  const registration =
    await navigator.serviceWorker.ready;


  /* ---------------------------------------------------------
     PUSH SUBSCRIPTION
     --------------------------------------------------------- */

  let subscription =
    await registration.pushManager
      .getSubscription();

  /*
   * Pas encore d'abonnement :
   * on le crée avec notre clé VAPID publique.
   */

  if (!subscription) {
    subscription =
      await registration.pushManager
        .subscribe({
          userVisibleOnly: true,

          applicationServerKey:
            urlBase64ToUint8Array(
              VAPID_PUBLIC_KEY
            ),
        });
  }


  /* ---------------------------------------------------------
     SERIALISATION
     --------------------------------------------------------- */

  const json =
    subscription.toJSON();

  const endpoint =
    json.endpoint ||
    subscription.endpoint;

  const p256dh =
    json.keys?.p256dh;

  const auth =
    json.keys?.auth;

  if (
    !endpoint ||
    !p256dh ||
    !auth
  ) {
    throw new Error(
      "L'abonnement Push reçu est incomplet."
    );
  }


  /* ---------------------------------------------------------
     DEVICE
     --------------------------------------------------------- */

  const deviceId =
    getDeviceId();


  /* ---------------------------------------------------------
     SUPABASE
     --------------------------------------------------------- */

  const {
    error,
  } = await supabaseClient.rpc(
    "register_push_subscription",
    {
      p_device_id:
        deviceId,

      p_owner_key:
        ownerKey,

      p_endpoint:
        endpoint,

      p_p256dh:
        p256dh,

      p_auth:
        auth,

      p_user_agent:
        navigator.userAgent,
    }
  );

  if (error) {
    console.error(
      "PUSH SUBSCRIPTION DATABASE ERROR:",
      error
    );

    throw new Error(
      error.message ||
      "Impossible d'enregistrer cet appareil."
    );
  }


  /* ---------------------------------------------------------
     LOCAL OWNER
     --------------------------------------------------------- */

  /*
   * On mémorise également qui utilise
   * cette installation de PROTOCOL.
   *
   * Ça nous permettra plus tard de savoir
   * directement quel partenaire notifier.
   */

  localStorage.setItem(
    "protocol-push-owner",
    ownerKey
  );


  /* ---------------------------------------------------------
     RESULT
     --------------------------------------------------------- */

  return {
    success: true,

    ownerKey,

    deviceId,

    endpoint,

    subscription,
  };
}


/* =========================================================
   LOCAL PUSH OWNER
   ========================================================= */

export function getPushOwner() {
  const owner =
    localStorage.getItem(
      "protocol-push-owner"
    );

  if (
    owner === "jerome" ||
    owner === "audrey"
  ) {
    return owner;
  }

  return null;
}


/* =========================================================
   DEVICE ID - PUBLIC HELPER
   ========================================================= */

export function getPushDeviceId() {
  try {
    return getDeviceId();
  } catch {
    return null;
  }
}