// Version affichée de l'app, et mémoire « ouverture déjà vue » sur ce
// téléphone (l'ouverture de version ne se montre qu'une fois).

export const RELEASE = "2.0";

const SEEN_KEY = "protocol_release_seen";

export function hasSeenRelease() {
  try {
    return localStorage.getItem(SEEN_KEY) === RELEASE;
  } catch {
    return true;
  }
}

export function markReleaseSeen() {
  try {
    localStorage.setItem(SEEN_KEY, RELEASE);
  } catch {
    // stockage indisponible : l'ouverture reviendra, sans gravité
  }
}
