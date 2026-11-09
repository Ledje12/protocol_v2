import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";

import { useAdvent } from "./AdventTile.jsx";
import { humanError } from "./networkError.js";
import { fillNames } from "./personalise.js";
import { BackIcon } from "./ScreenHeader.jsx";

/* Calendrier de l'Avent : un défi par jour, du 1er au 24 décembre.
   Les cases se dévoilent côté serveur (get_protocol_advent) : avant
   son jour, le texte d'une case n'arrive jamais jusqu'au téléphone.
   Un admin peut tout lire en aperçu, sans rien enregistrer. */

// cases mélangées, comme sur un vrai calendrier
const DOOR_ORDER = [
  7, 19, 2, 13, 22, 10, 4, 16, 24, 1, 12, 20,
  6, 17, 9, 3, 21, 14, 11, 23, 5, 18, 8, 15,
];

export default function AdventScreen({ supabase, profile, couple, onBack }) {
  const [advent, reload, loadError] = useAdvent(supabase);
  const [open, setOpen] = useState(null);
  const [hint, setHint] = useState("");
  // case en train de s'ouvrir (la porte pivote), case refusée (secousse)
  const [opening, setOpening] = useState(null);
  const [denied, setDenied] = useState(null);
  // aperçu : « Défi relevé » coché sur ce téléphone seulement
  // (jour → version relevée)
  const [previewDone, setPreviewDone] = useState(() => ({}));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const partner = couple?.partner;

  // « {{partner}} » = l'autre, « {{me}} » = moi, avec les pronoms
  /* Rôles du jour, identiques sur les deux téléphones :
     {{lead}} mène, {{follow}} suit (avec leurs pronoms, ex.
     {{follow_le}}, {{lead_il}}, {{follow_e}}). Ils s'échangent d'un
     jour à l'autre : ordre fixe des deux comptes, jours impairs pour
     le premier. {{partner}} et {{me}} restent possibles. */
  const me = {
    id: profile?.user_id,
    name: profile?.display_name || "toi",
    sex: profile?.sex,
  };
  const other = {
    id: partner?.user_id,
    name: partner?.display_name || "l’autre",
    sex: partner?.sex,
  };
  const [first, second] = [me, other].sort((a, b) =>
    String(a.id || "").localeCompare(String(b.id || ""))
  );

  const personalise = (text, day) => {
    const lead = day % 2 === 1 ? first : second;
    const follow = lead === first ? second : first;

    return fillNames(
      text,
      { lead: lead.name, follow: follow.name, partner: other.name, me: me.name },
      { lead: lead.sex, follow: follow.sex, partner: other.sex, me: me.sex }
    );
  };

  const doors = advent?.days || [];
  const byDay = Object.fromEntries(doors.map((door) => [door.day, door]));

  const openDoor = async (door, element) => {
    setError("");

    if (opening) {
      return;
    }

    if (!door.unlocked) {
      setHint(`Patience : la case ${door.day} s’ouvre le ${door.day} décembre.`);
      setDenied(door.day);
      window.setTimeout(() => setDenied(null), 450);
      return;
    }

    setHint("");

    // première ouverture : la porte pivote, la lueur apparaît, puis
    // le défi monte (tout de suite si l'animation est désactivée)
    const calm = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;

    if (!door.opened && !calm) {
      setOpening(door.day);
      // la carte sort quand la porte est grande ouverte
      await new Promise((resolve) => window.setTimeout(resolve, 520));
      window.setTimeout(() => setOpening(null), 600);
    }

    setOpen({ day: door.day, from: calm ? null : element?.getBoundingClientRect() });

    // l'aperçu ne fait que lire
    if (!door.opened && !advent.preview) {
      const { error: rpcError } = await supabase.rpc("set_protocol_advent", {
        p_day: door.day,
      });

      if (!rpcError) {
        reload();
      }
    }
  };

  // « Défi relevé » pour la version affichée ; la toucher à nouveau
  // annule, choisir l'autre version la remplace
  const toggleDone = async (variant) => {
    const day = open.day;
    const done = doneVariantOf(byDay[day]) === variant;

    if (advent.preview) {
      setPreviewDone((current) => ({ ...current, [day]: done ? null : variant }));
      return;
    }

    setBusy(true);
    setError("");

    const { error: rpcError } = await supabase.rpc("set_protocol_advent", {
      p_day: day,
      p_done: !done,
      p_variant: variant,
    });

    setBusy(false);

    if (rpcError) {
      setError(humanError(rpcError, "Impossible d’enregistrer. Réessaie dans un instant."));
      return;
    }

    await reload();
  };

  // version relevée d'une case (aperçu : ce téléphone seulement)
  const doneVariantOf = (door) =>
    !door
      ? null
      : advent?.preview
        ? previewDone[door.day] || null
        : door.done
          ? door.done_variant || "bold"
          : null;

  const current = open ? byDay[open.day] : null;

  // les deux cartes du jour : Douce (si écrite) puis Osée
  const variants = current
    ? [
        current.soft_prompt && {
          key: "soft",
          label: "Douce",
          title: personalise(current.soft_title || current.title, current.day),
          prompt: personalise(current.soft_prompt, current.day),
        },
        {
          key: "bold",
          label: "Osée",
          title: personalise(current.title, current.day),
          prompt: personalise(current.prompt, current.day),
        },
      ].filter(Boolean)
    : [];
  const doneCount = doors.filter((door) => door.done).length;

  return (
    <main className="app protocol-settings-page advent-page">
      <header className="header protocol-settings-header">
        <button
          type="button"
          className="back protocol-settings-back"
          onClick={onBack}
          aria-label="Retour"
        >
          <BackIcon />
        </button>

        <div className="protocol-settings-heading">
          <span className="logo protocol-settings-logo">PROTOCOL</span>
          <span className="protocol-settings-subtitle">Décembre à deux</span>
        </div>
      </header>

      <section className="protocol-settings advent">
        <section className="protocol-settings-intro">
          <p className="kicker">CALENDRIER DE L’AVENT</p>
          <h1>
            Un défi
            <br />
            par jour.
          </h1>
          <p className="intro">
            Une case s’ouvre chaque matin jusqu’au 24. Pas de triche : celle
            de demain reste scellée jusqu’à demain.
          </p>
        </section>

        {advent?.preview && (
          <p className="advent-preview">
            Aperçu : toutes les cases sont lisibles pour toi seul, et rien
            n’est enregistré. {partner?.display_name || "L’autre"} ne voit
            rien avant le 1er décembre.
          </p>
        )}

        {!advent && !loadError && <p className="recaps-status">Chargement…</p>}
        {loadError && <p className="recaps-status is-error">{loadError}</p>}

        {advent && doors.length === 0 && (
          <p className="recaps-status">Les défis arrivent bientôt.</p>
        )}

        {doors.length > 0 && (
          <>
            {advent.today === 0 && !advent.preview && (
              <p className="advent-progress">
                Toutes les cases sont encore scellées : la première s’ouvre
                le 1er décembre.
              </p>
            )}

            {advent.today >= 1 && (
              <p className="advent-progress">
                {doneCount === 0
                  ? "Aucun défi relevé pour l’instant."
                  : `${doneCount} défi${doneCount > 1 ? "s" : ""} relevé${doneCount > 1 ? "s" : ""} sur 24.`}
              </p>
            )}

            <div className="advent-grid">
              {DOOR_ORDER.filter((day) => byDay[day]).map((day) => {
                const door = byDay[day];
                const isToday = day === advent.today;

                return (
                  <button
                    key={day}
                    type="button"
                    className={[
                      "advent-door",
                      door.unlocked ? "is-unlocked" : "is-locked",
                      door.opened ? "is-opened" : "",
                      door.done ? "is-done" : "",
                      isToday ? "is-today" : "",
                      opening === day ? "is-opening" : "",
                      denied === day ? "is-denied" : "",
                    ]
                      .filter(Boolean)
                      .join(" ")}
                    onClick={(event) => openDoor(door, event.currentTarget)}
                    aria-label={`Case ${day}${door.unlocked ? "" : ", scellée"}${door.done ? ", défi relevé" : ""}`}
                  >
                    <span className="advent-door-inside" aria-hidden="true">✦</span>
                    <span className="advent-door-leaf">
                      <span className="advent-door-number">{day}</span>
                      {door.done && <span className="advent-door-mark" aria-hidden="true">✓</span>}
                    </span>
                  </button>
                );
              })}
            </div>

            {hint && <p className="advent-hint">{hint}</p>}
          </>
        )}
      </section>

      {current && (
        <AdventReveal
          from={open.from}
          kicker={`${current.day} DÉCEMBRE`}
          variants={variants}
          initial={doneVariantOf(current)}
          onClose={() => setOpen(null)}
          renderBody={(variant) => {
            const done = doneVariantOf(current) === variant.key;

            return (
              <>
                <p className="advent-prompt">{variant.prompt}</p>

                <button
                  type="button"
                  className={done ? "advent-done is-done" : "advent-done"}
                  disabled={busy}
                  onClick={() => toggleDone(variant.key)}
                >
                  {done ? "✓ Défi relevé" : "Défi relevé"}
                </button>

                {advent.preview && (
                  <p className="advent-reveal-note">Aperçu : rien n’est enregistré.</p>
                )}

                {error && <p className="settings-feedback">{error}</p>}
              </>
            );
          }}
        />
      )}
    </main>
  );
}

