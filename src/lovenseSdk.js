/* SDK Lovense (Basic SDK) : chargé seulement quand on relie les
   jouets depuis les réglages, jamais au démarrage de l'app. Un
   script tiers n'a rien à faire sur les autres écrans. */

const SDK_URL = "https://api.lovense-api.com/basic-sdk/core.min.js";

let loading = null;

export function loadLovenseSdk() {
  if (window.LovenseBasicSdk) {
    return Promise.resolve(window.LovenseBasicSdk);
  }

  if (!loading) {
    loading = new Promise((resolve, reject) => {
      const script = document.createElement("script");
      script.src = SDK_URL;
      script.async = true;
      script.onload = () =>
        window.LovenseBasicSdk
          ? resolve(window.LovenseBasicSdk)
          : reject(new Error("Le SDK Lovense n’est pas chargé."));
      script.onerror = () => {
        script.remove();
        reject(new Error("Le SDK Lovense ne se charge pas. Vérifie ta connexion."));
      };
      document.head.appendChild(script);
    }).catch((error) => {
      // un nouvel essai doit pouvoir recharger le script
      loading = null;
      throw error;
    });
  }

  return loading;
}
