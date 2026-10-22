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

      // nouvelle version : on recharge derrière l'écran de chargement
      // de l'app, plutôt que de voir l'écran sauter
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

      window.setTimeout(() => window.location.reload(), 120);

    }
  );

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
