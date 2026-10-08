import { useEffect, useRef } from "react";
import { createPortal } from "react-dom";

// Briques de l'écran Réglages : groupes, lignes et panneau de
// détail (les explications longues ne s'affichent qu'à la demande).

export function SettingsGroup({ title, children }) {
  return (
    <section className="settings-group">
      <h2 className="settings-group-title">
        <span aria-hidden="true" />
        {title}
      </h2>

      <div className="settings-list">{children}</div>
    </section>
  );
}

/* Une ligne : libellé à gauche, état à droite, flèche si elle
   ouvre quelque chose. Sans onClick, la ligne est un simple
   conteneur (pour un choix posé directement dans la liste). */
export function SettingsRow({
  label,
  hint,
  value,
  tone,
  onClick,
  disabled,
  danger,
  children,
}) {
  const content = (
    <>
      <span className="settings-row-main">
        <span className="settings-row-label">{label}</span>
        {hint && <span className="settings-row-hint">{hint}</span>}
      </span>

      {value && (
        <span
          className={
            tone ? `settings-row-value is-${tone}` : "settings-row-value"
          }
        >
          {tone && <span className="settings-row-dot" aria-hidden="true" />}
          {value}
        </span>
      )}

      {onClick && !danger && (
        <span className="settings-row-arrow" aria-hidden="true">
          →
        </span>
      )}
    </>
  );

  if (onClick) {
    return (
      <button
        type="button"
        className={danger ? "settings-row is-danger" : "settings-row"}
        onClick={onClick}
        disabled={disabled}
      >
        {content}
      </button>
    );
  }

  return (
    <div className="settings-row is-static">
      <div className="settings-row-line">{content}</div>
      {children}
    </div>
  );
}

export function SettingsSheet({ eyebrow, title, onClose, children }) {
  const sheetRef = useRef(null);

  // onClose change à chaque rendu : on garde la dernière version
  // sans relancer l'effet (sinon le focus quitterait les champs)
  const onCloseRef = useRef(onClose);

  useEffect(() => {
    onCloseRef.current = onClose;
  });

  useEffect(() => {
    sheetRef.current?.focus();

    const onKey = (event) => {
      if (event.key === "Escape") {
        onCloseRef.current();
      }
    };

    document.addEventListener("keydown", onKey);

    return () => document.removeEventListener("keydown", onKey);
  }, []);

  return createPortal(
    <div
      className="howto-overlay settings-sheet-overlay"
      onClick={(event) => {
        if (event.target === event.currentTarget) {
          onClose();
        }
      }}
    >
      <section
        ref={sheetRef}
        className="howto-sheet settings-sheet"
        role="dialog"
        aria-modal="true"
        aria-label={title}
        tabIndex={-1}
      >
        <header className="howto-head">
          <span className="howto-step">{eyebrow}</span>

          <button type="button" className="howto-skip" onClick={onClose}>
            Fermer
          </button>
        </header>

        <h2 className="settings-sheet-title">{title}</h2>

        <div className="settings-sheet-body">{children}</div>
      </section>
    </div>,
    document.body
  );
}
