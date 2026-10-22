/* Prénoms dans les textes : {{active}}, {{partner}}, {{me}}, {{other}}…
   avec l'élision française devant le prénom (ou le surnom) :
     « de {{partner}} » → « d’Audrey » / « de Candy »
     « d’{{partner}} »  → « de Candy » (et l'inverse)
     « que {{partner}} » → « qu’Audrey » (lorsque, puisque, jusque aussi)
   Voyelle ou h muet : élision ; y suivi d'une voyelle (Yann,
   Yasmine) se comporte comme une consonne, devant une consonne
   (Yves) comme une voyelle.

   Pronoms selon le sexe de la personne (3e argument : { partner: "female" }) :
     {{partner_le}}  → le / la, l’ devant une voyelle (« tu l’embrasses »),
                       sans élision après un trait d'union (« plaque-la »)
     {{partner_il}}  → il / elle
     {{partner_lui}} → lui / elle, pronom tonique (« avec elle », « devant lui »)
     {{partner_e}}   → accord : « allongé{{partner_e}} » → allongé / allongée
   Majuscule en début de phrase. Sexe inconnu : le prénom à la place
   (et rien pour {{partner_e}}). */

const ELIDES = /^(?:[aeiouhàâäéèêëîïôöùûüœæ]|y[^aeiouyàâäéèêëîïôöùûü])/i;

const startsWithVowel = (name) => ELIDES.test(String(name || "").trim());

// « de Jérôme », « d’Audrey »
export const deName = (name) =>
  startsWithVowel(name) ? `d’${name}` : `de ${name}`;

// « que Jérôme », « qu’Audrey »
export const queName = (name) =>
  startsWithVowel(name) ? `qu’${name}` : `que ${name}`;

const escape = (value) => value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

const PRONOUNS = {
  le: { male: "le", female: "la" },
  il: { male: "il", female: "elle" },
  lui: { male: "lui", female: "elle" },
};

const capitalize = (word) => word.charAt(0).toUpperCase() + word.slice(1);

function fillPronouns(text, key, name, sex, apo) {
  const known = sex === "male" || sex === "female";
  let out = text.replaceAll(`{{${key}_e}}`, sex === "female" ? "e" : "");

  for (const [suffix, forms] of Object.entries(PRONOUNS)) {
    const tag = escape(`{{${key}_${suffix}}}`);

    out = out.replace(
      new RegExp(`([.!?…]\\s+|«\\s*)?(-)?${tag}(\\s+)?`, "gu"),
      (match, start, hyphen, space, offset, whole) => {
        const nextWord = space ? whole.slice(offset + match.length) : "";

        // sexe inconnu : le prénom (« plaque Audrey », « avec Audrey ») ;
        // « tu {{partner_le}} vois » n'a pas d'équivalent, on garde « le »
        if (!known && (hyphen || suffix !== "le")) {
          return `${start || ""}${hyphen ? " " : ""}${name}${space || ""}`;
        }

        let word = forms[known ? sex : "male"];

        // « tu l’embrasses », pas après « plaque-la »
        if (suffix === "le" && !hyphen && space && startsWithVowel(nextWord)) {
          word = "l" + apo;
          space = "";
        }

        if (start !== undefined || offset === 0) {
          word = capitalize(word);
        }

        return `${start || ""}${hyphen || ""}${word}${space || ""}`;
      }
    );
  }

  return out;
}

export function fillNames(text, names, sexes = {}) {
  let out = String(text || "");
  // même apostrophe que le reste du texte (droite ou typographique)
  const apo = out.includes("'") && !out.includes("’") ? "'" : "’";

  for (const [key, rawName] of Object.entries(names)) {
    const name = rawName ?? "";
    const tag = escape(`{{${key}}}`);
    const elide = startsWithVowel(name);

    out = fillPronouns(out, key, name, sexes[key], apo);

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
