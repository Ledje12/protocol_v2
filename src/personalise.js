/* Prénoms dans les textes : {{active}}, {{partner}}, {{me}}, {{other}}…
   avec l'élision française devant le prénom (ou le surnom) :
     « de {{partner}} » → « d’Audrey » / « de Candy »
     « d’{{partner}} »  → « de Candy » (et l'inverse)
     « que {{partner}} » → « qu’Audrey » (lorsque, puisque, jusque aussi)
   Voyelle ou h muet : élision ; y suivi d'une voyelle (Yann,
   Yasmine) se comporte comme une consonne, devant une consonne
   (Yves) comme une voyelle. */

const ELIDES = /^(?:[aeiouhàâäéèêëîïôöùûüœæ]|y[^aeiouyàâäéèêëîïôöùûü])/i;

export const startsWithVowel = (name) => ELIDES.test(String(name || "").trim());

// « de Jérôme », « d’Audrey »
export const deName = (name) =>
  startsWithVowel(name) ? `d’${name}` : `de ${name}`;

const escape = (value) => value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

export function fillNames(text, names) {
  let out = String(text || "");
  // même apostrophe que le reste du texte (droite ou typographique)
  const apo = out.includes("'") && !out.includes("’") ? "'" : "’";

  for (const [key, rawName] of Object.entries(names)) {
    const name = rawName ?? "";
    const tag = escape(`{{${key}}}`);
    const elide = startsWithVowel(name);

    // de / d’ + prénom (avec ou sans espace après l'apostrophe)
    out = out.replace(
      new RegExp(`(^|[^\\p{L}])([Dd])(?:e\\s+|['’]\\s*)${tag}`, "gu"),
      (_, before, d) => `${before}${elide ? `${d}${apo}` : `${d}e `}${name}`
    );

    // que / qu’ (+ lorsque, puisque, jusque) + prénom
    out = out.replace(
      new RegExp(`(^|[^\\p{L}])((?:[Ll]ors|[Pp]uis|[Jj]us)?[Qq]u)(?:e\\s+|['’]\\s*)${tag}`, "gu"),
      (_, before, qu) => `${before}${elide ? `${qu}${apo}` : `${qu}e `}${name}`
    );

    out = out.replaceAll(`{{${key}}}`, name);
  }

  return out;
}
