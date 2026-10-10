// Appareil photo au trait, dans le style des icônes de l'accueil,
// avec le losange Protocol en guise de flash.
export default function CameraIcon({ size = 22, strokeWidth = 1.6 }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={strokeWidth}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M3.5 9A2.5 2.5 0 0 1 6 6.5h1.7l1.4-2a1.5 1.5 0 0 1 1.2-.6h3.4a1.5 1.5 0 0 1 1.2.6l1.4 2H18A2.5 2.5 0 0 1 20.5 9v8a2.5 2.5 0 0 1-2.5 2.5H6A2.5 2.5 0 0 1 3.5 17Z" />
      <circle cx="12" cy="13" r="3.6" />
      <path d="M17.6 8.9l.8.8-.8.8-.8-.8Z" fill="currentColor" strokeWidth="1" />
    </svg>
  );
}
