/* =========================================================
   PROTOCOL
   CARD PERSONALIZATION
   ========================================================= */

const PEOPLE = {
  jerome: {
    key: "jerome",
    name: "Jérôme",
    sex: "male",
    subjectPronoun: "il",
    objectPronoun: "lui",
  },

  audrey: {
    key: "audrey",
    name: "Audrey",
    sex: "female",
    subjectPronoun: "elle",
    objectPronoun: "elle",
  },
};


/* =========================================================
   GET PERSON
   ========================================================= */

export function getPerson(ownerKey) {
  return PEOPLE[ownerKey] || null;
}


/* =========================================================
   GET PARTNER
   ========================================================= */

export function getPartner(ownerKey) {
  if (ownerKey === "jerome") {
    return PEOPLE.audrey;
  }

  if (ownerKey === "audrey") {
    return PEOPLE.jerome;
  }

  return null;
}


/* =========================================================
   CARD COMPATIBILITY
   ========================================================= */

export function isCardCompatible(
  card,
  viewerKey
) {
  const viewer =
    getPerson(viewerKey);

  if (!viewer || !card) {
    return false;
  }

  /*
   * Une carte sans target_sex
   * convient aux deux.
   */

  if (!card.target_sex) {
    return true;
  }

  /*
   * Une carte sexuée doit correspondre
   * à la personne qui exécute la carte.
   */

  return (
    card.target_sex === viewer.sex
  );
}


/* =========================================================
   PERSONALIZE PROMPT
   ========================================================= */

export function personalizeCardPrompt(
  prompt,
  viewerKey
) {
  if (!prompt) {
    return "";
  }

  const active =
    getPerson(viewerKey);

  const partner =
    getPartner(viewerKey);

  if (!active || !partner) {
    return prompt;
  }

  let text =
    String(prompt);


  /* ---------------------------------------------------------
     PLACEHOLDERS
     --------------------------------------------------------- */

  text = text
    .replace(
      /\{\{active\}\}/gi,
      active.name
    )
    .replace(
      /\{\{partner\}\}/gi,
      partner.name
    );


  /* ---------------------------------------------------------
     PRONOMS GENRES
     
     On traite uniquement les formulations
     explicitement génériques présentes dans
     les cartes.
     --------------------------------------------------------- */

  if (partner.sex === "female") {

    text = text
      .replace(
        /\bil ou elle\b/gi,
        "elle"
      )
      .replace(
        /\belle ou il\b/gi,
        "elle"
      )
      .replace(
        /\blui ou elle\b/gi,
        "elle"
      )
      .replace(
        /\belle ou lui\b/gi,
        "elle"
      );

  } else {

    text = text
      .replace(
        /\bil ou elle\b/gi,
        "il"
      )
      .replace(
        /\belle ou il\b/gi,
        "il"
      )
      .replace(
        /\blui ou elle\b/gi,
        "lui"
      )
      .replace(
        /\belle ou lui\b/gi,
        "lui"
      );
  }


  return text;
}


/* =========================================================
   COMPLETE DISPLAY CARD
   ========================================================= */

export function personalizeCard(
  card,
  viewerKey
) {
  if (!card) {
    return null;
  }

  return {
    ...card,

    displayPrompt:
      personalizeCardPrompt(
        card.prompt,
        viewerKey
      ),

    compatible:
      isCardCompatible(
        card,
        viewerKey
      ),
  };
}