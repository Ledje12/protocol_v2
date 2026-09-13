/* =========================================================
   PROTOCOL
   CARD PERSONALIZATION
   ========================================================= */

const PEOPLE = {
  jerome: {
    key: "jerome",
    name: "Jérôme",
    sex: "male",
  },

  audrey: {
    key: "audrey",
    name: "Audrey",
    sex: "female",
  },
};

/* =========================================================
   PEOPLE HELPERS
   ========================================================= */

export function getPerson(
  personKey
) {
  return PEOPLE[personKey] || null;
}

export function getPartner(
  personKey
) {
  if (personKey === "jerome") {
    return PEOPLE.audrey;
  }

  if (personKey === "audrey") {
    return PEOPLE.jerome;
  }

  return null;
}

/*
 * Personne qui recevra la carte.
 *
 * Exemple :
 * appareil Jérôme -> carte préparée pour Audrey
 * appareil Audrey -> carte préparée pour Jérôme
 */
export function getCardRecipient(
  ownerKey
) {
  return getPartner(ownerKey);
}

/* =========================================================
   COMPATIBILITY
   ========================================================= */

/*
 * IMPORTANT :
 * target_sex correspond à la personne ACTIVE
 * de la carte.
 *
 * Dans la bibliothèque, la personne active est
 * le partenaire auquel on envisage de proposer
 * la carte.
 */
export function isCardCompatibleForRecipient(
  card,
  ownerKey
) {
  if (!card) {
    return false;
  }

  const recipient =
    getCardRecipient(ownerKey);

  if (!recipient) {
    return false;
  }

  /*
   * Carte universelle
   */
  if (!card.target_sex) {
    return true;
  }

  return (
    card.target_sex === recipient.sex
  );
}

/* =========================================================
   TEXT PERSONALIZATION
   ========================================================= */

export function personalizeCardPrompt(
  prompt,
  activeKey
) {
  if (!prompt) {
    return "";
  }

  const active =
    getPerson(activeKey);

  const partner =
    getPartner(activeKey);

  if (!active || !partner) {
    return String(prompt);
  }

  let text =
    String(prompt);

  /*
   * Placeholders explicites
   */
  text = text
    .replace(
      /\{\{active\}\}/gi,
      active.name
    )
    .replace(
      /\{\{partner\}\}/gi,
      partner.name
    );

  /*
   * Pronoms relatifs au partenaire
   *
   * Exemple :
   * "qu'il ou elle remarque"
   * devient :
   * "qu'il remarque" ou "qu'elle remarque"
   */
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
   LIBRARY CARD PERSONALIZATION
   ========================================================= */

/*
 * Dans la bibliothèque :
 *
 * ownerKey = personne qui consulte l'appareil
 *
 * La carte est préparée pour le partenaire.
 *
 * Jérôme consulte :
 * active = Audrey
 * partner = Jérôme
 *
 * Audrey consulte :
 * active = Jérôme
 * partner = Audrey
 */
export function personalizeCardForLibrary(
  card,
  ownerKey
) {
  if (!card) {
    return null;
  }

  const recipient =
    getCardRecipient(ownerKey);

  if (!recipient) {
    return {
      ...card,
      displayPrompt:
        card.prompt || "",
      compatible: false,
      recipient: null,
    };
  }

  return {
    ...card,

    displayPrompt:
      personalizeCardPrompt(
        card.prompt,
        recipient.key
      ),

    compatible:
      isCardCompatibleForRecipient(
        card,
        ownerKey
      ),

    recipient,
  };
}