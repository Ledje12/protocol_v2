/* Petits sons de partie, synthétisés (aucun fichier à charger).

   - Web Audio en session « ambient » : sur iPhone, le mode silence
     les coupe, et ils se mêlent à la musique au lieu de la couper.
   - Le navigateur n'autorise le son qu'après un premier toucher :
     le contexte audio est réveillé au premier geste sur la page.
   - Réglage « Sons » sur ce téléphone (activé par défaut). */

const SOUND_KEY = "protocol_sounds";

let ctx = null;

export function soundsEnabled() {
  try {
    return localStorage.getItem(SOUND_KEY) !== "off";
  } catch {
    return true;
  }
}

export function setSoundsEnabled(on) {
  try {
    localStorage.setItem(SOUND_KEY, on ? "on" : "off");
  } catch {
    // stockage indisponible : le réglage durera le temps de la session
  }
}

function audio() {
  if (ctx) return ctx;
  const AudioCtx = typeof window !== "undefined" && (window.AudioContext || window.webkitAudioContext);
  if (!AudioCtx) return null;
  try {
    if (navigator.audioSession) navigator.audioSession.type = "ambient";
  } catch {
    // Safari ancien : comportement par défaut
  }
  ctx = new AudioCtx();
  return ctx;
}

// réveil au premier geste (exigence des navigateurs)
if (typeof window !== "undefined") {
  const unlock = () => {
    const c = audio();
    if (c && c.state === "suspended") c.resume().catch(() => {});
    if (c && c.state === "running") {
      window.removeEventListener("pointerdown", unlock, true);
      window.removeEventListener("touchend", unlock, true);
    }
  };
  window.addEventListener("pointerdown", unlock, true);
  window.addEventListener("touchend", unlock, true);
}

// une note douce : attaque courte, longue extinction, un soupçon d'harmonique
function note(c, freq, start, { length = 1.2, volume = 0.09, type = "sine" } = {}) {
  const out = c.createGain();
  out.gain.setValueAtTime(0.0001, start);
  out.gain.exponentialRampToValueAtTime(volume, start + 0.02);
  out.gain.exponentialRampToValueAtTime(0.0001, start + length);
  out.connect(c.destination);

  const main = c.createOscillator();
  main.type = type;
  main.frequency.setValueAtTime(freq, start);
  main.connect(out);

  const shine = c.createOscillator();
  const shineGain = c.createGain();
  shine.type = "sine";
  shine.frequency.setValueAtTime(freq * 2, start);
  shineGain.gain.setValueAtTime(0.18, start);
  shine.connect(shineGain).connect(out);

  main.start(start);
  shine.start(start);
  main.stop(start + length + 0.05);
  shine.stop(start + length + 0.05);
}

const SOUNDS = {
  // nouvelle carte : deux notes graves et feutrées
  card: (c, t) => {
    note(c, 220, t, { length: 1.4, volume: 0.07 });
    note(c, 330, t + 0.09, { length: 1.3, volume: 0.05 });
  },
  // duel gagné : petite montée scintillante
  win: (c, t) => {
    note(c, 523.25, t, { length: 0.9, volume: 0.07 });
    note(c, 659.25, t + 0.12, { length: 0.9, volume: 0.07 });
    note(c, 783.99, t + 0.24, { length: 1.5, volume: 0.08 });
  },
  // fin de partie : l'enseigne s'éteint, trois notes qui descendent
  close: (c, t) => {
    note(c, 392, t, { length: 1.2, volume: 0.06 });
    note(c, 293.66, t + 0.5, { length: 1.4, volume: 0.06 });
    note(c, 196, t + 1.1, { length: 2.2, volume: 0.07 });
  },
  // fin du minuteur : cloche douce, deux fois
  timer: (c, t) => {
    note(c, 587.33, t, { length: 1.6, volume: 0.1, type: "triangle" });
    note(c, 587.33, t + 0.7, { length: 1.8, volume: 0.09, type: "triangle" });
  },
};

export function playSound(name) {
  if (!soundsEnabled()) return;
  const c = audio();
  const sound = SOUNDS[name];
  if (!c || !sound || c.state !== "running") return;
  try {
    sound(c, c.currentTime + 0.02);
  } catch {
    // le son n'est jamais bloquant
  }
}
