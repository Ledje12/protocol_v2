import { lazy, useEffect, useRef, useState } from "react";
// tous les styles restent chargés au démarrage, dans cet ordre
// (les écrans, eux, arrivent à la demande : voir plus bas)
import "./notifications.css";
import "./home-dashboard.css";
import "./library.css";
import "./card.css";
import "./invitations.css";
import "./messages.css";
import "./recaps.css";
import AuthScreen from "./AuthScreen.jsx";
import BrandMark from "./BrandMark.jsx";
import HomeScreen from "./HomeScreen.jsx";
import { AppLoadingScreen } from "./LoadingScreen.jsx";
import { getRoute } from "./routes.js";
import { SCREENS } from "./screens.js";
import { supabase } from "./supabaseClient.js";

const LibraryScreen = lazy(SCREENS.LibraryScreen);
const CardScreen = lazy(SCREENS.CardScreen);
const InvitationsScreen = lazy(SCREENS.InvitationsScreen);
const MessagesScreen = lazy(SCREENS.MessagesScreen);
const CalibrationScreen = lazy(SCREENS.CalibrationScreen);
const CustomLibraryScreen = lazy(SCREENS.CustomLibraryScreen);
const JoinScreen = lazy(SCREENS.JoinScreen);
const LobbyScreen = lazy(SCREENS.LobbyScreen);
const PlayScreen = lazy(SCREENS.PlayScreen);
const PrivacyScreen = lazy(SCREENS.PrivacyScreen);
const ProfileSetupScreen = lazy(SCREENS.ProfileSetupScreen);
const RecapsScreen = lazy(SCREENS.RecapsScreen);
const SettingsScreen = lazy(SCREENS.SettingsScreen);

/* Profil et couple gardés sur le téléphone : à l'ouverture,
   l'accueil s'affiche tout de suite avec eux, puis ils sont
   actualisés en silence. Effacés à la déconnexion. */
const BOOT_CACHE_KEY = "protocol-boot-cache";

function readBootCache(userId) {
  try {
    const cache = JSON.parse(localStorage.getItem(BOOT_CACHE_KEY) || "null");
    return cache?.userId === userId && cache.profile && cache.couple
      ? cache
      : null;
  } catch {
    return null;
  }
}

function writeBootCache(userId, patch) {
  try {
    const current = JSON.parse(localStorage.getItem(BOOT_CACHE_KEY) || "null");
    const base = current?.userId === userId ? current : { userId };
    localStorage.setItem(BOOT_CACHE_KEY, JSON.stringify({ ...base, ...patch }));
  } catch {
    // stockage indisponible : chargement normal à la prochaine ouverture
  }
}

function clearBootCache() {
  try {
    localStorage.removeItem(BOOT_CACHE_KEY);
  } catch {
    // rien à effacer
  }
}

/* =========================================================
   APP
   ========================================================= */

