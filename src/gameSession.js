import { supabase } from "./supabaseClient.js";

/* =========================================================
   GAME SESSION SECURITY
   ========================================================= */

const PROTOCOL_SESSION_KEY =
  "protocol-active-game";

export function saveGameSession(
  code,
  playerNumber,
  { singleDevice = false } = {}
) {
  const normalizedCode =
    String(code || "")
      .trim()
      .toUpperCase();

  const normalizedPlayerNumber =
    Number(playerNumber);

  if (
    !normalizedCode ||
    ![1, 2].includes(normalizedPlayerNumber)
  ) {
    throw new Error(
      "Session de partie invalide."
    );
  }

  const session = {
    code: normalizedCode,
    playerNumber: normalizedPlayerNumber,
    // partie sur un seul téléphone : ce téléphone joue pour les deux
    singleDevice: Boolean(singleDevice),
    savedAt: new Date().toISOString(),
  };

  localStorage.setItem(
    PROTOCOL_SESSION_KEY,
    JSON.stringify(session)
  );
}

export function getGameSession(code = null) {
  try {
    const raw =
      localStorage.getItem(
        PROTOCOL_SESSION_KEY
      );

    if (!raw) {
      return {
        code: null,
        playerNumber: null,
        valid: false,
      };
    }

    const session =
      JSON.parse(raw);

    const sessionCode =
      String(session?.code || "")
        .trim()
        .toUpperCase();

    const requestedCode =
      code
        ? String(code)
            .trim()
            .toUpperCase()
        : null;

    const playerNumber =
      Number(session?.playerNumber);

    const valid =
      Boolean(sessionCode) &&
      [1, 2].includes(playerNumber) &&
      (
        !requestedCode ||
        requestedCode === sessionCode
      );

    return {
      code: sessionCode,
      playerNumber,
      singleDevice:
        Boolean(session?.singleDevice),
      savedAt:
        session?.savedAt || null,
      valid,
    };

  } catch (error) {
    console.error(
      "GAME SESSION READ ERROR:",
      error
    );

    return {
      code: null,
      playerNumber: null,
      valid: false,
    };
  }
}

export function clearGameSession() {
  localStorage.removeItem(
    PROTOCOL_SESSION_KEY
  );
}

export async function saveProfileAsGameIdentity({
  code,
}) {
  if (!code) {
    throw new Error(
      "Session de partie incomplète."
    );
  }

  const { error } =
    await supabase.rpc(
      "save_protocol_identity",
      {
        p_game_code: code,
      }
    );

  if (error) {
    throw error;
  }
}

export const PROTOCOL_LAST_SEEN_CARD_KEY =
  "protocol-last-seen-card";

export function getLastSeenCard(code) {
  try {
    const raw =
      localStorage.getItem(
        PROTOCOL_LAST_SEEN_CARD_KEY
      );

    if (!raw) {
      return null;
    }

    const seen =
      JSON.parse(raw);

    const normalizedCode =
      String(code || "")
        .trim()
        .toUpperCase();

    if (
      seen?.code !== normalizedCode
    ) {
      return null;
    }

    return seen?.cardId ?? null;

  } catch (error) {
    console.error(
      "LAST SEEN CARD READ ERROR:",
      error
    );

    return null;
  }
}

export function saveLastSeenCard(
  code,
  cardId
) {
  if (!code || !cardId) {
    return;
  }

  localStorage.setItem(
    PROTOCOL_LAST_SEEN_CARD_KEY,
    JSON.stringify({
      code: String(code)
        .trim()
        .toUpperCase(),
      cardId: Number(cardId),
    })
  );
}
