import { humanError } from "./networkError.js";

/* Rejoindre une partie ou associer un duo : les refus de la base
   arrivent en anglais technique ; on les dit simplement. */

const GAME_MESSAGES = [
  [/invalid game code|game not found/i, "Aucune partie avec ce code. Vérifie les six caractères."],
  [/already full or unavailable/i, "Cette partie a déjà ses deux joueurs, ou elle est terminée."],
  [/same couple/i, "Cette partie n’a pas été lancée par ton partenaire."],
  [/owner not found/i, "Cette partie n’est plus disponible."],
];

const PAIR_MESSAGES = [
  [/own invitation/i, "C’est ton propre code : envoie-le à l’autre, c’est lui qui le saisit."],
  [/invalid or expired/i, "Code inconnu ou expiré (24 heures). Demande-en un nouveau à l’autre."],
  [/creator already belongs/i, "Ce code a déjà servi : l’autre est déjà associé."],
  [/user already belongs to a couple/i, "Ton compte est déjà associé à un partenaire."],
];

const pick = (table, err, fallback) => {
  const text = `${err?.message || ""} ${err?.details || ""}`;
  const found = table.find(([pattern]) => pattern.test(text));
  return humanError(err, found ? found[1] : fallback);
};

// déjà joueur de cette partie (c'est la sienne) : on l'y emmène
export const isAlreadyInGame = (err) =>
  /already belongs to this game/i.test(err?.message || "");

export const joinGameMessage = (err) =>
  pick(GAME_MESSAGES, err, "Impossible de rejoindre cette partie.");

export const pairMessage = (err) =>
  pick(PAIR_MESSAGES, err, "Association impossible. Réessaie dans un instant.");

/* Code de duo : 10 caractères hexadécimaux. On accepte espaces, tirets
   et minuscules, et la lettre O tapée pour un zéro. */
export const cleanPairCode = (value) =>
  String(value || "")
    .toUpperCase()
    .replace(/O/g, "0")
    .replace(/[^0-9A-F]/g, "")
    .slice(0, 10);

// affichage en deux blocs de cinq, plus facile à recopier ou dicter
export const groupPairCode = (code) =>
  code && code.length > 5 ? `${code.slice(0, 5)} ${code.slice(5)}` : code;
