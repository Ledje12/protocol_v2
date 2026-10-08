import { useEffect, useState } from "react";

// Bandeau discret quand le téléphone perd le réseau : sans lui,
// une action qui n'aboutit pas ressemble à une app cassée.

export default function OfflineBanner() {
  const [offline, setOffline] = useState(
    () => typeof navigator !== "undefined" && navigator.onLine === false
  );

  useEffect(() => {
    const update = () => setOffline(navigator.onLine === false);

    window.addEventListener("online", update);
    window.addEventListener("offline", update);

    return () => {
      window.removeEventListener("online", update);
      window.removeEventListener("offline", update);
    };
  }, []);

  return (
    <div className="offline-banner" role="status" aria-live="polite">
      {offline && (
        <p className="offline-banner-pill">
          <span className="offline-banner-dot" aria-hidden="true" />
          Hors connexion · en attente du réseau
        </p>
      )}
    </div>
  );
}
