import { useEffect, useState } from "react";
import { createPortal } from "react-dom";

import { SettingsSheet } from "./SettingsParts.jsx";
import {
  deletePhoto,
  getAlbumKeyInfo,
  photoFile,
  photoUrl,
  sharePhotoFile,
  unlockAlbum,
} from "./photoAlbum.js";

/* Album photo du duo : phrase secrète, miniatures, plein écran,
   grille. Tout est déchiffré sur le téléphone. */

const formatSize = (bytes) =>
  bytes >= 1024 * 1024 * 1024
    ? `${(bytes / 1024 / 1024 / 1024).toFixed(1).replace(".", ",")} Go`
    : `${Math.max(1, Math.round(bytes / 1024 / 1024))} Mo`;


/* ---------------------------------------------------------
   PHRASE SECRÈTE
   --------------------------------------------------------- */

export function AlbumKeySheet({ supabase, coupleId, partnerName, onUnlocked, onClose }) {
  // null : chargement ; true : première fois ; false : phrase existante
  const [creating, setCreating] = useState(null);
  const [phrase, setPhrase] = useState("");
  const [confirm, setConfirm] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    getAlbumKeyInfo(supabase)
      .then((info) => setCreating(!info))
      .catch(() => setError("L’album n’est pas disponible pour l’instant."));
  }, [supabase]);

  const words = phrase.trim().split(/\s+/).filter(Boolean).length;
  const strongEnough = words >= 4 && phrase.trim().length >= 16;

  const submit = async (event) => {
    event.preventDefault();
    setError("");

    if (creating && !strongEnough) {
      setError("Au moins 4 mots, s’il te plaît : c’est elle qui protège vos photos.");
      return;
    }

    if (creating && phrase.trim().toLowerCase() !== confirm.trim().toLowerCase()) {
      setError("Les deux phrases ne sont pas identiques.");
      return;
    }

    setBusy(true);

    try {
      const key = await unlockAlbum(supabase, coupleId, phrase);

      if (!key) {
        setError(`Ce n’est pas la phrase choisie avec ${partnerName}.`);
        return;
      }

      onUnlocked(key);
    } catch (err) {
      console.error("ALBUM UNLOCK ERROR:", err);
      setError("Impossible d’ouvrir l’album pour l’instant. Réessaie.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <SettingsSheet
      eyebrow="ALBUM PRIVÉ"
      title={creating ? "Votre phrase secrète." : "La phrase du duo."}
      onClose={onClose}
    >
      {creating === null && !error && <p className="album-key-text">Un instant…</p>}

      {creating !== null && (
        <form className="album-key-form" onSubmit={submit}>
          <p className="album-key-text">
            {creating
              ? `Vos photos sont chiffrées sur vos téléphones avec cette phrase : personne d’autre ne peut les voir, pas même le serveur. Choisissez-la ensemble, 4 mots ou plus, et notez-la : perdue, les photos le sont aussi.`
              : `Tape la phrase choisie avec ${partnerName}. Elle reste ensuite sur ce téléphone : tu ne la retaperas plus.`}
          </p>

          <input
            type="password"
            autoComplete="off"
            autoCapitalize="none"
            spellCheck={false}
            placeholder="pivoine marée cobalt vingt"
            value={phrase}
            onChange={(event) => setPhrase(event.target.value)}
            aria-label="Phrase secrète"
          />

          {creating && (
            <input
              type="password"
              autoComplete="off"
              autoCapitalize="none"
              spellCheck={false}
              placeholder="La même, une seconde fois"
              value={confirm}
              onChange={(event) => setConfirm(event.target.value)}
              aria-label="Confirmer la phrase secrète"
            />
          )}

          {error && <p className="envelope-error">{error}</p>}

          <button type="submit" className="primary" disabled={busy || !phrase.trim()}>
            <span>{busy ? "Un instant…" : creating ? "Créer l’album" : "Ouvrir l’album"}</span>
            <span aria-hidden="true">→</span>
          </button>
        </form>
      )}

      {creating === null && error && <p className="envelope-error">{error}</p>}
    </SettingsSheet>
  );
}


/* ---------------------------------------------------------
   MINIATURE
   --------------------------------------------------------- */

export function PhotoThumb({ supabase, albumKey, photo, onOpen, onLocked, className = "", square = false }) {
  const [url, setUrl] = useState(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let active = true;

    if (!albumKey || !photo) {
      return undefined;
    }

    photoUrl(supabase, albumKey, photo, "thumb")
      .then((next) => active && setUrl(next))
      .catch(() => active && setFailed(true));

    return () => {
      active = false;
    };
  }, [supabase, albumKey, photo]);

  const ratio = square
    ? "1 / 1"
    : photo?.width && photo?.height
      ? `${photo.width} / ${photo.height}`
      : "3 / 4";

  return (
    <button
      type="button"
      className={`photo-thumb ${className}`.trim()}
      style={{ aspectRatio: ratio }}
      onClick={() => (albumKey ? onOpen?.(photo) : onLocked?.())}
      aria-label={albumKey ? "Voir la photo" : "Déverrouiller l’album"}
    >
      {url ? (
        <img src={url} alt="" />
      ) : (
        <span className="photo-thumb-lock">
          {!albumKey ? "🔒 Photo privée" : failed ? "Photo illisible" : "…"}
        </span>
      )}
    </button>
  );
}


