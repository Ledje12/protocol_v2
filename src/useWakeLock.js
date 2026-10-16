import { useEffect } from "react";

/* Écran allumé pendant la partie : l'iPhone ne se met pas en veille
   au milieu d'une carte ou d'un chrono. Rendu au système dès que la
   partie s'arrête, se termine ou que l'app passe en arrière-plan
   (et redemandé au retour). Sans prise en charge : rien ne change. */
export default function useWakeLock(active) {
  useEffect(() => {
    if (!active || !("wakeLock" in navigator)) {
      return undefined;
    }

    let lock = null;
    let cancelled = false;

    const request = async () => {
      if (document.visibilityState !== "visible" || lock) {
        return;
      }

      try {
        lock = await navigator.wakeLock.request("screen");
        lock.addEventListener("release", () => {
          lock = null;
        });

        if (cancelled) {
          lock.release().catch(() => {});
        }
      } catch {
        // refusé (économie d'énergie…) : la veille reste normale
      }
    };

    request();
    document.addEventListener("visibilitychange", request);

    return () => {
      cancelled = true;
      document.removeEventListener("visibilitychange", request);
      lock?.release().catch(() => {});
    };
  }, [active]);
}
