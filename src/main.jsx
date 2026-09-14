import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App.jsx";
import "./index.css";


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
    <App />
  </React.StrictMode>
);