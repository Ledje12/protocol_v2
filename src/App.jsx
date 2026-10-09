import { useEffect, useState } from "react";
import "./notifications.css";
import "./home-dashboard.css";
import LibraryScreen from "./LibraryScreen.jsx";
import CardScreen from "./CardScreen.jsx";
import InvitationsScreen from "./InvitationsScreen.jsx";
import MessagesScreen from "./MessagesScreen.jsx";
import AuthScreen from "./AuthScreen.jsx";
import BrandMark from "./BrandMark.jsx";
import CalibrationScreen from "./CalibrationScreen.jsx";
import CustomLibraryScreen from "./CustomLibraryScreen.jsx";
import HomeScreen from "./HomeScreen.jsx";
import JoinScreen from "./JoinScreen.jsx";
import { AppLoadingScreen } from "./LoadingScreen.jsx";
import LobbyScreen from "./LobbyScreen.jsx";
import PlayScreen from "./PlayScreen.jsx";
import PrivacyScreen from "./PrivacyScreen.jsx";
import ProfileSetupScreen from "./ProfileSetupScreen.jsx";
import { getRoute } from "./routes.js";
import SettingsScreen from "./SettingsScreen.jsx";
import { supabase } from "./supabaseClient.js";

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

  useEffect(() => {
    let active = true;

    supabase.auth
      .getSession()
      .then(({ data }) => {
        if (!active) {
          return;
        }

        setAuthSession(
          data?.session ?? null
        );

        setAuthLoading(false);
      });

    const {
      data: authListener,
    } =
      supabase.auth.onAuthStateChange(
        (_event, session) => {

          setAuthSession(
            session ?? null
          );

          if (!session) {
            setProfile(null);
            setProfileLoading(false);
          }

          setAuthLoading(false);
        }
      );

    return () => {
      active = false;

      authListener?.subscription?.unsubscribe();
    };
  }, []);

  useEffect(() => {
    let active = true;

    const loadProfile =
      async () => {

        if (!authSession?.user?.id) {
          if (active) {
            setProfile(null);
            setProfileLoading(false);
          }

          return;
        }

        try {
          setProfileLoading(true);
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
          }

        } catch (err) {
          console.error(
            "PROFILE LOAD ERROR:",
            err
          );

          if (active) {
            setProfileError(
              "Impossible de charger ton profil."
            );
          }

        } finally {
          if (active) {
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
          if (active) {
            setCouple(null);
            setCoupleLoading(false);
          }

          return;
        }

        try {
          setCoupleLoading(true);
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
            setCouple(
              data ?? null
            );
          }

        } catch (err) {
          console.error(
            "COUPLE LOAD ERROR:",
            err
          );

          if (active) {
            setCoupleError(
              "Impossible de charger les données du couple."
            );
          }

        } finally {
          if (active) {
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

  if (profileLoading) {
    return <AppLoadingScreen />;
  }

  if (coupleLoading) {
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
        profile={profile}
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
