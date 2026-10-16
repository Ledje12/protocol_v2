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

test("queName pour les phrases de l'app", async () => {
  const { queName } = await import("../../src/personalise.js");
  assert.equal(queName("Audrey"), "qu’Audrey");
  assert.equal(queName("Jérôme"), "que Jérôme");
});

test("pronoms selon le sexe : le / la, il / elle, lui / elle, accord", () => {
  const she = (text) => fillNames(text, { partner: "Audrey" }, { partner: "female" });
  const he = (text) => fillNames(text, { partner: "Jérôme" }, { partner: "male" });

  assert.equal(she("Emmène {{partner}} ailleurs, plaque-{{partner_le}} contre le mur."),
    "Emmène Audrey ailleurs, plaque-la contre le mur.");
  assert.equal(he("plaque-{{partner_le}} contre le mur"), "plaque-le contre le mur");
  assert.equal(she("tu {{partner_le}} regardes, tu {{partner_le}} embrasses"), "tu la regardes, tu l’embrasses");
  assert.equal(he("tu {{partner_le}} embrasses"), "tu l’embrasses");
  assert.equal(she("{{partner_il}} ferme les yeux. {{partner_il}} attend."), "Elle ferme les yeux. Elle attend.");
  assert.equal(he("reste avec {{partner_lui}}, {{partner_il}} sait"), "reste avec lui, il sait");
  assert.equal(she("allongé{{partner_e}} sur le dos"), "allongée sur le dos");
  assert.equal(he("allongé{{partner_e}} sur le dos"), "allongé sur le dos");
  assert.equal(she("C'est {{partner_lui}} qui {{partner_le}} guide."), "C'est elle qui la guide.");
  assert.equal(she("Fais-{{partner_le}} attendre."), "Fais-la attendre.");
});

test("pronoms : sexe inconnu, le prénom à la place", () => {
  const fill = (text) => fillNames(text, { partner: "Audrey" });
  assert.equal(fill("plaque-{{partner_le}} contre le mur"), "plaque Audrey contre le mur");
  assert.equal(fill("{{partner_il}} attend, avec {{partner_lui}}"), "Audrey attend, avec Audrey");
  assert.equal(fill("allongé{{partner_e}}"), "allongé");
});
