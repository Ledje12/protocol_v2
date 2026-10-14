// Prénoms dans les textes des cartes, avec l'élision française.

import assert from "node:assert/strict";
import { test } from "node:test";

import { deName, fillNames } from "../../src/personalise.js";

const fill = (text, partner) => fillNames(text, { partner });

test("de / d’ selon la première lettre du prénom", () => {
  assert.equal(fill("Pour l'anniversaire de {{partner}}.", "Audrey"), "Pour l'anniversaire d'Audrey.", "apostrophe du texte");
  assert.equal(fill("Pour l’anniversaire de {{partner}}.", "Audrey"), "Pour l’anniversaire d’Audrey.");
  assert.equal(fill("Pour l'anniversaire de {{partner}}.", "Candy"), "Pour l'anniversaire de Candy.");
  assert.equal(fill("Les mains d’{{partner}}.", "Candy"), "Les mains de Candy.");
  assert.equal(fill("Les mains d' {{partner}}.", "Audrey"), "Les mains d'Audrey.");
  assert.equal(fill("De {{partner}}, rien.", "Hugo"), "D’Hugo, rien.");
});

test("que, lorsque, puisque, jusque", () => {
  assert.equal(fill("Dis que {{partner}} décide.", "Audrey"), "Dis qu’Audrey décide.");
  assert.equal(fill("Attends lorsque {{partner}} parle.", "Éva"), "Attends lorsqu’Éva parle.");
  assert.equal(fill("Dis qu’{{partner}} décide.", "Candy"), "Dis que Candy décide.");
});

test("y : Yves s'élide, Yann non ; les autres mots ne bougent pas", () => {
  assert.equal(fill("le regard de {{partner}}", "Yves"), "le regard d’Yves");
  assert.equal(fill("le regard de {{partner}}", "Yann"), "le regard de Yann");
  assert.equal(fill("le monde {{partner}}", "Audrey"), "le monde Audrey");
  assert.equal(fill("pour {{partner}}", "Audrey"), "pour Audrey");
  assert.equal(deName("Audrey"), "d’Audrey");
  assert.equal(deName("Jérôme"), "de Jérôme");
});

test("plusieurs prénoms à la fois", () => {
  assert.equal(
    fillNames("{{active}} embrasse le cou de {{partner}}.", { active: "Jérôme", partner: "Audrey" }),
    "Jérôme embrasse le cou d’Audrey."
  );
});
