import { useCallback, useEffect, useRef, useState } from "react";

import { deName } from "./personalise.js";

/* Lovense à deux jouets : le Lush (elle) et l'anneau Diamo (lui).
   L'app sait quels jouets sont connectés (toutes les connexions du
   couple, un téléphone ou deux), le dit sur les cartes et dans les
   réglages, et affiche un curseur par jouet sous les cartes.
   Lovense Remote reste le pont Bluetooth. */

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

    const check = async (attempt = 0) => {
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

        if (!active) return;

        // erreur passagère : on réessaie une fois, sans rien effacer
        if (attempt === 0) {
          window.setTimeout(() => active && check(1), 2500);
        }

        // jamais su : pas de jouet ; déjà su : on garde le dernier état
        setStatus((previous) =>
          previous.has
            ? { ...previous, loading: false }
            : attempt === 0
              ? previous
              : { loading: false, toys: [], has: { lush: false, ring: false } }
        );
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
const POLL_MS = 3000; // relecture de l'état partagé
const HOLD_MS = 40000; // sans renouvellement, la commande est éteinte
const LOCAL_GRACE_MS = 1500; // le doigt est encore sur le curseur

const STATE_COLUMNS = "toy_id, level, ambiance, updated_at, renewed_at";

// état partagé d'un jouet, tel qu'il vibre vraiment : une commande
// que personne n'a renouvelée s'est éteinte seule
function liveState(row) {
  if (!row) return null;
  const expired = Date.now() - Date.parse(row.renewed_at || row.updated_at) > HOLD_MS;
  return {
    level: expired ? 0 : Number(row.level) || 0,
    ambiance: expired ? null : row.ambiance || null,
    rev: row.updated_at || null,
  };
}

/* État des jouets du couple (protocol_lovense_toy_state), relu
   toutes les 3 s tant que l'écran est visible : les deux téléphones
   montrent le même curseur. Sans la table (migration pas encore
   lancée), on s'arrête là et chaque téléphone garde son état. */
function useToyStates(supabase, enabled) {
  const [states, setStates] = useState({});

  useEffect(() => {
    if (!enabled) return undefined;

    let active = true;
    let timer = null;

    const read = async () => {
      if (document.visibilityState === "visible") {
        const { data, error } = await supabase
          .from("protocol_lovense_toy_state")
          .select(STATE_COLUMNS);

        if (!active) return;

        if (error) {
          console.warn("LOVENSE STATE WARNING:", error.message);
          return;
        }

        setStates(Object.fromEntries((data || []).map((row) => [row.toy_id, row])));
      }

      timer = window.setTimeout(read, POLL_MS);
    };

    read();

    return () => {
      active = false;
      window.clearTimeout(timer);
    };
  }, [supabase, enabled]);

  return states;
}

function ToyControl({ supabase, toy, label, remote }) {
  const [level, setLevel] = useState(0);
  const [ambiance, setAmbiance] = useState(null);
  const [showAmbiances, setShowAmbiances] = useState(false);
  const [error, setError] = useState("");

  // version de l'état partagé connue de ce téléphone (null : sans table)
  const rev = useRef(null);
  const lastSentAt = useRef(0);
  const lastLocalAt = useRef(0);
  const pending = useRef(null);
  const busy = useRef(false);
  // ce téléphone a-t-il décidé de l'état en cours ?
  const mine = useRef(false);
  const current = useRef({ level: 0, ambiance: null });
  const mounted = useRef(true);

  const apply = useCallback((next) => {
    current.current = { level: next.level, ambiance: next.ambiance };
    setLevel(next.level);
    setAmbiance(next.ambiance);
  }, []);

  const invoke = useCallback(
    async (body) => {
      const { data, error: invokeError } = await supabase.functions.invoke(
        "lovense-command",
        { body: { ...body, toy_id: toy.id } }
      );
      if (invokeError || !data?.success) {
        throw invokeError || new Error(data?.error);
      }
      return data;
    },
    [supabase, toy.id]
  );

  /* Une seule commande en vol, la dernière valeur gagne : un « 0 »
     ne peut plus arriver avant le « 40 % » qui le précédait. */
  const pump = useCallback(async () => {
    if (busy.current) return;
    busy.current = true;

    try {
      while (pending.current) {
        const wait = SEND_EVERY_MS - (Date.now() - lastSentAt.current);
        if (wait > 0) {
          await new Promise((resolve) => window.setTimeout(resolve, wait));
        }

        const body = pending.current;
        pending.current = null;
        lastSentAt.current = Date.now();

        try {
          const data = await invoke(body);
          if (data.state) rev.current = data.state.updated_at;
          if (mounted.current) setError("");
        } catch (err) {
          console.error("LOVENSE CONTROL ERROR:", err);
          // rien n'a été demandé d'autre depuis : l'écran dit vrai
          if (mounted.current && !pending.current) {
            mine.current = false;
            apply({ level: 0, ambiance: null });
            setError("Le jouet ne répond pas. Lovense Remote est-il ouvert ?");
          }
        }
      }
    } finally {
      busy.current = false;
    }
  }, [invoke, apply]);

  const decide = useCallback(
    (next, body) => {
      mine.current = true;
      lastLocalAt.current = Date.now();
      apply(next);
      pending.current = body;
      pump();
    },
    [apply, pump]
  );

  // l'autre téléphone a bougé le curseur, ou la commande s'est éteinte
  useEffect(() => {
    const next = liveState(remote);
    if (!next) return;
    if (busy.current || pending.current) return;
    if (Date.now() - lastLocalAt.current < LOCAL_GRACE_MS) return;
    // lecture partie avant notre dernière commande : déjà dépassée
    if (rev.current && next.rev && Date.parse(next.rev) < Date.parse(rev.current)) return;

    const changed =
      next.level !== current.current.level || next.ambiance !== current.current.ambiance;

    if (next.rev !== rev.current) {
      rev.current = next.rev;
      if (changed) mine.current = false;
    }

    if (changed) apply(next);
  }, [remote, apply]);

  const live = level > 0 || ambiance !== null;

  /* Tant qu'il vibre, on prolonge avant la coupure automatique. Le
     serveur ne relance que l'état que ce téléphone connaît : si
     l'autre l'a arrêté ou changé, il répond avec l'état réel. */
  useEffect(() => {
    if (!live) return undefined;

    const keep = window.setInterval(async () => {
      if (busy.current || pending.current) return;

      try {
        if (!rev.current) {
          // sans état partagé : on renvoie la commande, comme avant
          await invoke(
            current.current.ambiance
              ? { action: "ambiance", name: current.current.ambiance }
              : { action: "vibrate", level: current.current.level }
          );
          return;
        }

        const data = await invoke({ action: "renew", updated_at: rev.current });

        if (!mounted.current || busy.current || pending.current || !data.state) return;

        if (data.state.updated_at !== rev.current || data.renewed === false) {
          const next = {
            level: Number(data.state.level) || 0,
            ambiance: data.state.ambiance || null,
          };
          if (data.state.updated_at !== rev.current) mine.current = false;
          rev.current = data.state.updated_at;
          if (
            next.level !== current.current.level ||
            next.ambiance !== current.current.ambiance
          ) {
            apply(next);
          }
        }
      } catch (err) {
        console.error("LOVENSE KEEP ALIVE ERROR:", err);
      }
    }, KEEP_ALIVE_MS);

    return () => window.clearInterval(keep);
  }, [live, invoke, apply]);

  /* Sans état partagé, un téléphone qui revient d'arrière-plan
     relancerait un jouet éteint depuis longtemps : on coupe en
     partant. Avec l'état partagé, le serveur s'en charge. */
  useEffect(() => {
    const onHidden = () => {
      if (document.visibilityState !== "hidden" || rev.current) return;
      if (current.current.level > 0 || current.current.ambiance) {
        decide({ level: 0, ambiance: null }, { action: "vibrate", level: 0 });
      }
    };

    document.addEventListener("visibilitychange", onHidden);
    return () => document.removeEventListener("visibilitychange", onHidden);
  }, [decide]);

  // on quitte la carte : celui qui a lancé le jouet l'arrête
  useEffect(() => {
    mounted.current = true;

    return () => {
      mounted.current = false;
      pending.current = null;

      if (mine.current && (current.current.level > 0 || current.current.ambiance)) {
        invoke({ action: "vibrate", level: 0 }).catch((err) =>
          console.error("LOVENSE STOP ERROR:", err)
        );
      }
    };
  }, [invoke]);

  const onSlide = (event) => {
    const next = Number(event.target.value);
    decide({ level: next, ambiance: null }, { action: "vibrate", level: next });
  };

  const onAmbiance = (key) => {
    if (ambiance === key) {
      decide({ level: 0, ambiance: null }, { action: "vibrate", level: 0 });
      return;
    }
    decide({ level: 0, ambiance: key }, { action: "ambiance", name: key });
  };

  const ambiancesOpen = showAmbiances || ambiance !== null;

  return (
    <div className={live ? "lovense-toy is-live" : "lovense-toy"}>
      <div className="lovense-toy-head">
        <strong>{label}</strong>
        <span className="lovense-toy-status" aria-live="polite">
          {ambiance
            ? AMBIANCES.find((item) => item.key === ambiance)?.label
            : level > 0
              ? `${Math.round((level / 20) * 100)} %`
              : "À l’arrêt"}
        </span>
        <button
          type="button"
          className="lovense-toy-more"
          onClick={() => setShowAmbiances((open) => !open)}
          aria-expanded={ambiancesOpen}
          disabled={ambiance !== null}
        >
          Ambiances
        </button>
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

      {ambiancesOpen && (
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
      )}

      {error && <p className="lovense-toy-error">{error}</p>}
    </div>
  );
}

/* Panneau Lovense d'une carte : un contrôle par jouet utile
   (Lush, Diamo, ou les deux), seulement s'il est connecté. */
export function LovenseRemote({ supabase, toys, cardToy, names = {} }) {
  const wanted =
    cardToy === "both" ? ["lush", "ring"] : cardToy ? [cardToy] : ["lush", "ring", "other"];

  const shown =
    cardToy === undefined || !Array.isArray(toys)
      ? []
      : toys.filter((toy) => wanted.includes(toyKindOf(toy)));

  const states = useToyStates(supabase, shown.length > 0);

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
        <ToyControl
          key={toy.id}
          supabase={supabase}
          toy={toy}
          label={labelOf(toy)}
          remote={states[toy.id]}
        />
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