/* La carte du jour sort de sa case et vient se poser au centre :
   elle part de la position de la case (dos champagne), grandit en
   pivotant légèrement, puis se retourne sur le défi.
   Deux versions (Douce, Osée) : on fait glisser la carte à gauche ou
   à droite (ou on touche l'étiquette) pour passer à l'autre, posée
   juste derrière. */
const SWIPE_THRESHOLD = 70;

function AdventReveal({ from, kicker, variants, initial, onClose, renderBody }) {
  const cardRef = useRef(null);
  const dragRef = useRef(null);
  const [settled, setSettled] = useState(!from);
  const [leaving, setLeaving] = useState(false);
  const [index, setIndex] = useState(() =>
    Math.max(0, variants.findIndex((variant) => variant.key === initial))
  );
  const onCloseRef = useRef(onClose);

  useEffect(() => {
    onCloseRef.current = onClose;
  });

  const variant = variants[Math.min(index, variants.length - 1)];
  const other = variants.length > 1 ? variants[1 - index] : null;

  // départ : la carte est placée sur la case, puis relâchée
  useLayoutEffect(() => {
    const card = cardRef.current;

    if (!card || !from) {
      return undefined;
    }

    const to = card.getBoundingClientRect();
    const dx = from.left + from.width / 2 - (to.left + to.width / 2);
    const dy = from.top + from.height / 2 - (to.top + to.height / 2);
    const scale = Math.max(from.width / to.width, 0.1);

    card.style.transition = "none";
    card.style.transform = `translate(${dx}px, ${dy}px) scale(${scale}) rotate(-10deg)`;
    card.getBoundingClientRect();

    const frame = window.requestAnimationFrame(() => {
      card.style.transition = "";
      card.style.transform = "";
    });
    const done = window.setTimeout(() => setSettled(true), 820);

    return () => {
      window.cancelAnimationFrame(frame);
      window.clearTimeout(done);
    };
  }, [from]);

  const close = () => {
    setLeaving(true);
    window.setTimeout(() => onCloseRef.current(), 220);
  };

  useEffect(() => {
    cardRef.current?.focus();

    const onKey = (event) => {
      if (event.key === "Escape") {
        close();
      }
    };

    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
    // close ne dépend que de refs et d'états stables
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // la carte part d'un côté, l'autre version arrive de l'autre
  const swap = (direction) => {
    const card = cardRef.current;

    if (!card || !other) {
      return;
    }

    card.style.transition = "transform 0.22s ease-in";
    card.style.transform = `translateX(${direction * 120}%) rotate(${direction * 14}deg)`;

    window.setTimeout(() => {
      setIndex((value) => 1 - value);
      card.style.transition = "none";
      card.style.transform = `translateX(${-direction * 60}%) rotate(${-direction * 8}deg)`;
      card.getBoundingClientRect();
      card.style.transition = "transform 0.38s cubic-bezier(0.2, 0.85, 0.25, 1)";
      card.style.transform = "";
    }, 220);
  };

  const onPointerDown = (event) => {
    if (!settled || !other || event.target.closest("button")) {
      return;
    }

    dragRef.current = { x: event.clientX, dx: 0 };
    cardRef.current.style.transition = "none";
  };

  const onPointerMove = (event) => {
    const drag = dragRef.current;

    if (!drag) {
      return;
    }

    drag.dx = event.clientX - drag.x;
    cardRef.current.style.transform = `translateX(${drag.dx}px) rotate(${drag.dx / 18}deg)`;
  };

  const onPointerUp = () => {
    const drag = dragRef.current;
    dragRef.current = null;

    if (!drag) {
      return;
    }

    if (Math.abs(drag.dx) > SWIPE_THRESHOLD) {
      swap(drag.dx > 0 ? 1 : -1);
      return;
    }

    cardRef.current.style.transition = "transform 0.3s ease";
    cardRef.current.style.transform = "";
  };

  return createPortal(
    <div
      className={leaving ? "advent-reveal is-leaving" : "advent-reveal"}
      onClick={(event) => {
        if (event.target === event.currentTarget) {
          close();
        }
      }}
    >
      <div className="advent-reveal-stack">
        {other && settled && (
          <div
            className={other.key === "bold" ? "advent-reveal-peek is-bold" : "advent-reveal-peek"}
            aria-hidden="true"
          >
            <span>{other.label}</span>
          </div>
        )}

        <section
          ref={cardRef}
          className={[
            "advent-reveal-card",
            settled ? "is-settled" : "",
            variant.key === "bold" ? "is-bold" : "",
          ]
            .filter(Boolean)
            .join(" ")}
          role="dialog"
          aria-modal="true"
          aria-label={variant.title}
          tabIndex={-1}
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
          onPointerCancel={onPointerUp}
        >
          <div className="advent-reveal-inner">
            <div className="advent-reveal-face">
              <header className="advent-reveal-head">
                <span>{kicker}</span>
                <button type="button" onClick={close}>Fermer</button>
              </header>

              {other && (
                <div className="advent-variants" role="tablist" aria-label="Version du défi">
                  {variants.map((item, position) => (
                    <button
                      key={item.key}
                      type="button"
                      role="tab"
                      aria-selected={position === index}
                      className={position === index ? "is-active" : ""}
                      onClick={() => position !== index && swap(position > index ? -1 : 1)}
                    >
                      {item.label}
                    </button>
                  ))}
                </div>
              )}

              <h2>{variant.title}</h2>

              {renderBody(variant)}

              {other && (
                <p className="advent-swipe-hint">
                  Glisse la carte pour la version {other.label.toLowerCase()}
                </p>
              )}
            </div>

            <span className="advent-reveal-back" aria-hidden="true">✦</span>
          </div>
        </section>
      </div>
    </div>,
    document.body
  );
}
