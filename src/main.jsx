import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App.jsx";
import ErrorBoundary from "./ErrorBoundary.jsx";
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

      window.location.reload();

    }
  );

}


ReactDOM.createRoot(
  document.getElementById("root")
).render(
  <React.StrictMode>
    <ErrorBoundary>
      <App />
    </ErrorBoundary>
    <OfflineBanner />
  </React.StrictMode>
);