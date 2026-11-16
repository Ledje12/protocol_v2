import { useCallback, useEffect, useRef, useState } from "react";

import { deName } from "./personalise.js";

/* Lovense à deux jouets : le Lush (elle) et l'anneau Diamo (lui).
   Protocol ne pilote pas les jouets : Lovense Remote s'en charge.
   L'app sait seulement quels jouets sont connectés (toutes les
   connexions du couple, un téléphone ou deux), pour le dire sur
   les cartes et dans les réglages. */

export const TOY_LABEL = { lush: "Lush", ring: "Diamo" };

// la carte peut-elle se jouer avec les jouets connectés ?
export function toyAvailable(cardToy, has) {
  if (!has) {
    return false;
  }

  if (cardToy === "lush") return has.lush;
  if (cardToy === "ring") return has.ring;
  if (cardToy === "both") return has.lush && has.ring;
  return has.lush || has.ring;
}

/* Bandeau d'une carte Lovense : « Lush d'Audrey », « Diamo de
   Jérôme », ou les deux. Rien si le jouet de la carte n'est pas
   connecté. names = { female: "Audrey", male: "Jérôme" } */
export function cardToyBanner(cardToy, has, names = {}) {
  if (!toyAvailable(cardToy, has)) {
    return null;
  }

  const lush = `Lush ${deName(names.female || "elle")}`;
  const ring = `Diamo ${deName(names.male || "lui")}`;

  if (cardToy === "lush") return lush;
  if (cardToy === "ring") return ring;
  if (cardToy === "both") return `${lush} et ${ring}`;

  return [has.lush && lush, has.ring && ring].filter(Boolean).join(" et ");
}

