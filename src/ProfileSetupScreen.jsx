import { useState } from "react";
import BrandMark from "./BrandMark.jsx";
import { supabase } from "./supabaseClient.js";

export default function ProfileSetupScreen({
  user,
  onProfileReady,
}) {
  const [displayName, setDisplayName] =
    useState("");

  const [sex, setSex] =
    useState("");

  const [loading, setLoading] =
    useState(false);

  const [message, setMessage] =
    useState("");

  const saveProfile =
    async (event) => {
      event.preventDefault();

      const cleanName =
        displayName.trim();

      if (!cleanName || !sex) {
        return;
      }

      try {
        setLoading(true);
        setMessage("");

        const {
          data,
          error,
        } =
          await supabase
            .from("protocol_profiles")
            .upsert(
              {
                user_id: user.id,
                display_name: cleanName,
                sex,
                updated_at:
                  new Date().toISOString(),
              },
              {
                onConflict: "user_id",
              }
            )
            .select(
              "user_id, display_name, sex"
            )
            .single();

        if (error) {
          throw error;
        }

        onProfileReady(data);

      } catch (err) {
        console.error(
          "PROFILE SAVE ERROR:",
          err
        );

        setMessage(
          err?.message ||
          "Impossible d’enregistrer le profil."
        );

      } finally {
        setLoading(false);
      }
    };

  return (
    <main className="protocol-auth-page">

      <div className="protocol-auth-glow" />

      <section className="protocol-auth-shell">

        <header className="protocol-auth-brand">

          <BrandMark size="lg" />

        </header>


        <section className="protocol-auth-card">

          <div className="protocol-auth-copy">

            <span className="protocol-auth-eyebrow">
              VOTRE PROFIL
            </span>

            <h1>
              Qui joue ?
            </h1>

            <p>
              Ces informations seront mémorisées
              pour les prochaines parties.
              Le sexe permet à PROTOCOL
              d’adapter certaines cartes à chacun.
            </p>

          </div>


          <form
            className="protocol-auth-form"
            onSubmit={saveProfile}
          >

            <label htmlFor="protocol-profile-name">
              Prénom
            </label>

            <input
              id="protocol-profile-name"
              type="text"
              value={displayName}
              onChange={(event) =>
                setDisplayName(
                  event.target.value
                )
              }
              placeholder="Votre prénom"
              autoComplete="given-name"
              maxLength={40}
              required
            />


            <label
              style={{
                marginTop: "10px",
              }}
            >
              Sexe
            </label>

            <div
              className="protocol-profile-sex-grid"
            >

              <button
                type="button"
                className={
                  sex === "male"
                    ? "protocol-profile-sex-option is-selected"
                    : "protocol-profile-sex-option"
                }
                aria-pressed={
                  sex === "male"
                }
                onClick={() =>
                  setSex("male")
                }
              >
                <span className="protocol-profile-sex-symbol">
                  ♂
                </span>

                <span>
                  Homme
                </span>
              </button>


              <button
                type="button"
                className={
                  sex === "female"
                    ? "protocol-profile-sex-option is-selected"
                    : "protocol-profile-sex-option"
                }
                aria-pressed={
                  sex === "female"
                }
                onClick={() =>
                  setSex("female")
                }
              >
                <span className="protocol-profile-sex-symbol">
                  ♀
                </span>

                <span>
                  Femme
                </span>
              </button>

            </div>


            <button
              type="submit"
              disabled={
                loading ||
                !displayName.trim() ||
                !sex
              }
            >
              <span>
                {loading
                  ? "Enregistrement…"
                  : "Continuer"}
              </span>

              {!loading && (
                <span
                  className="protocol-auth-arrow"
                  aria-hidden="true"
                >
                  →
                </span>
              )}
            </button>

          </form>


          {message && (
            <p className="protocol-auth-message">
              {message}
            </p>
          )}

        </section>

      </section>

    </main>
  );
}
