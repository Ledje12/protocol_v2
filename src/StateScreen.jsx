/*
 * États plein écran (chargement, erreur, accès impossible) :
 * un seul modèle dans toute l'app. Losange de marque,
 * titre en sérif, texte court, une action pleine largeur.
 * Les messages techniques restent dans la console.
 */
export default function StateScreen({
  kind = "error",
  title,
  text,
  actionLabel,
  onAction,
  className = "app",
}) {
  return (
    <main
      className={`${className} protocol-state-page`}
      aria-busy={kind === "loading" ? "true" : undefined}
    >
      <section
        className={`protocol-state protocol-state-${kind}`}
      >
        <span
          className="protocol-diamond"
          aria-hidden="true"
        />

        {title && (
          <h1>
            {title}
          </h1>
        )}

        {text && (
          <p>
            {text}
          </p>
        )}

        {actionLabel && (
          <button
            type="button"
            className="secondary"
            onClick={onAction}
          >
            {actionLabel}
          </button>
        )}
      </section>
    </main>
  );
}
