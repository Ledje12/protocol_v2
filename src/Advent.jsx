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

// lueurs qui flottent sur le calendrier (position, taille, couleur)
const BOKEH = [
  [8, 18, 90, "accent", 0], [78, 12, 60, "duel", 3], [52, 34, 120, "accent", 6],
  [20, 58, 70, "duel", 2], [86, 48, 100, "accent", 8], [36, 78, 80, "accent", 4],
  [66, 70, 56, "duel", 10], [12, 92, 110, "accent", 7], [92, 88, 64, "duel", 1],
  [46, 6, 50, "duel", 9],
].map(([x, y, size, tone, delay]) => ({
  left: `${x}%`,
  top: `${y}%`,
  "--size": `${size}px`,
  "--tone": `var(--c-${tone}-rgb)`,
  "--delay": `${-delay * 1.7}s`,
}));

// éclats dorés et rouges qui jaillissent d'une porte qu'on ouvre
const BURST = [0, 36, 72, 108, 144, 180, 216, 252, 288, 324];

const SCRATCHED_KEY = "protocol-advent-scratched";

function readScratched() {
  try {
    return new Set(JSON.parse(localStorage.getItem(SCRATCHED_KEY) || "[]"));
  } catch {
    return new Set();
  }
}

function writeScratched(set) {
  try {
    localStorage.setItem(SCRATCHED_KEY, JSON.stringify([...set]));
  } catch {
    // sans stockage, la carte se regrattera
  }
}

// heure courante, rafraîchie chaque minute (compte à rebours)
function useMinuteClock() {
  const [now, setNow] = useState(() => new Date());

  useEffect(() => {
    const timer = window.setInterval(() => setNow(new Date()), 60000);
    return () => window.clearInterval(timer);
  }, []);

  return now;
}

/* Illustration d'une case (bucket privé, lisible à partir de son
   jour) : lien temporaire, image préchargée pour éviter un flash.
   null si la case n'en a pas. */
