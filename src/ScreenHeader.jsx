/*
 * En-tête des écrans de navigation : un seul modèle.
 * Rond « retour » de 44 px + logo PROTOCOL + sous-titre
 * (pour qui, ou où l'on est). Les écrans de jeu ont leur
 * propre en-tête (logo + score + STOP).
 */
export function BackIcon() {
  return (
    <svg
      width="20"
      height="20"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.6"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M19 12H5" />
      <path d="m11 6-6 6 6 6" />
    </svg>
  );
}

export default function ScreenHeader({
  onBack,
  subtitle,
}) {
  return (
    <header className="screen-topbar">
      <button
        type="button"
        className="screen-back"
        onClick={onBack}
        aria-label="Retour"
      >
        <BackIcon />
      </button>

      <div className="screen-heading">
        <span className="screen-logo">
          PROTOCOL
        </span>

        {subtitle && (
          <span className="screen-subtitle">
            {subtitle}
          </span>
        )}
      </div>
    </header>
  );
}
