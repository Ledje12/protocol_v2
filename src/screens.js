/* Écrans chargés à la demande : l'accueil s'ouvre sans attendre
   le reste, qui se précharge ensuite en arrière-plan. */
/* Après une mise à jour, un écran de l'ancienne version peut ne
   plus exister sur le serveur : on recharge alors l'app une fois
   (vers la nouvelle version) au lieu d'afficher une erreur. */
const RELOAD_KEY = "protocol-chunk-reload";

const load = (importer) => () =>
  importer().then(
    (module) => {
      try {
        sessionStorage.removeItem(RELOAD_KEY);
      } catch {
        // sans stockage : rien à oublier
      }
      return module;
    },
    (err) => {
      let reloaded = true;

      try {
        reloaded = sessionStorage.getItem(RELOAD_KEY) === "1";
        sessionStorage.setItem(RELOAD_KEY, "1");
      } catch {
        // sans stockage : pas de rechargement en boucle possible
      }

      if (reloaded) {
        throw err;
      }

      window.location.reload();
      return new Promise(() => {});
    }
  );

const IMPORTERS = {
  LibraryScreen: () => import("./LibraryScreen.jsx"),
  CardScreen: () => import("./CardScreen.jsx"),
  InvitationsScreen: () => import("./InvitationsScreen.jsx"),
  MessagesScreen: () => import("./MessagesScreen.jsx"),
  CalibrationScreen: () => import("./CalibrationScreen.jsx"),
  CustomLibraryScreen: () => import("./CustomLibraryScreen.jsx"),
  JoinScreen: () => import("./JoinScreen.jsx"),
  LobbyScreen: () => import("./LobbyScreen.jsx"),
  PlayScreen: () => import("./PlayScreen.jsx"),
  PrivacyScreen: () => import("./PrivacyScreen.jsx"),
  ProfileSetupScreen: () => import("./ProfileSetupScreen.jsx"),
  RecapsScreen: () => import("./Recaps.jsx"),
  SettingsScreen: () => import("./SettingsScreen.jsx"),
};

export const SCREENS = Object.fromEntries(
  Object.entries(IMPORTERS).map(([name, importer]) => [name, load(importer)])
);

// une fois l'app affichée, on précharge les autres écrans
export function preloadScreens() {
  const run = () =>
    // (sans rechargement en cas d'échec : l'écran réessaiera à l'ouverture)
    Object.values(IMPORTERS).forEach((importer) => importer().catch(() => {}));

  if ("requestIdleCallback" in window) {
    window.requestIdleCallback(run, { timeout: 3000 });
  } else {
    window.setTimeout(run, 1500);
  }
}