function App() {
  const [authSession, setAuthSession] =
    useState(null);

  const [authLoading, setAuthLoading] =
    useState(true);

  const [profile, setProfile] =
    useState(null);

  const [profileLoading, setProfileLoading] =
    useState(true);

  // compte pour lequel profil et couple ont été chargés : tant
  // qu'ils ne correspondent pas à la session, on reste sur le
  // chargement (sinon « Qui joue ? » clignotait à l'ouverture)
  const [profileUserId, setProfileUserId] =
    useState(undefined);

  const [coupleUserId, setCoupleUserId] =
    useState(undefined);

  const [profileError, setProfileError] =
    useState("");

  const [couple, setCouple] =
    useState(null);

  const [coupleLoading, setCoupleLoading] =
    useState(true);

  const [coupleError, setCoupleError] =
    useState("");

  const [
    coupleRefreshKey,
    setCoupleRefreshKey,
  ] = useState(0);

  // le couple a déjà été chargé une fois (actualisations silencieuses)
  const coupleLoadedRef =
    useRef(false);

  // compte dont le profil est déjà à l'écran (actualisation silencieuse)
  const profileShownRef =
    useRef(null);

  useEffect(() => {
    let active = true;

    /* À l'ouverture, une connexion expirée est d'abord vue comme
       « absente » le temps de la renouveler : l'écran de connexion
       clignotait. On attend donc le verdict de Supabase
       (INITIAL_SESSION, après renouvellement) ; getSession ne sert
       qu'à afficher plus vite une connexion valide, et un délai de
       secours évite de rester bloqué sur le chargement. */
    supabase.auth
      .getSession()
      .then(({ data }) => {
        if (active && data?.session) {
          setAuthSession(data.session);
          setAuthLoading(false);
        }
      });

    const fallback =
      window.setTimeout(() => {
        if (active) {
          setAuthLoading(false);
        }
      }, 6000);

    const {
      data: authListener,
    } =
      supabase.auth.onAuthStateChange(
        (_event, session) => {

          setAuthSession(
            session ?? null
          );

          if (!session) {
            clearBootCache();
            setProfile(null);
            setProfileLoading(false);
          }

          setAuthLoading(false);
        }
      );

    return () => {
      active = false;
      window.clearTimeout(fallback);

      authListener?.subscription?.unsubscribe();
    };
  }, []);

  useEffect(() => {
    let active = true;

    const loadProfile =
      async () => {

        if (!authSession?.user?.id) {
          profileShownRef.current = null;

          if (active) {
            setProfile(null);
            setProfileLoading(false);
          }

          return;
        }

        const userId = authSession.user.id;
        const cached = readBootCache(userId);

        // ouverture : l'accueil s'affiche avec le profil gardé
        if (cached && profileShownRef.current !== userId) {
          profileShownRef.current = userId;
          setProfile(cached.profile);
          setProfileUserId(userId);
          setProfileLoading(false);
        }

        const silent = profileShownRef.current === userId;

        try {
          if (!silent) {
            setProfileLoading(true);
          }

          setProfileError("");

          const {
            data,
            error,
          } =
            await supabase
              .from("protocol_profiles")
              .select(
                "user_id, display_name, sex"
              )
              .eq(
                "user_id",
                authSession.user.id
              )
              .maybeSingle();

          if (error) {
            throw error;
          }

          if (active) {
            setProfile(
              data ?? null
            );

            if (data) {
              writeBootCache(userId, { profile: data });
            }
          }

        } catch (err) {
          console.error(
            "PROFILE LOAD ERROR:",
            err
          );

          // déjà affiché depuis le téléphone (hors connexion…) :
          // on garde l'accueil plutôt qu'un écran d'erreur
          if (active && !silent) {
            setProfileError(
              "Impossible de charger ton profil."
            );
          }

        } finally {
          if (active) {
            profileShownRef.current = userId;
            setProfileUserId(userId);
            setProfileLoading(false);
          }
        }
      };

    loadProfile();

    return () => {
      active = false;
    };

  }, [authSession?.user?.id]);

  useEffect(() => {
    let active = true;

    const loadCouple =
      async () => {

        if (!authSession?.user?.id) {
          coupleLoadedRef.current = false;

          if (active) {
            setCouple(null);
            setCoupleLoading(false);
          }

          return;
        }

        const userId = authSession.user.id;
        const cached = readBootCache(userId);

        // ouverture : l'accueil s'affiche avec le couple gardé
        if (cached && !coupleLoadedRef.current) {
          coupleLoadedRef.current = true;
          setCouple(cached.couple);
          setCoupleUserId(userId);
          setCoupleLoading(false);
        }

        const silent = coupleLoadedRef.current;

        try {
          // actualisation (ex. ouverture des réglages) : en silence,
          // sans repasser par l'écran de chargement
          if (!silent) {
            setCoupleLoading(true);
          }

          setCoupleError("");

          const {
            data,
            error,
          } =
            await supabase.rpc(
              "get_protocol_couple"
            );

          if (error) {
            throw error;
          }

          if (active) {
            coupleLoadedRef.current = true;
            setCouple(
              data ?? null
            );

            if (data) {
              writeBootCache(userId, { couple: data });
            }
          }

        } catch (err) {
          console.error(
            "COUPLE LOAD ERROR:",
            err
          );

          if (active && !silent) {
            setCoupleError(
              "Impossible de charger les données du couple."
            );
          }

        } finally {
          if (active) {
            setCoupleUserId(userId);
            setCoupleLoading(false);
          }
        }
      };

    loadCouple();

    return () => {
      active = false;
    };

  }, [
    authSession?.user?.id,
    coupleRefreshKey,
  ]);

  const [route, setRoute] =
    useState(getRoute());

  const navigate = (
    path,
    replace = false
  ) => {
    if (replace) {
      window.history.replaceState(
        {},
        "",
        path
      );
    } else {
      window.history.pushState(
        {},
        "",
        path
      );
    }

    setRoute(getRoute());
  };

  useEffect(() => {
    if (route.screen === "settings") {
      setCoupleRefreshKey(
        (value) => value + 1
      );
    }
  }, [route.screen]);

  useEffect(() => {
    const handlePopState = () => {
      setRoute(getRoute());
    };

    window.addEventListener(
      "popstate",
      handlePopState
    );

    return () => {
      window.removeEventListener(
        "popstate",
        handlePopState
      );
    };
  }, []);

  useEffect(() => {

    /*
    * PRIVACY SCREEN
    *
    * Masque le contenu PROTOCOL lorsque
    * l'app passe en arrière-plan.
    */

    const existing =
      document.getElementById(
        "protocol-privacy-screen"
      );

    if (existing) {
      existing.remove();
    }


    const privacyScreen =
      document.createElement("div");

    privacyScreen.id =
      "protocol-privacy-screen";

    privacyScreen.setAttribute(
      "aria-hidden",
      "true"
    );


    privacyScreen.innerHTML = `
      <div class="protocol-privacy-content">

        <div class="protocol-brand protocol-brand-lg">
          <span class="protocol-brand-name">PROTOCOL</span>
        </div>

        <div class="protocol-privacy-symbol" aria-hidden="true">
          <span class="protocol-diamond"></span>
        </div>

        <p>
          Privé · Discret · À deux
        </p>

      </div>
    `;


    document.body.appendChild(
      privacyScreen
    );


    const showPrivacyScreen = () => {

      privacyScreen.classList.add(
        "is-visible"
      );

    };


    const hidePrivacyScreen = () => {

      privacyScreen.classList.remove(
        "is-visible"
      );

    };


    const handleVisibilityChange = () => {

      if (
        document.visibilityState ===
        "hidden"
      ) {

        showPrivacyScreen();

      } else {

        hidePrivacyScreen();

      }

    };


    const handlePageHide = () => {

      showPrivacyScreen();

    };


    const handlePageShow = () => {

      if (
        document.visibilityState ===
        "visible"
      ) {

        hidePrivacyScreen();

      }

    };


    document.addEventListener(
      "visibilitychange",
      handleVisibilityChange
    );

    window.addEventListener(
      "pagehide",
      handlePageHide
    );

    window.addEventListener(
      "pageshow",
      handlePageShow
    );


    /*
    * Etat initial.
    */

    handleVisibilityChange();


    return () => {

      document.removeEventListener(
        "visibilitychange",
        handleVisibilityChange
      );

      window.removeEventListener(
        "pagehide",
        handlePageHide
      );

      window.removeEventListener(
        "pageshow",
        handlePageShow
      );

      privacyScreen.remove();

    };

  }, []);

  if (authLoading) {
    return <AppLoadingScreen />;
  }

  if (route.screen === "privacy") {
    return (
      <PrivacyScreen
        navigate={navigate}
      />
    );
  }

  if (!authSession) {
    return (
      <AuthScreen
        onAuthenticated={
          setAuthSession
        }
      />
    );
  }

  if (
    profileLoading ||
    profileUserId !== authSession.user.id
  ) {
    return <AppLoadingScreen />;
  }

  if (
    coupleLoading ||
    coupleUserId !== authSession.user.id
  ) {
    return <AppLoadingScreen />;
  }

  if (profileError || coupleError) {
    return (
      <main className="protocol-auth-page">
        <div className="protocol-auth-glow" />

        <section className="protocol-auth-shell">

          <header className="protocol-auth-brand">

            <BrandMark size="lg" />

            <p>

              Privé · Discret · À deux

            </p>

          </header>

          <section className="protocol-auth-card">

            <div className="protocol-auth-copy">

              <span className="protocol-auth-eyebrow">
                CONNEXION
              </span>

              <h1>
                Petit problème.
              </h1>

              <p>
                Impossible de charger ton espace.
                Vérifie ta connexion puis réessaie.
              </p>

            </div>

            <button
              type="button"
              className="protocol-auth-retry"
              onClick={() =>
                window.location.reload()
              }
            >
              Réessayer
            </button>

          </section>

        </section>
      </main>
    );
  }
  
  if (
    !profile?.display_name ||
    !profile?.sex
  ) {
    return (
      <ProfileSetupScreen
        user={authSession.user}
        onProfileReady={
          setProfile
        }
      />
    );
  }

  if (route.screen === "settings") {
    return (
      <SettingsScreen
        navigate={navigate}
        couple={couple}
        onCoupleChanged={() =>
          setCoupleRefreshKey(
            (value) => value + 1
          )
        }
      />
    );
  }

  if (route.screen === "recaps") {
    return (
      <RecapsScreen
        supabase={supabase}
        onBack={() => navigate("/settings")}
      />
    );
  }

  if (route.screen === "custom-library") {
    return (
      <CustomLibraryScreen
        supabase={supabase}
        profile={profile}
        couple={couple}
        onBack={() =>
          navigate("/settings")
        }
      />
    );
  }

  if (
    route.screen ===
    "messages"
  ) {
    return (
      <MessagesScreen
        supabase={
          supabase
        }

        profile={
          profile
        }

        couple={
          couple
        }

        onBack={() =>
          navigate("/")
        }
      />
    );
  }

  if (route.screen === "invitations") {

    return (
      <InvitationsScreen
        supabase={
          supabase
        }

        profile={
          profile
        }

        couple={
          couple
        }

        onBack={() =>
          navigate("/")
        }

        onOpenCard={({
          cardId,
          invitationId,
        }) => {

          navigate(
            `/card/${cardId}?invite=${invitationId}&from=invitations`
          );

        }}

        onOpenPath={(path) =>
          navigate(path)
        }
      />
    );
  }

  if (
    route.screen ===
    "library"
  ) {

    return (
      <LibraryScreen
        supabase={
          supabase
        }

        profile={
          profile
        }

        couple={
          couple
        }

        onBack={() =>
          navigate("/")
        }

        onOpenCard={({
          cardId,
          cardSource,
        }) => {

          const params =
            new URLSearchParams();


          if (
            cardSource ===
              "custom"
          ) {
            params.set(
              "source",
              "custom"
            );
          }


          if (
            route.challengeId
          ) {
            params.set(
              "challenge",
              route.challengeId
            );
          }


          const query =
            params.toString()
              ? `?${params.toString()}`
              : "";


          navigate(
            `/card/${cardId}${query}`
          );

        }}
      />
    );
  }

  if (
    route.screen ===
    "card"
  ) {

    return (
      <CardScreen
        supabase={
          supabase
        }

        cardId={
          route.cardId
        }

        profile={
          profile
        }

        couple={
          couple
        }

        cardSource={
          route.cardSource
        }

        invitationId={
          route.invitationId
        }

        challengeId={
          route.challengeId
        }

        onBack={() =>
          navigate(
            route.from ===
              "invitations"
              ? "/invitations"
              : route.challengeId
                ? `/library?challenge=${route.challengeId}`
                : "/library"
          )
        }
      />
    );
  }

  if (route.screen === "join") {
    return (
      <JoinScreen
        navigate={navigate}
      />
    );
  }

  if (route.screen === "lobby") {
    return (
      <LobbyScreen
        code={route.code}
        navigate={navigate}
      />
    );
  }

  if (
    route.screen ===
    "calibration"
  ) {
    return (
      <CalibrationScreen
        code={route.code}
        navigate={navigate}
      />
    );
  }

  if (route.screen === "play") {
    return (
      <PlayScreen
        code={route.code}
        navigate={navigate}
      />
    );
  }

  return (
    <HomeScreen
      navigate={navigate}
      profile={profile}
      hasPartner={Boolean(couple?.partner)}
      onPaired={() =>
        setCoupleRefreshKey(
          (value) => value + 1
        )
      }
    />
  );
}

export default App;
