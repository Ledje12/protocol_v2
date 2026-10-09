import { useState } from "react";
import Footer from "./Footer.jsx";
import { saveGameSession, saveProfileAsGameIdentity } from "./gameSession.js";
import ScreenHeader from "./ScreenHeader.jsx";
import { supabase } from "./supabaseClient.js";

/* =========================================================
   JOIN
   ========================================================= */

export default function JoinScreen({ navigate, profile, }) {
  const [code, setCode] =
    useState("");

  const [loading, setLoading] =
    useState(false);

  const [error, setError] =
    useState("");

  const joinGame = async (event) => {
  event.preventDefault();

  if (code.length !== 6) {
    return;
  }

  try {
    setLoading(true);
    setError("");

    const normalized =
      code.toUpperCase();

    const {
      data,
      error: rpcError,
    } = await supabase.rpc(
      "join_protocol_game",
      {
        p_game_code: normalized,
      }
    );

    if (rpcError) {
      throw rpcError;
    }

    const joinedGame =
      Array.isArray(data)
        ? data[0]
        : data;

    if (
      !joinedGame?.code ||
      ![1, 2].includes(
        Number(joinedGame?.player_no)
      )
    ) {
      throw new Error(
        "Réponse de connexion invalide."
      );
    }

    saveGameSession(
      joinedGame.code,
      joinedGame.player_no
    );

    await saveProfileAsGameIdentity({
      code: joinedGame.code,
    });

    navigate(
      `/game/${joinedGame.code}`
    );

  } catch (err) {
    console.error(
      "JOIN ERROR:",
      err
    );

    setError(
      err?.message ||
        "Impossible de rejoindre."
    );

  } finally {
    setLoading(false);
  }
};

  return (
    <main className="app join-page">
      <div className="glow glow-top" />

      <ScreenHeader
        onBack={() => navigate("/")}
        subtitle="Nouvelle partie"
      />

      <section className="join">
        <div>
          <p className="kicker">
            REJOINDRE
          </p>

          <h1>
            Entre
            <br />
            le code.
          </h1>

          <p className="intro">
            Le code à six caractères est
            affiché sur le téléphone de
            ton partenaire.
          </p>
        </div>

        <form
          className="join-form"
          onSubmit={joinGame}
        >
          <input
            value={code}
            onChange={(event) => {
              setCode(
                event.target.value
                  .toUpperCase()
                  .replace(
                    /[^A-Z0-9]/g,
                    ""
                  )
                  .slice(0, 6)
              );

              setError("");
            }}
            placeholder="······"
            autoFocus
          />

          {error && (
            <p className="error">
              {error}
            </p>
          )}

          <button
            className="primary"
            disabled={
              code.length !== 6 ||
              loading
            }
          >
            <span>
              {loading
                ? "Connexion…"
                : "Entrer"}
            </span>

            <span>→</span>
          </button>
        </form>
      </section>

      <Footer />
    </main>
  );
}
