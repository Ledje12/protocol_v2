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
import { splashGone, splashHold, splashUpdateChecked } from "./splash.js";


// erreurs de l'app notées dans Supabase (voir errorLog.js)
installErrorLog();


let refreshing = false;


/* Une nouvelle version est prête pendant qu'on joue : on ne recharge
   pas sous les yeux des joueurs. Elle s'applique quand l'app passe en
   arrière-plan (écran caché), ou au retour après une longue absence. */
let pendingReload = false;
let hiddenAt = 0;

const LONG_ABSENCE = 10 * 60 * 1000;

// un texte en cours d'écriture, ou le retour attendu de Lovense
// Remote (Réglages) : on ne recharge pas en arrière-plan
const busyElsewhere = () =>
  window.location.pathname.startsWith("/settings") ||
  [...document.querySelectorAll("textarea, input[type=text]")].some(
    (field) => field.value.trim() !== ""
  );

const reloadNow = (withLitSign) => {
  if (refreshing) {
    return;
  }

  refreshing = true;

  if (withLitSign) {
    // le néon de la page rechargée sera déjà allumé
    splashHold();
    try {
      sessionStorage.setItem("protocol_splash_lit", "1");
    } catch {
      // sans stockage : le néon se rallume, sans gravité
    }
  }

  window.setTimeout(() => window.location.reload(), 60);
};


if ("serviceWorker" in navigator) {

  // toute première visite : le service worker prend la main sur une
  // page déjà à jour, inutile de la recharger
  let hadController = Boolean(navigator.serviceWorker.controller);

  navigator.serviceWorker.addEventListener(
    "controllerchange",
    () => {

      if (!hadController) {
        hadController = true;
        return;
      }

      // pendant le néon d'ouverture : rechargement derrière l'enseigne
      if (!splashGone()) {
        reloadNow(true);
        return;
      }

      if (document.visibilityState === "hidden" && !busyElsewhere()) {
        reloadNow(false);
        return;
      }

      pendingReload = true;

    }
  );

  // au retour dans l'app (iOS la garde ouverte des jours) : on regarde
  // s'il existe une version plus récente, sans rien montrer
  let lastCheck = Date.now();

  document.addEventListener("visibilitychange", () => {

    if (document.visibilityState === "hidden") {
      hiddenAt = Date.now();

      if (pendingReload && !busyElsewhere()) {
        reloadNow(false);
      }

      return;
    }

    if (pendingReload && hiddenAt && Date.now() - hiddenAt > LONG_ABSENCE) {
      reloadNow(false);
      return;
    }

    if (Date.now() - lastCheck > 5 * 60 * 1000) {
      lastCheck = Date.now();
      navigator.serviceWorker
        .getRegistration()
        .then((registration) => registration?.update())
        .catch(() => {});
    }

  });

  /* À l'ouverture, on vérifie s'il existe une version plus récente
     pendant que l'enseigne grésille : si oui, elle s'installe et la
     page se recharge derrière elle. « ENTRER » n'apparaît qu'ensuite :
     plus d'ancienne version entrevue avant la nouvelle. 9 s au plus. */
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
        window.setTimeout(resolve, 8000);
      });
    }
  };

  Promise.race([
    checkForUpdate().catch(() => {}),
    new Promise((resolve) => window.setTimeout(resolve, 9000)),
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
