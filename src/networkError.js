/* Coupure réseau (iPhone en 4G qui décroche, Wi-Fi qui saute) :
   un message humain plutôt que « TypeError: Failed to fetch », et
   rien n'est perdu : il suffit de réessayer quand le réseau revient.
   Chrome : « Failed to fetch », Safari : « Load failed »,
   Firefox : « NetworkError… ». */

export const NETWORK_MESSAGE =
  "Pas de réseau pour l’instant : rien n’est perdu, réessaie quand il revient.";

export function isNetworkError(err) {
  if (typeof navigator !== "undefined" && navigator.onLine === false) {
    return true;
  }

  const text = `${err?.message || ""} ${err?.details || ""}`;
  return /failed to fetch|load failed|networkerror|network request failed/i.test(text);
}

// message à afficher : réseau, sinon le message existant
export const humanError = (err, fallback) =>
  isNetworkError(err) ? NETWORK_MESSAGE : fallback;
