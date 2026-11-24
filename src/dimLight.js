/* Lumière tamisée : un voile chaud posé sur tout l'écran (mode
   multiply, comme Night Shift) : le blanc vire à l'ambre, le néon au
   rouge sombre, le bleu disparaît. Réglage propre à ce téléphone,
   appliqué dès le chargement par l'attribut data-light de <html>. */

import { useEffect, useState } from "react";

const KEY = "protocol_light";
const EVENT = "protocol-light-change";

export function dimLightOn() {
  try {
    return localStorage.getItem(KEY) === "dim";
  } catch {
    return false;
  }
}

function apply(on) {
  if (typeof document === "undefined") return;
  if (on) document.documentElement.dataset.light = "dim";
  else delete document.documentElement.dataset.light;
  const meta = document.querySelector('meta[name="theme-color"]');
  if (!meta) return;
  if (!meta.dataset.day) meta.dataset.day = meta.getAttribute("content") || "";
  meta.setAttribute("content", on ? "#050203" : meta.dataset.day);
}

export function setDimLight(on) {
  try {
    localStorage.setItem(KEY, on ? "dim" : "day");
  } catch {
    // stockage indisponible : le réglage vaut pour cette ouverture
  }
  apply(on);
  window.dispatchEvent(new Event(EVENT));
}

// au chargement de l'app
apply(dimLightOn());

export function useDimLight() {
  const [on, setOn] = useState(dimLightOn);
  useEffect(() => {
    const sync = () => setOn(dimLightOn());
    window.addEventListener(EVENT, sync);
    return () => window.removeEventListener(EVENT, sync);
  }, []);
  return [on, (value) => setDimLight(value)];
}