// statut des jouets du couple (relu au retour dans l'app)
export function useLovenseToys(supabase, enabled = true) {
  const [status, setStatus] = useState({ loading: enabled, toys: [], has: null });

  useEffect(() => {
    if (!enabled) {
      setStatus({ loading: false, toys: [], has: null });
      return undefined;
    }

    let active = true;
    setStatus((current) => ({ ...current, loading: true }));

    const check = async () => {
      try {
        const { data, error } = await supabase.functions.invoke("lovense-status", {
          body: {},
        });

        if (error || !data?.success) {
          throw error || new Error(data?.error || "Statut Lovense indisponible.");
        }

        if (active) {
          const toys = Array.isArray(data.toys) ? data.toys : [];
          setStatus({
            loading: false,
            toys,
            has: data.has || {
              lush: toys.some((toy) => toy.type === "lush"),
              ring: toys.some((toy) => toy.type === "ring"),
            },
          });
        }
      } catch (err) {
        console.error("LOVENSE STATUS ERROR:", err);

        if (active) {
          setStatus({ loading: false, toys: [], has: { lush: false, ring: false } });
        }
      }
    };

    check();

    const onVisible = () => {
      if (document.visibilityState === "visible") {
        check();
      }
    };

    document.addEventListener("visibilitychange", onVisible);

    return () => {
      active = false;
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [supabase, enabled]);

  return status;
}

/* =========================================================
   Pilotage depuis PROTOCOL : un curseur et trois ambiances
   par jouet, sur les deux téléphones. Lovense Remote reste
   ouvert sur le téléphone qui tient le jouet (pont Bluetooth).
   ========================================================= */

const toyKindOf = (toy) => {
  if (toy?.type === "lush" || toy?.type === "ring") return toy.type;
  const label = `${toy?.name || ""} ${toy?.toyType || ""}`.toLowerCase();
  if (label.includes("lush")) return "lush";
  if (label.includes("diamo")) return "ring";
  return "other";
};

// jouets utiles à plusieurs cartes ou règles : 'both', 'lush', 'ring' ou null (tous)
export function mergeCardToys(list) {
  const wanted = list.filter((toy) => toy !== undefined);
  if (wanted.length === 0) return undefined;
  if (wanted.some((toy) => toy === null)) return null;
  const lush = wanted.some((toy) => toy === "lush" || toy === "both");
  const ring = wanted.some((toy) => toy === "ring" || toy === "both");
  return lush && ring ? "both" : lush ? "lush" : "ring";
}

const AMBIANCES = [
  { key: "wave", label: "Vague" },
  { key: "pulse", label: "Pulsation" },
  { key: "crescendo", label: "Crescendo" },
];

const SEND_EVERY_MS = 350; // pas plus de ~3 commandes par seconde
const KEEP_ALIVE_MS = 20000; // le serveur coupe seul après 30 s

function ToyControl({ supabase, toy, label }) {
  const [level, setLevel] = useState(0);
  const [ambiance, setAmbiance] = useState(null);
  const [error, setError] = useState("");
  const lastSentAt = useRef(0);
  const pending = useRef(null);
  const timer = useRef(null);
  const active = useRef(false);

  const send = useCallback(
    async (body) => {
      lastSentAt.current = Date.now();
      try {
        const { data, error: invokeError } = await supabase.functions.invoke(
          "lovense-command",
          { body: { ...body, toy_id: toy.id } }
        );
        if (invokeError || !data?.success) {
          throw invokeError || new Error(data?.error);
        }
        setError("");
      } catch (err) {
        console.error("LOVENSE CONTROL ERROR:", err);
        setError("Le jouet ne répond pas. Lovense Remote est-il ouvert ?");
      }
    },
    [supabase, toy.id]
  );

  // envoie la dernière valeur, au plus toutes les 350 ms
  const queue = useCallback(
    (body) => {
      pending.current = body;
      if (timer.current) return;
      const wait = Math.max(0, SEND_EVERY_MS - (Date.now() - lastSentAt.current));
      timer.current = window.setTimeout(() => {
        timer.current = null;
        const next = pending.current;
        pending.current = null;
        if (next) send(next);
      }, wait);
    },
    [send]
  );

  useEffect(() => {
    active.current = level > 0 || ambiance !== null;
  }, [level, ambiance]);

  // tant qu'il vibre, on renouvelle avant la coupure automatique
  useEffect(() => {
    if (level === 0 && !ambiance) return undefined;
    const keep = window.setInterval(() => {
      send(ambiance ? { action: "ambiance", name: ambiance } : { action: "vibrate", level });
    }, KEEP_ALIVE_MS);
    return () => window.clearInterval(keep);
  }, [level, ambiance, send]);

  // on quitte la carte : le jouet s'arrête
  useEffect(
    () => () => {
      window.clearTimeout(timer.current);
      if (active.current) {
        send({ action: "vibrate", level: 0 });
      }
    },
    [send]
  );

  const onSlide = (event) => {
    const next = Number(event.target.value);
    setLevel(next);
    setAmbiance(null);
    queue({ action: "vibrate", level: next });
  };

  const onAmbiance = (key) => {
    setLevel(0);
    if (ambiance === key) {
      setAmbiance(null);
      queue({ action: "vibrate", level: 0 });
      return;
    }
    setAmbiance(key);
    queue({ action: "ambiance", name: key });
  };

  const live = level > 0 || ambiance !== null;

  return (
    <div className={live ? "lovense-toy is-live" : "lovense-toy"}>
      <div className="lovense-toy-head">
        <strong>{label}</strong>
        <span>
          {ambiance
            ? AMBIANCES.find((item) => item.key === ambiance)?.label
            : level > 0
              ? `${Math.round((level / 20) * 100)} %`
              : "À l’arrêt"}
        </span>
      </div>

      <input
        type="range"
        className="lovense-slider"
        min="0"
        max="20"
        step="1"
        value={level}
        onChange={onSlide}
        aria-label={`Intensité · ${label}`}
        style={{ "--level": `${(level / 20) * 100}%` }}
      />

      <div className="lovense-ambiances">
        {AMBIANCES.map((item) => (
          <button
            key={item.key}
            type="button"
            className={ambiance === item.key ? "is-on" : ""}
            onClick={() => onAmbiance(item.key)}
            aria-pressed={ambiance === item.key}
          >
            {item.label}
          </button>
        ))}
      </div>

      {error && <p className="lovense-toy-error">{error}</p>}
    </div>
  );
}

/* Panneau Lovense d'une carte : un contrôle par jouet utile
   (Lush, Diamo, ou les deux), seulement s'il est connecté. */
export function LovenseRemote({ supabase, toys, cardToy, names = {} }) {
  if (cardToy === undefined || !Array.isArray(toys) || toys.length === 0) {
    return null;
  }

  const wanted =
    cardToy === "both" ? ["lush", "ring"] : cardToy ? [cardToy] : ["lush", "ring", "other"];

  const shown = toys.filter((toy) => wanted.includes(toyKindOf(toy)));

  if (shown.length === 0) {
    return null;
  }

  const labelOf = (toy) => {
    const kind = toyKindOf(toy);
    if (kind === "lush") return `Lush ${deName(names.female || "elle")}`;
    if (kind === "ring") return `Diamo ${deName(names.male || "lui")}`;
    return toy.name || "Jouet";
  };

  return (
    <section className="lovense-remote" aria-label="Jouets Lovense">
      <p className="lovense-remote-kicker">
        <span className="lovense-banner-dot" aria-hidden="true" />
        Lovense
      </p>

      {shown.map((toy) => (
        <ToyControl key={toy.id} supabase={supabase} toy={toy} label={labelOf(toy)} />
      ))}
    </section>
  );
}

export function LovenseBanner({ label }) {
  if (!label) {
    return null;
  }

  return (
    <div className="lovense-banner" role="note">
      <span className="lovense-banner-dot" aria-hidden="true" />
      <span className="lovense-banner-text">
        <strong>Lovense · {label}</strong>
        <small>Le curseur est sous la carte.</small>
      </span>
    </div>
  );
}
