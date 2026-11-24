import { useState } from "react";
import BrandMark from "./BrandMark.jsx";
import { supabase } from "./supabaseClient.js";
import { isNetworkError, NETWORK_MESSAGE } from "./networkError.js";

/* Messages de Supabase Auth (en anglais) traduits : mauvais code, trop
   de demandes, adresse refusée. Le reste garde le message par défaut. */
const authMessage = (err, fallback) => {
  if (isNetworkError(err)) return NETWORK_MESSAGE;
  const text = `${err?.message || ""} ${err?.code || ""}`;
  if (/expired|invalid.*(token|otp)|otp_expired|token.*invalid/i.test(text)) {
    return "Code incorrect ou expiré. Vérifie les chiffres, ou demande un nouveau code.";
  }
  if (/rate limit|only request this after|too many|over_email_send_rate_limit/i.test(text)) {
    return "Trop de demandes d’affilée. Attends une minute, puis réessaie.";
  }
  if (/invalid.*email|email.*invalid|validation_failed/i.test(text)) {
    return "Cette adresse email ne semble pas valide.";
  }
  if (/signups? not allowed|signup_disabled/i.test(text)) {
    return "Les inscriptions sont fermées pour le moment.";
  }
  return fallback;
};

export default function AuthScreen({ onAuthenticated }) {
  const [email, setEmail] =
    useState("");

  const [code, setCode] =
    useState("");

  const [step, setStep] =
    useState("email");

  const [loading, setLoading] =
    useState(false);

  const [message, setMessage] =
    useState("");

  // majorité et consentement aux données intimes : obligatoires
  const [consent, setConsent] =
    useState(false);

  // enregistrés sur le compte à sa création (pas à chaque connexion)
  const consentData = () => {
    const now = new Date().toISOString();
    return {
      adult_confirmed_at: now,
      intimate_data_consent_at: now,
    };
  };

  const sendCode =
    async (event) => {
      event.preventDefault();

      if (!consent) {
        setMessage(
          "Coche la case pour continuer : PROTOCOL est réservé aux adultes."
        );
        return;
      }

      try {
        setLoading(true);
        setMessage("");

        const normalizedEmail =
          email.trim().toLowerCase();

        const { error } =
          await supabase.auth.signInWithOtp({
            email: normalizedEmail,
            options: {
              shouldCreateUser: true,
              data: consentData(),
            },
          });

        if (error) {
          throw error;
        }

        setStep("code");

        setMessage(
          "Code envoyé par email."
        );

      } catch (err) {
        setMessage(
          authMessage(err, "Impossible d’envoyer le code. Réessaie dans un instant.")
        );

      } finally {
        setLoading(false);
      }
    };

  const resendCode = async () => {
    try {
      setLoading(true);
      setMessage("");

      const normalizedEmail =
        email.trim().toLowerCase();

      const { error } =
        await supabase.auth.signInWithOtp({
          email: normalizedEmail,
          options: {
            shouldCreateUser: true,
            data: consentData(),
          },
        });

      if (error) {
        throw error;
      }

      setCode("");

      setMessage(
        "Nouveau code envoyé par email."
      );

    } catch (err) {
      setMessage(
        authMessage(err, "Impossible de renvoyer le code. Réessaie dans un instant.")
      );

    } finally {
      setLoading(false);
    }
  };
  
  const verifyCode =
    async (event) => {
      event.preventDefault();

      try {
        setLoading(true);
        setMessage("");

        const normalizedEmail =
          email.trim().toLowerCase();

        const { data, error } =
          await supabase.auth.verifyOtp({
            email: normalizedEmail,
            token: code.trim(),
            type: "email",
          });

        if (error) {
          throw error;
        }

        if (!data?.session) {
          throw new Error(
            "Session Supabase introuvable."
          );
        }

        onAuthenticated?.(
          data.session
        );

      } catch (err) {
        setMessage(
          authMessage(err, "Code incorrect ou expiré.")
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

          <p>

            Privé · Discret · À deux

          </p>

        </header>


        <section className="protocol-auth-card">

          {step === "email" && (
            <>
              <div className="protocol-auth-copy">

                <span className="protocol-auth-eyebrow">
                  CONNEXION
                </span>

                <h1>
                  Votre espace.
                </h1>

                <p>
                  Recevez un code par email pour accéder à PROTOCOL.
                </p>

              </div>

              <form
                className="protocol-auth-form"
                onSubmit={sendCode}
              >

                <label htmlFor="protocol-auth-email">
                  Email
                </label>

                <input
                  id="protocol-auth-email"
                  type="email"
                  value={email}
                  onChange={(event) =>
                    setEmail(
                      event.target.value
                    )
                  }
                  required
                  autoComplete="email"
                  placeholder="vous@exemple.com"
                />

                <label
                  className="protocol-auth-consent"
                  htmlFor="protocol-auth-consent"
                >
                  <input
                    id="protocol-auth-consent"
                    type="checkbox"
                    checked={consent}
                    onChange={(event) =>
                      setConsent(event.target.checked)
                    }
                  />
                  <span>
                    J’ai 18 ans ou plus. J’accepte que PROTOCOL conserve des
                    données sur ma vie intime (cartes, avis, messages) pour
                    faire fonctionner le jeu.{" "}
                    <a href="/privacy">En savoir plus</a>
                  </span>
                </label>

                <button
                  type="submit"
                  disabled={loading || !consent}
                >
                  <span>
                    {loading
                      ? "Envoi…"
                      : "Recevoir mon code"}
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
            </>
          )}


          {step === "code" && (
            <>
              <div className="protocol-auth-copy">

                <span className="protocol-auth-eyebrow">
                  VÉRIFICATION
                </span>

                <h1>
                  Presque là.
                </h1>

                <p>
                  Entre le code à 8 chiffres envoyé à
                  <strong>
                    {" "}
                    {email.trim().toLowerCase()}
                  </strong>.
                  Il peut mettre quelques secondes à arriver.
                </p>

              </div>

              <form
                className="protocol-auth-form"
                onSubmit={verifyCode}
              >

                <label htmlFor="protocol-auth-code">
                  Code reçu
                </label>

                <input
                  id="protocol-auth-code"
                  className="protocol-auth-code"
                  type="text"
                  inputMode="numeric"
                  value={code}
                  onChange={(event) =>
                    setCode(
                      event.target.value
                        .replace(/\D/g, "")
                        .slice(0, 8)
                    )
                  }
                  maxLength={8}
                  required
                  autoComplete="one-time-code"
                  placeholder="••••••••"
                />

                <button
                  type="submit"
                  disabled={
                    loading ||
                    code.length !== 8
                  }
                >
                  <span>
                    {loading
                      ? "Connexion…"
                      : "Entrer dans PROTOCOL"}
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


                <button
                  type="button"
                  className="protocol-auth-back"
                  onClick={resendCode}
                  disabled={loading}
                >
                  Renvoyer le code
                </button>

                <button
                  type="button"
                  className="protocol-auth-back"
                  onClick={() => {
                    setCode("");
                    setMessage("");
                    setStep("email");
                  }}
                  disabled={loading}
                >
                  Utiliser une autre adresse
                </button>

              </form>
            </>
          )}


          {message && (
            <p className="protocol-auth-message">
              {message}
            </p>
          )}

          <div className="protocol-auth-legal">
            <a href="/privacy">
              Confidentialité
            </a>
          </div>

        </section>

      </section>

    </main>
  );
}
