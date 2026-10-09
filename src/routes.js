export function getRoute() {
  const path =
    window.location.pathname;

  if (path === "/") {
    return {
      screen: "home",
      code: null,
    };
  }

  if (path === "/settings") {
    return {
      screen: "settings",
      code: null,
    };
  }

  if (path === "/settings/custom-library") {
    return {
      screen: "custom-library",
      code: null,
    };
  }

  if (path === "/privacy") {
    return {
      screen: "privacy",
      code: null,
    };
  }

  if (path === "/library") {

    const params =
      new URLSearchParams(
        window.location.search
      );

    const challengeId =
      params.get("challenge");

    return {
      screen: "library",
      code: null,
      challengeId,
    };
  }

  if (path === "/messages") {
    return {
      screen:
        "messages",
      code:
        null,
    };
  }

  if (path === "/invitations") {
    return {
      screen: "invitations",
      code: null,
    };
  }

  if (path === "/join") {
    return {
      screen: "join",
      code: null,
    };
  }

  const cardMatch =
    path.match(
      /^\/card\/(\d+)\/?$/
    );

  if (cardMatch) {
    const params =
      new URLSearchParams(
        window.location.search
      );

    const invitationId =
      params.get("invite");

    const from =
      params.get("from");

    const challengeId =
      params.get("challenge");

    const cardSource =
      params.get("source") ===
        "custom"
        ? "custom"
        : "official";

    return {
      screen: "card",

      cardId: Number(
        cardMatch[1]
      ),

      invitationId,

      from,

      challengeId,

      cardSource,
    };
  }

  /*
   * IMPORTANT :
   * les routes les plus spécifiques
   * passent AVANT /game/:code.
   */

  const calibrationMatch =
    path.match(
      /^\/game\/([^/]+)\/calibration\/?$/
    );

  if (calibrationMatch) {
    return {
      screen: "calibration",
      code:
        calibrationMatch[1].toUpperCase(),
    };
  }

  const playMatch =
    path.match(
      /^\/game\/([^/]+)\/play\/?$/
    );

  if (playMatch) {
    return {
      screen: "play",
      code:
        playMatch[1].toUpperCase(),
    };
  }

  const gameMatch =
    path.match(
      /^\/game\/([^/]+)\/?$/
    );

  if (gameMatch) {
    return {
      screen: "lobby",
      code:
        gameMatch[1].toUpperCase(),
    };
  }

  console.warn(
    "Route inconnue:",
    path
  );

  return {
    screen: "home",
    code: null,
  };
}
