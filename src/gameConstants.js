// libellés affichés pour un type de carte imposé (bonus « Imposer le type »)
export const TYPE_LABELS = {
  truth: "Vérité",
  action: "Action",
  duel: "Duel",
  scene: "Scène",
};

/* Calibration : 3 niveaux. value = plafond d'intensité des cartes
   (la partie garde le plus bas des deux choix). */
export const INTENSITY_LEVELS = [
  {
    value: 3,
    rank: 1,
    title: "Taquin",
    text: "On se cherche, on se frôle.",
  },
  {
    value: 4,
    rank: 2,
    title: "Coquin",
    text: "On ose davantage.",
  },
  {
    value: 5,
    rank: 3,
    title: "Indécent",
    text: "Plus aucune retenue.",
  },
];

// niveau d'une partie (les anciennes calibrations 1 et 2 = Taquin)
export const levelForIntensity = (intensity) =>
  INTENSITY_LEVELS.find((level) => level.value >= Number(intensity || 0)) ||
  INTENSITY_LEVELS[INTENSITY_LEVELS.length - 1];
