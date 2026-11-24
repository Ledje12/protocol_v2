import React, { Suspense } from "react";
import ReactDOM from "react-dom/client";
import App from "./App.jsx";
import { preloadScreens } from "./screens.js";
import ErrorBoundary from "./ErrorBoundary.jsx";
import { AppLoadingScreen } from "./LoadingScreen.jsx";
import { installErrorLog } from "./errorLog.js";
import OfflineBanner from "./OfflineBanner.jsx";
import "@fontsource-variable/bodoni-moda/opsz.css"; // sérif de l'app, hébergée avec elle
import "@fontsource-variable/bodoni-moda/opsz-italic.css";
import "./tokens.css"; // passe 2 : couleurs et polices (source unique)
import "./index.css";
import "./identity.css"; // passe 2 : identité visuelle, chargée en dernier
import "./dimLight.js"; // lumière tamisée appliquée dès le chargement
import { splashGone, splashUpdateChecked } from "./splash.js";


// erreurs de l'app notées dans Supabase (voir errorLog.js)
installErrorLog();


let refreshing = false;


if ("serviceWorker" in navigator) {

  navigator.serviceWorker.addEventListener(
    "controllerchange",
    () => {

      if (refreshing) {
        return;
      }

      refreshing = true;

      // le néon de la page rechargée sera déjà allumé
      try {
        sessionStorage.setItem("protocol_splash_lit", "1");
      } catch {
        // sans stockage : le néon se rallume, sans gravité
      }

      // pendant le néon d'ouverture : rechargement invisible ; plus
      // tard, on recharge derrière l'écran de chargement de l'app
      if (splashGone()) {
        const overlay = document.createElement("div");
        overlay.className =
          "protocol-auth-page protocol-loading-page protocol-update-overlay";
        overlay.innerHTML =
          '<div class="protocol-auth-glow"></div>' +
          '<section class="protocol-loading">' +
          '<span class="protocol-diamond protocol-loading-diamond" aria-hidden="true"></span>' +
          "<p>Mise à jour…</p>" +
          "</section>";
        document.body.appendChild(overlay);
      }

      window.setTimeout(() => window.location.reload(), 60);

    }
  );

  /* À l'ouverture, on vérifie s'il existe une version plus récente
     pendant que le néon est affiché : si oui, elle s'installe et la
     page se recharge derrière lui. Plus d'ancienne version entrevue
     avant la nouvelle. 3,5 s au plus. */
  const checkForUpdate = async () => {
    const registration =
      await navigator.serviceWorker.getRegistration();

    if (!registration) {
      return;
    }

    await registration.update();

    const incoming =
      registration.installing || registration.waiting;

    if (incoming) {
      await new Promise((resolve) => {
        incoming.addEventListener("statechange", () => {
          if (incoming.state === "activated" || incoming.state === "redundant") {
            resolve();
          }
        });
        window.setTimeout(resolve, 3000);
      });
    }
  };

  Promise.race([
    checkForUpdate().catch(() => {}),
    new Promise((resolve) => window.setTimeout(resolve, 3500)),
  ]).finally(splashUpdateChecked);

} else {
  splashUpdateChecked();
}


ReactDOM.createRoot(
  document.getElementById("root")
).render(
  <React.StrictMode>
    <ErrorBoundary>
      <Suspense fallback={<AppLoadingScreen />}>
        <App />
      </Suspense>
    </ErrorBoundary>
    <OfflineBanner />
  </React.StrictMode>
);

preloadScreens();