async function loadIllustration(supabase, day) {
  const { data, error } = await supabase.storage
    .from("protocol-advent")
    .createSignedUrl(`jour-${String(day).padStart(2, "0")}.webp`, 3600);

  if (error || !data?.signedUrl) {
    return null;
  }

  return new Promise((resolve) => {
    const preload = new Image();
    preload.onload = () => resolve(data.signedUrl);
    preload.onerror = () => resolve(null);
    preload.src = data.signedUrl;
  });
}

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
  // illustration de la case ouverte (lien signé, null si aucune)
  const [image, setImage] = useState(null);
  // cases déjà grattées (aperçu : ce téléphone, le temps de l'écran)
  const [scratched, setScratched] = useState(readScratched);
  const [previewScratched, setPreviewScratched] = useState(() => new Set());
  const now = useMinuteClock();
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
    setImage(null);
    const imageReady = loadIllustration(supabase, door.day);

    // première ouverture : la porte pivote, la lueur apparaît, puis
    // le défi monte (tout de suite si l'animation est désactivée)
    const calm = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;

    if (!door.opened && !calm) {
      setOpening(door.day);
      // la carte sort quand la porte est grande ouverte
      await new Promise((resolve) => window.setTimeout(resolve, 520));
      window.setTimeout(() => setOpening(null), 600);
    }

    const from = calm ? null : element?.getBoundingClientRect();
    setImage(await imageReady);
    setOpen({ day: door.day, from });

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
        current.black_prompt && {
          key: "black",
          label: "Noire",
          title: personalise(current.black_title || current.title, current.day),
          prompt: personalise(current.black_prompt, current.day),
        },
      ].filter(Boolean)
    : [];

  const scratchKey = current ? `${advent.year}-${current.day}` : "";
  const isScratched = advent?.preview
    ? previewScratched.has(scratchKey)
    : scratched.has(scratchKey);

  const markScratched = () => {
    if (advent.preview) {
      setPreviewScratched((set) => new Set(set).add(scratchKey));
      return;
    }

    setScratched((set) => {
      const next = new Set(set).add(scratchKey);
      writeScratched(next);
      return next;
    });
  };

  // prochaine case à minuit (heure du téléphone)
  const untilNext = (() => {
    const midnight = new Date(now);
    midnight.setHours(24, 0, 0, 0);
    const minutes = Math.max(1, Math.round((midnight - now) / 60000));
    const hours = Math.floor(minutes / 60);
    return hours > 0
      ? `${hours} h ${String(minutes % 60).padStart(2, "0")}`
      : `${minutes} min`;
  })();
  const doneCount = doors.filter((door) => door.done).length;

  return (
    <main className="app protocol-settings-page advent-page">
      <div className="advent-bokeh" aria-hidden="true">
        {BOKEH.map((spot, position) => (
          <span key={position} style={spot} />
        ))}
      </div>

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
                {advent.today < 24 && (
                  <span className="advent-countdown"> Prochaine case dans {untilNext}.</span>
                )}
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
                      door.has_black ? "has-black" : "",
                      opening === day ? "is-opening" : "",
                      denied === day ? "is-denied" : "",
                    ]
                      .filter(Boolean)
                      .join(" ")}
                    onClick={(event) => openDoor(door, event.currentTarget)}
                    aria-label={`Case ${day}${door.unlocked ? "" : ", scellée"}${door.done ? ", défi relevé" : ""}`}
                  >
                    <span className="advent-door-inside" aria-hidden="true">✦</span>
                    {opening === day && (
                      <span className="advent-door-burst" aria-hidden="true">
                        {BURST.map((angle) => (
                          <i key={angle} style={{ "--angle": `${angle}deg` }} />
                        ))}
                      </span>
                    )}
                    <span className="advent-door-leaf">
                      <span className="advent-door-number">{day}</span>
                      {door.done && <span className="advent-door-mark" aria-hidden="true">✓</span>}
                      {door.has_black && (
                        <span className="advent-door-black" aria-label="carte noire" />
                      )}
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
          image={image}
          scratched={isScratched}
          onScratched={markScratched}
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
   pivotant légèrement, puis se retourne.
   Illustration : la carte montre d'abord une image recouverte d'une
   feuille dorée à gratter ; un toucher sur l'image la retourne sur
   le défi.
   Plusieurs versions (Douce, Osée, Noire) : on fait glisser la carte
   à gauche ou à droite, ou on touche l'étiquette ; la suivante est
   posée juste derrière. */
const SWIPE_THRESHOLD = 70;

const VARIANT_CLASS = { bold: "is-bold", black: "is-black" };

