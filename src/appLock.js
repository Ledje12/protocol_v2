/* Verrou de l'app : Face ID (ou empreinte) à l'ouverture.

   Le téléphone garde une clé d'accès « Verrou Protocol » ; la
   déverrouiller demande Face ID. Tout reste sur ce téléphone :
   rien n'est envoyé au serveur, c'est une barrière contre un
   téléphone prêté ou laissé ouvert, pas un chiffrement. */

const STORAGE_KEY = "protocol-app-lock";

// au-delà, l'app se reverrouille au retour
export const RELOCK_AFTER_MS = 5 * 60 * 1000;

const read = () => {
  try {
    return JSON.parse(localStorage.getItem(STORAGE_KEY) || "null");
  } catch {
    return null;
  }
};

const toBase64 = (buffer) =>
  btoa(String.fromCharCode(...new Uint8Array(buffer)));

const fromBase64 = (text) =>
  Uint8Array.from(atob(text), (char) => char.charCodeAt(0));

const randomBytes = (size) =>
  crypto.getRandomValues(new Uint8Array(size));

export async function isAppLockSupported() {
  try {
    return Boolean(
      window.PublicKeyCredential &&
        (await window.PublicKeyCredential.isUserVerifyingPlatformAuthenticatorAvailable())
    );
  } catch {
    return false;
  }
}

export function isAppLockEnabled(userId) {
  const saved = read();
  return Boolean(userId && saved?.userId === userId && saved.credentialId);
}

// déverrouillé pour cette ouverture de l'app (mémoire seulement :
// chaque lancement redemande Face ID)
let unlockedUserId = null;

export const isAppLocked = (userId) =>
  isAppLockEnabled(userId) && unlockedUserId !== userId;

export const markAppUnlocked = (userId) => {
  unlockedUserId = userId;
};

export const relockApp = () => {
  unlockedUserId = null;
};

// crée la clé d'accès (Face ID demandé une première fois)
export async function enableAppLock(userId) {
  const credential = await navigator.credentials.create({
    publicKey: {
      challenge: randomBytes(32),
      rp: { name: "Protocol", id: window.location.hostname },
      user: {
        id: randomBytes(16),
        name: "Verrou Protocol",
        displayName: "Verrou Protocol",
      },
      pubKeyCredParams: [
        { type: "public-key", alg: -7 },
        { type: "public-key", alg: -257 },
      ],
      authenticatorSelection: {
        authenticatorAttachment: "platform",
        userVerification: "required",
        residentKey: "discouraged",
      },
      timeout: 60000,
    },
  });

  if (!credential) {
    throw new Error("No credential");
  }

  localStorage.setItem(
    STORAGE_KEY,
    JSON.stringify({ userId, credentialId: toBase64(credential.rawId) })
  );

  // on vient de passer Face ID : pas de verrouillage immédiat
  markAppUnlocked(userId);
}

export function disableAppLock() {
  try {
    localStorage.removeItem(STORAGE_KEY);
  } catch {
    // stockage indisponible : rien à retirer
  }
}

// demande Face ID ; true si c'est bien la personne du téléphone
export async function unlockApp() {
  const saved = read();

  if (!saved?.credentialId) {
    return true;
  }

  const assertion = await navigator.credentials.get({
    publicKey: {
      challenge: randomBytes(32),
      rpId: window.location.hostname,
      allowCredentials: [
        { type: "public-key", id: fromBase64(saved.credentialId) },
      ],
      userVerification: "required",
      timeout: 60000,
    },
  });

  return Boolean(assertion);
}