/* ---------------------------------------------------------
   PLEIN ÉCRAN : enregistrer, supprimer
   --------------------------------------------------------- */

export function PhotoViewer({ supabase, albumKey, photo, onClose, onDeleted }) {
  const [ready, setReady] = useState(null);
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    let active = true;

    photoFile(supabase, albumKey, photo)
      .then((next) => active && setReady(next))
      .catch((err) => {
        console.error("PHOTO OPEN ERROR:", err);
        active && setError("Impossible d’ouvrir cette photo.");
      });

    return () => {
      active = false;
    };
  }, [supabase, albumKey, photo]);

  const remove = async () => {
    setBusy(true);
    setError("");

    try {
      await deletePhoto(supabase, photo);
      onDeleted?.(photo);
      onClose();
    } catch (err) {
      console.error("PHOTO DELETE ERROR:", err);
      setError("La photo n’a pas pu être supprimée.");
      setBusy(false);
    }
  };

  return createPortal(
    <div className="photo-viewer" role="dialog" aria-modal="true" aria-label="Photo">
      <div className="photo-viewer-image">
        {ready ? <img src={ready.url} alt="" /> : <span>{error || "Déchiffrement…"}</span>}
      </div>

      <div className="photo-viewer-actions">
        {confirming ? (
          <>
            <p>Supprimer cette photo pour vous deux ? C’est définitif.</p>
            <button type="button" className="photo-viewer-danger" disabled={busy} onClick={remove}>
              {busy ? "Suppression…" : "Supprimer"}
            </button>
            <button type="button" onClick={() => setConfirming(false)}>Annuler</button>
          </>
        ) : (
          <>
            <button
              type="button"
              className="primary"
              disabled={!ready}
              onClick={() => sharePhotoFile(ready).catch(() => {})}
            >
              <span>Enregistrer</span>
              <span aria-hidden="true">↓</span>
            </button>
            <button type="button" onClick={() => setConfirming(true)}>Supprimer</button>
            <button type="button" onClick={onClose}>Fermer</button>
          </>
        )}
        {error && ready && <p className="envelope-error">{error}</p>}
      </div>
    </div>,
    document.body
  );
}


/* ---------------------------------------------------------
   GRILLE DE L'ALBUM
   --------------------------------------------------------- */

export function AlbumGrid({ supabase, albumKey, refreshKey, onOpen, onLocked }) {
  const [photos, setPhotos] = useState(null);
  const [usage, setUsage] = useState(null);

  useEffect(() => {
    let active = true;

    Promise.all([
      supabase
        .from("protocol_photos")
        .select("id, couple_id, sender_user_id, created_at, mime, width, height")
        .order("created_at", { ascending: false }),
      supabase.rpc("get_protocol_album_usage"),
    ]).then(([list, used]) => {
      if (!active) {
        return;
      }

      setPhotos(list.error ? [] : list.data || []);
      setUsage(used.error ? null : used.data);
    });

    return () => {
      active = false;
    };
  }, [supabase, refreshKey]);

  if (!photos) {
    return <p className="messages-status">Chargement…</p>;
  }

  return (
    <div className="album">
      {photos.length === 0 ? (
        <div className="messages-empty">
          <span className="messages-empty-mark">
            <span className="protocol-diamond" aria-hidden="true" />
          </span>
          <strong>Aucune photo pour l’instant.</strong>
          <p>L’appareil photo de la conversation en envoie une, chiffrée.</p>
        </div>
      ) : (
        <div className="album-grid">
          {photos.map((photo) => (
            <PhotoThumb
              key={photo.id}
              supabase={supabase}
              albumKey={albumKey}
              photo={photo}
              onOpen={onOpen}
              onLocked={onLocked}
              className="album-cell"
              square
            />
          ))}
        </div>
      )}

      {usage && (
        <p className="album-usage">
          {usage.count} photo{usage.count > 1 ? "s" : ""} · {formatSize(Number(usage.used))} sur{" "}
          {formatSize(Number(usage.quota))} · chiffrées sur vos téléphones
        </p>
      )}
    </div>
  );
}