function AdventReveal({
  from,
  kicker,
  variants,
  initial,
  image,
  scratched,
  onScratched,
  onClose,
  renderBody,
}) {
  const cardRef = useRef(null);
  const dragRef = useRef(null);
  const [settled, setSettled] = useState(!from);
  const [leaving, setLeaving] = useState(false);
  const [stage, setStage] = useState(image ? "image" : "text");
  const [turning, setTurning] = useState(false);
  const [index, setIndex] = useState(() =>
    Math.max(0, variants.findIndex((variant) => variant.key === initial))
  );
  const onCloseRef = useRef(onClose);

  useEffect(() => {
    onCloseRef.current = onClose;
  });

  const count = variants.length;
  const variant = variants[Math.min(index, count - 1)];
  const next = count > 1 ? variants[(index + 1) % count] : null;

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

  /* l'illustration se retourne sur le défi, sur un vrai toucher :
     pas un glissé, ni la fin d'un grattage énergique */
  const tapRef = useRef({ x: 0, y: 0, at: 0 });
  const scratchedAtRef = useRef(scratched ? 0 : Infinity);

  useEffect(() => {
    if (scratched && scratchedAtRef.current === Infinity) {
      scratchedAtRef.current = Date.now();
    }
  }, [scratched]);

  const onImagePointerDown = (event) => {
    tapRef.current = { x: event.clientX, y: event.clientY, at: Date.now() };
  };

  const onImageClick = (event) => {
    const tap = tapRef.current;
    const moved = Math.hypot(event.clientX - tap.x, event.clientY - tap.y);

    if (moved > 12 || Date.now() - scratchedAtRef.current < 600) {
      return;
    }

    turnToText();
  };

  const turnToText = () => {
    setTurning(true);

    window.setTimeout(() => {
      setStage("text");
      setTurning(false);
    }, 200);
  };

  // la carte part d'un côté, la version suivante (ou précédente)
  // arrive de l'autre
  const swap = (direction, target = null) => {
    const card = cardRef.current;

    if (!card || count < 2) {
      return;
    }

    card.style.transition = "transform 0.22s ease-in";
    card.style.transform = `translateX(${direction * 120}%) rotate(${direction * 14}deg)`;

    window.setTimeout(() => {
      setIndex((value) =>
        target ?? (direction < 0 ? (value + 1) % count : (value - 1 + count) % count)
      );
      card.style.transition = "none";
      card.style.transform = `translateX(${-direction * 60}%) rotate(${-direction * 8}deg)`;
      card.getBoundingClientRect();
      card.style.transition = "transform 0.38s cubic-bezier(0.2, 0.85, 0.25, 1)";
      card.style.transform = "";
    }, 220);
  };

  const onPointerDown = (event) => {
    if (!settled || count < 2 || stage !== "text" || event.target.closest("button")) {
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

  const showImage = stage === "image" && image;

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
        {next && settled && stage === "text" && (
          <div
            className={["advent-reveal-peek", VARIANT_CLASS[next.key] || ""].join(" ")}
            aria-hidden="true"
          >
            <span>{next.label}</span>
          </div>
        )}

        <section
          ref={cardRef}
          className={[
            "advent-reveal-card",
            settled ? "is-settled" : "",
            showImage ? "" : VARIANT_CLASS[variant.key] || "",
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
          <div className={turning ? "advent-reveal-inner is-turning" : "advent-reveal-inner"}>
            {showImage ? (
              <div className="advent-reveal-face is-image">
                <img
                  src={image}
                  alt=""
                  draggable="false"
                  onPointerDown={onImagePointerDown}
                  onClick={scratched ? onImageClick : undefined}
                />

                <header className="advent-reveal-head">
                  <span>{kicker}</span>
                  <button type="button" onClick={close}>Fermer</button>
                </header>

                {scratched ? (
                  <button type="button" className="advent-image-turn" onClick={turnToText}>
                    Toucher pour lire le défi
                  </button>
                ) : (
                  settled && <ScratchFoil onDone={onScratched} />
                )}
              </div>
            ) : (
              <div className="advent-reveal-face">
                <header className="advent-reveal-head">
                  <span>{kicker}</span>
                  <button type="button" onClick={close}>Fermer</button>
                </header>

                {count > 1 && (
                  <div className="advent-variants" role="tablist" aria-label="Version du défi">
                    {variants.map((item, position) => (
                      <button
                        key={item.key}
                        type="button"
                        role="tab"
                        aria-selected={position === index}
                        className={position === index ? "is-active" : ""}
                        onClick={() =>
                          position !== index && swap(position > index ? -1 : 1, position)
                        }
                      >
                        {item.label}
                      </button>
                    ))}
                  </div>
                )}

                <h2>{variant.title}</h2>

                {renderBody(variant)}

                {next && (
                  <p className="advent-swipe-hint">
                    Glisse la carte : version {next.label.toLowerCase()}
                  </p>
                )}
              </div>
            )}

            <span className="advent-reveal-back" aria-hidden="true">✦</span>
          </div>
        </section>
      </div>
    </div>,
    document.body
  );
}

/* Feuille dorée à gratter du doigt, posée sur l'illustration. Au-delà
   de la moitié grattée, elle s'efface d'elle-même. */
const SCRATCH_DONE = 0.42;

function ScratchFoil({ onDone }) {
  const canvasRef = useRef(null);
  const lastRef = useRef(null);
  const movesRef = useRef(0);
  const [clearing, setClearing] = useState(false);

  useEffect(() => {
    const canvas = canvasRef.current;
    const box = canvas.getBoundingClientRect();
    const ratio = window.devicePixelRatio || 1;

    canvas.width = Math.round(box.width * ratio);
    canvas.height = Math.round(box.height * ratio);

    const context = canvas.getContext("2d");
    context.scale(ratio, ratio);

    // dorure : dégradé, losanges Art déco, invitation à gratter
    const gold = context.createLinearGradient(0, 0, box.width, box.height);
    gold.addColorStop(0, "#9c7840");
    gold.addColorStop(0.35, "#efd6b0");
    gold.addColorStop(0.55, "#c9a467");
    gold.addColorStop(1, "#8a6a36");
    context.fillStyle = gold;
    context.fillRect(0, 0, box.width, box.height);

    context.strokeStyle = "rgba(255, 244, 220, 0.25)";
    context.lineWidth = 1;
    for (let x = -box.height; x < box.width; x += 22) {
      context.beginPath();
      context.moveTo(x, 0);
      context.lineTo(x + box.height, box.height);
      context.moveTo(x + box.height, 0);
      context.lineTo(x, box.height);
      context.stroke();
    }

    context.fillStyle = "rgba(40, 20, 10, 0.75)";
    context.textAlign = "center";
    context.font = "64px serif";
    context.fillText("✦", box.width / 2, box.height / 2 - 10);
    context.font = "600 13px system-ui, sans-serif";
    context.fillText("GRATTE LA CARTE", box.width / 2, box.height / 2 + 34);
  }, []);

  const clearedShare = () => {
    const canvas = canvasRef.current;
    const { data } = canvas
      .getContext("2d")
      .getImageData(0, 0, canvas.width, canvas.height);
    let clear = 0;
    let total = 0;

    for (let i = 3; i < data.length; i += 4 * 24) {
      total += 1;
      if (data[i] === 0) {
        clear += 1;
      }
    }

    return clear / total;
  };

  const scratch = (event) => {
    const canvas = canvasRef.current;
    const box = canvas.getBoundingClientRect();
    const point = { x: event.clientX - box.left, y: event.clientY - box.top };
    const context = canvas.getContext("2d");

    // trait plein : il efface entièrement la dorure sous le doigt
    context.globalCompositeOperation = "destination-out";
    context.strokeStyle = "#000";
    context.globalAlpha = 1;
    context.lineCap = "round";
    context.lineJoin = "round";
    context.lineWidth = 56;
    context.beginPath();
    context.moveTo((lastRef.current || point).x, (lastRef.current || point).y);
    context.lineTo(point.x, point.y);
    context.stroke();
    lastRef.current = point;

    movesRef.current += 1;

    if (movesRef.current % 8 === 0) {
      navigator.vibrate?.(6);

      if (!clearing && clearedShare() > SCRATCH_DONE) {
        setClearing(true);
        window.setTimeout(onDone, 450);
      }
    }
  };

  return (
    <canvas
      ref={canvasRef}
      className={clearing ? "advent-foil is-clearing" : "advent-foil"}
      aria-label="Gratte la carte pour découvrir l’illustration"
      onPointerDown={(event) => {
        event.stopPropagation();
        event.currentTarget.setPointerCapture(event.pointerId);
        lastRef.current = null;
        scratch(event);
      }}
      onPointerMove={(event) => {
        event.stopPropagation();
        if (event.buttons || event.pointerType === "touch") {
          scratch(event);
        }
      }}
      onPointerUp={() => {
        lastRef.current = null;
      }}
    />
  );
}
