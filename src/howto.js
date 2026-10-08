// mémorise sur cet appareil que « Comment on joue » a été vu

const SEEN_KEY = "protocol_howto_seen";

export function hasSeenHowToPlay() {
  try {
    return localStorage.getItem(SEEN_KEY) === "1";
  } catch {
    return true;
  }
}

export function markHowToPlaySeen() {
  try {
    localStorage.setItem(SEEN_KEY, "1");
  } catch {
    // stockage indisponible : l'écran reviendra, sans gravité
  }
}
