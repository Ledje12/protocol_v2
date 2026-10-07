/*
 * Dates « intimes » plutôt qu'administratives :
 * « Il y a 12 min », « Hier, 21:11 », « Samedi, 19:11 »,
 * puis la date courte au-delà d'une semaine.
 */

const LOCALE = "fr-BE";

function startOfDay(date) {
  const copy = new Date(date);
  copy.setHours(0, 0, 0, 0);
  return copy;
}

function timeOfDay(date) {
  return new Intl.DateTimeFormat(LOCALE, {
    hour: "2-digit",
    minute: "2-digit",
  }).format(date);
}

/*
 * style "relative" : « Il y a 12 min » (listes)
 * style "clock"    : « 20:41 » le jour même (bulles)
 * lower            : première lettre en minuscule
 *                    (« Vue il y a 2 h »)
 */
export function formatRelativeTime(
  value,
  { style = "relative", lower = false } = {}
) {
  if (!value) {
    return "";
  }

  try {
    const date = new Date(value);
    const now = new Date();
    const minutes = Math.round((now - date) / 60000);
    const days = Math.round(
      (startOfDay(now) - startOfDay(date)) / 86400000
    );

    let text;

    if (days === 0) {
      if (style === "clock") {
        text = timeOfDay(date);
      } else if (minutes < 1) {
        text = "À l'instant";
      } else if (minutes < 60) {
        text = `Il y a ${minutes} min`;
      } else {
        text = `Il y a ${Math.floor(minutes / 60)} h`;
      }
    } else if (days === 1) {
      text = `Hier, ${timeOfDay(date)}`;
    } else if (days < 7) {
      const weekday = new Intl.DateTimeFormat(LOCALE, {
        weekday: "long",
      }).format(date);

      text = `${weekday.charAt(0).toUpperCase()}${weekday.slice(1)}, ${timeOfDay(date)}`;
    } else {
      text = new Intl.DateTimeFormat(LOCALE, {
        day: "numeric",
        month: "short",
      }).format(date);
    }

    return lower
      ? text.charAt(0).toLowerCase() + text.slice(1)
      : text;
  } catch {
    return "";
  }
}
