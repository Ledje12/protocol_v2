/* Pastille « non lu » de l'accueil (voir unread.js). */

/* pastille façon iOS : nombre, 9+ au-delà */
export default function UnreadBadge({
  count,
  label,
}) {
  if (!count) {
    return null;
  }

  return (
    <i
      className="protocol-badge"
      aria-label={`${count} ${label}`}
    >
      {count > 9 ? "9+" : count}
    </i>
  );
}
