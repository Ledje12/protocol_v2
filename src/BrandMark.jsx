/*
 * Logo PROTOCOL : une seule version dans toute l'app
 * (Bodoni espacée + filet néon). Voir .protocol-brand.
 */
export default function BrandMark({ size = "md" }) {
  return (
    <div
      className={`protocol-brand protocol-brand-${size}`}
    >
      <span className="protocol-brand-name">
        PROTOCOL
      </span>
    </div>
  );
}
