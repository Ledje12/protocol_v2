import { useEffect, useState } from "react";

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

export function LovenseBanner({ label }) {
  if (!label) {
    return null;
  }

  return (
    <div className="lovense-banner" role="note">
      <span className="lovense-banner-dot" aria-hidden="true" />
      <span className="lovense-banner-text">
        <strong>Lovense · {label}</strong>
        <small>À piloter depuis l’app Lovense Remote.</small>
      </span>
    </div>
  );
}
