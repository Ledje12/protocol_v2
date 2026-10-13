import { useCallback, useEffect, useRef, useState } from "react";

import CameraIcon from "./CameraIcon.jsx";
import { AlbumKeySheet, PhotoThumb, PhotoViewer } from "./PhotoAlbum.jsx";
import { SettingsSheet } from "./SettingsParts.jsx";
import { getSavedAlbumKey, uploadPhoto } from "./photoAlbum.js";

/* Photos d'une carte : picto 📷 discret.
   En jeu (canTake) : prendre une photo, rangée chiffrée dans
   l'album (sans message), et revoir celles déjà prises sur cette
   carte. Dans le récap : seulement les revoir.
   La photo illustre la carte, pas une partie précise. */

export const PHOTO_COLUMNS = "id, couple_id, created_at, mime, width, height, card_source, card_id";

// le duo ne change pas pendant la session
let coupleIdPromise = null;
const myCoupleId = (supabase) => {
  coupleIdPromise ||= supabase.rpc("protocol_my_couple_id").then(({ data }) => data || null);
  return coupleIdPromise;
};

export const cardKey = (source, id) => `${source || "official"}-${id}`;

export default function CardPhotos({
  supabase,
  cardSource = "official",
  cardId,
  canTake = false,
  photos: givenPhotos, // fournies par le récap (une seule requête)
  onChanged,
  className = "",
}) {
  const [coupleId, setCoupleId] = useState(null);
  const [albumKey, setAlbumKey] = useState(null);
  const [ownPhotos, setOwnPhotos] = useState(null);
  const [sheet, setSheet] = useState(false);
  const [keySheet, setKeySheet] = useState(false);
  const [viewer, setViewer] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const fileRef = useRef(null);

  const photos = givenPhotos ?? ownPhotos;

  useEffect(() => {
    let active = true;

    myCoupleId(supabase).then(async (id) => {
      if (!active || !id) {
        return;
      }

      setCoupleId(id);
      const key = await getSavedAlbumKey(id);
      if (active && key) {
        setAlbumKey(key);
      }
    });

    return () => {
      active = false;
    };
  }, [supabase]);

  const load = useCallback(async () => {
    if (givenPhotos || !cardId) {
      return;
    }

    const { data, error: loadError } = await supabase
      .from("protocol_photos")
      .select(PHOTO_COLUMNS)
      .eq("card_source", cardSource)
      .eq("card_id", cardId)
      .order("created_at", { ascending: true });

    // sans la migration : pas de picto
    setOwnPhotos(loadError ? null : data || []);
  }, [supabase, cardSource, cardId, givenPhotos]);

  useEffect(() => {
    load();
  }, [load]);

  if (!photos || !cardId || (!canTake && photos.length === 0)) {
    return null;
  }

  const refresh = () => {
    load();
    onChanged?.();
  };

  const open = () => {
    setError("");

    if (!albumKey) {
      setKeySheet(true);
      return;
    }

    // une seule photo à revoir : directement en grand
    if (!canTake && photos.length === 1) {
      setViewer(photos[0]);
      return;
    }

    setSheet(true);
  };

  const onFile = async (file) => {
    if (!file) {
      return;
    }

    setBusy(true);
    setError("");

    try {
      await uploadPhoto(supabase, albumKey, file, { source: cardSource, id: cardId });
      refresh();
    } catch (err) {
      console.error("CARD PHOTO ERROR:", err);
      setError(
        /album full/i.test(err?.message || "")
          ? "L’album est plein : supprime quelques photos pour en ajouter."
          : "La photo n’est pas passée. Réessaie dans un instant."
      );
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <button
        type="button"
        className={`card-photos-button ${className}`.trim()}
        onClick={open}
        aria-label={
          photos.length
            ? `${photos.length} photo${photos.length > 1 ? "s" : ""} de cette carte`
            : "Immortaliser ce moment"
        }
      >
        <CameraIcon size={18} />
        {photos.length > 0 && <span>{photos.length}</span>}
      </button>

      {sheet && (
        <SettingsSheet
          eyebrow="CETTE CARTE"
          title={photos.length ? "Vos photos." : "Immortaliser ce moment."}
          onClose={() => setSheet(false)}
        >
          <p className="card-photos-hint">
            Chiffrées et rangées dans votre album, visibles de vous deux
            seulement. Elles restent liées à cette carte.
          </p>

          {photos.length > 0 && (
            <div className="card-photos-grid">
              {photos.map((photo) => (
                <PhotoThumb
                  key={photo.id}
                  supabase={supabase}
                  albumKey={albumKey}
                  photo={photo}
                  onOpen={setViewer}
                  className="album-cell"
                  square
                />
              ))}
            </div>
          )}

          {canTake && (
            <>
              <button
                type="button"
                className="settings-primary-action"
                disabled={busy}
                onClick={() => fileRef.current?.click()}
              >
                <span>{busy ? "Envoi chiffré…" : "Prendre une photo"}</span>
                <CameraIcon size={20} />
              </button>
              <input
                ref={fileRef}
                type="file"
                accept="image/*"
                hidden
                onChange={(event) => {
                  const [file] = event.target.files || [];
                  event.target.value = "";
                  onFile(file);
                }}
              />
            </>
          )}

          {error && <p className="settings-feedback">{error}</p>}
        </SettingsSheet>
      )}

      {keySheet && coupleId && (
        <AlbumKeySheet
          supabase={supabase}
          coupleId={coupleId}
          partnerName="ton partenaire"
          onUnlocked={(key) => {
            setAlbumKey(key);
            setKeySheet(false);
            setSheet(true);
          }}
          onClose={() => setKeySheet(false)}
        />
      )}

      {viewer && albumKey && (
        <PhotoViewer
          supabase={supabase}
          albumKey={albumKey}
          photo={viewer}
          onClose={() => setViewer(null)}
          onDeleted={refresh}
        />
      )}
    </>
  );
}
