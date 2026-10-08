import {
  useEffect,
  useState,
} from "react";

/*
 * Premier lancement : tant que le duo n'est pas associé,
 * l'accueil propose de le faire ici (créer un code ou saisir
 * celui de l'autre), au lieu de « Lancer une partie », qui
 * échouerait. Mêmes fonctions que dans les Réglages.
 */
export default function PairingPanel({
  supabase,
  onPaired,
}) {
  const [mode, setMode] =
    useState(null); // null | "create" | "join"

  const [code, setCode] =
    useState("");

  const [joinCode, setJoinCode] =
    useState("");

  const [loading, setLoading] =
    useState(false);

  const [message, setMessage] =
    useState("");

  /* code affiché : on guette l'association faite par l'autre */
  useEffect(() => {
    if (mode !== "create" || !code) {
      return undefined;
    }

    const timer =
      window.setInterval(async () => {
        const { data } =
          await supabase.rpc(
            "get_protocol_couple"
          );

        if (data?.partner) {
          onPaired?.();
        }
      }, 4000);

    return () => {
      window.clearInterval(timer);
    };
  }, [
    mode,
    code,
    supabase,
    onPaired,
  ]);

  const createCode = async () => {
    setMode("create");
    setMessage("");
    setLoading(true);

    const { data, error } =
      await supabase.rpc(
        "create_protocol_couple_invite"
      );

    setLoading(false);

    if (error || !data?.code) {
      console.error("PAIRING CODE ERROR:", error);
      setMessage("Impossible de créer le code. Réessaie dans un instant.");
      return;
    }

    setCode(data.code);
  };

  const join = async (event) => {
    event.preventDefault();

    const clean =
      joinCode.trim().toUpperCase();

    if (!clean) {
      return;
    }

    setMessage("");
    setLoading(true);

    const { data, error } =
      await supabase.rpc(
        "join_protocol_couple",
        {
          p_code: clean,
        }
      );

    setLoading(false);

    if (error || !data?.success) {
      console.error("PAIRING JOIN ERROR:", error);
      setMessage("Code incorrect ou expiré.");
      return;
    }

    onPaired?.();
  };

  return (
    <section className="pairing-panel">
      <p className="pairing-kicker">
        AVANT DE JOUER
      </p>

      <h2>
        Associez vos deux téléphones.
      </h2>

      <p className="pairing-copy">
        Une seule fois. Ensuite, parties, messages et signes
        passent directement de l’un à l’autre.
      </p>

      {mode === "create" ? (
        <div className="pairing-code">
          <span>
            Ton code
          </span>

          <strong>
            {loading ? "······" : code || "—"}
          </strong>

          <small>
            Saisis-le sur l’autre téléphone, à l’accueil.
            Valable 24 heures.
          </small>
        </div>
      ) : mode === "join" ? (
        <form
          className="pairing-join"
          onSubmit={join}
        >
          <input
            value={joinCode}
            onChange={(event) =>
              setJoinCode(
                event.target.value.toUpperCase()
              )
            }
            placeholder="Code de l’autre"
            autoCapitalize="characters"
            autoComplete="off"
            aria-label="Code de ton partenaire"
          />

          <button
            type="submit"
            className="primary"
            disabled={loading || !joinCode.trim()}
          >
            <span>
              {loading ? "Association…" : "Associer"}
            </span>
            <span>→</span>
          </button>
        </form>
      ) : (
        <div className="pairing-choices">
          <button
            type="button"
            className="primary"
            onClick={createCode}
          >
            <span>Créer mon code</span>
            <span>→</span>
          </button>

          <button
            type="button"
            className="secondary"
            onClick={() => setMode("join")}
          >
            J’ai déjà un code
          </button>
        </div>
      )}

      {mode && (
        <button
          type="button"
          className="pairing-switch"
          onClick={() => {
            setMessage("");
            setMode(mode === "create" ? "join" : "create");
            if (mode === "join" && !code) {
              createCode();
            }
          }}
        >
          {mode === "create"
            ? "J’ai plutôt un code à saisir"
            : "Je préfère créer mon code"}
        </button>
      )}

      {message && (
        <p className="error">
          {message}
        </p>
      )}
    </section>
  );
}
