import {
  checkWitness,
  decryptBytes,
  deriveKey,
  encryptBytes,
  loadSavedKey,
  makeThumbnail,
  makeWitness,
  newSalt,
  saveKey,
  stripJpegGps,
} from "./albumCrypto.js";

/* =========================================================
   ALBUM DU DUO : envoyer, afficher, supprimer
   Les fichiers ne transitent que chiffrés (voir albumCrypto.js).
   ========================================================= */

export const BUCKET = "protocol-photos";

const paths = (photo) => ({
  original: `${photo.couple_id}/${photo.id}/original`,
  thumb: `${photo.couple_id}/${photo.id}/thumb`,
});

export const getSavedAlbumKey = (coupleId) =>
  coupleId ? loadSavedKey(coupleId) : Promise.resolve(null);

export async function getAlbumKeyInfo(supabase) {
  const { data, error } = await supabase.rpc("get_protocol_album_key");

  if (error) {
    throw error;
  }

  return data || null;
}

/* Première fois : crée la phrase du duo. Ensuite : vérifie que
   ce téléphone a la même phrase que l'autre. */
export async function unlockAlbum(supabase, coupleId, phrase) {
  let info = await getAlbumKeyInfo(supabase);

  if (!info) {
    const salt = newSalt();
    const key = await deriveKey(phrase, salt);
    const { error } = await supabase.rpc("set_protocol_album_key", {
      p_salt: salt,
      p_check: await makeWitness(key),
    });

    if (!error) {
      await saveKey(coupleId, key);
      return key;
    }

    // l'autre téléphone l'a créée entre-temps : on vérifie avec la sienne
    if (!/already set/i.test(error.message)) {
      throw error;
    }

    info = await getAlbumKeyInfo(supabase);
  }

  const key = await deriveKey(phrase, info.salt);

  if (!(await checkWitness(key, info.check))) {
    return null;
  }

  await saveKey(coupleId, key);
  return key;
}

export async function uploadPhoto(supabase, key, file) {
  const raw = new Uint8Array(await file.arrayBuffer());
  const isJpeg = raw[0] === 0xff && raw[1] === 0xd8;
  const original = isJpeg ? stripJpegGps(raw) : raw;
  const thumb = await makeThumbnail(file);

  const [lockedOriginal, lockedThumb] = await Promise.all([
    encryptBytes(key, original),
    encryptBytes(key, thumb.bytes),
  ]);

  const { data: photo, error } = await supabase.rpc("create_protocol_photo", {
    p_mime: isJpeg ? "image/jpeg" : file.type || "image/jpeg",
    p_byte_size: lockedOriginal.length,
    p_thumb_size: lockedThumb.length,
    p_width: thumb.width,
    p_height: thumb.height,
  });

  if (error) {
    throw error;
  }

  const bucket = supabase.storage.from(BUCKET);
  const options = { contentType: "application/octet-stream", upsert: false };

  for (const [path, bytes] of [
    [photo.thumb_path, lockedThumb],
    [photo.original_path, lockedOriginal],
  ]) {
    const { error: uploadError } = await bucket.upload(path, bytes, options);

    if (uploadError) {
      await bucket.remove([photo.thumb_path, photo.original_path]);
      throw uploadError;
    }
  }

  const { error: finishError } = await supabase.rpc("finish_protocol_photo", {
    p_photo_id: photo.id,
  });

  if (finishError) {
    throw finishError;
  }

  return {
    id: photo.id,
    couple_id: photo.original_path.split("/")[0],
    created_at: new Date().toISOString(),
    mime: isJpeg ? "image/jpeg" : file.type || "image/jpeg",
    width: thumb.width,
    height: thumb.height,
  };
}

// photos déchiffrées, gardées le temps de la session
const cache = new Map();

export async function photoUrl(supabase, key, photo, kind = "thumb") {
  const id = `${photo.id}/${kind}`;

  if (!cache.has(id)) {
    cache.set(
      id,
      (async () => {
        const { data, error } = await supabase.storage
          .from(BUCKET)
          .download(paths(photo)[kind]);

        if (error) {
          throw error;
        }

        const plain = await decryptBytes(key, await data.arrayBuffer());
        const type = kind === "thumb" ? "image/jpeg" : photo.mime || "image/jpeg";
        return URL.createObjectURL(new Blob([plain], { type }));
      })().catch((error) => {
        cache.delete(id);
        throw error;
      })
    );
  }

  return cache.get(id);
}

// Fichier prêt à enregistrer, en qualité d'origine. Préparé à
// l'ouverture de la photo : le partage doit partir directement du
// toucher (Safari refuse sinon).
export async function photoFile(supabase, key, photo) {
  const url = await photoUrl(supabase, key, photo, "original");
  const blob = await (await fetch(url)).blob();
  const name = `protocol-${photo.created_at?.slice(0, 10) || "photo"}-${photo.id.slice(0, 8)}.jpg`;
  return { url, file: new File([blob], name, { type: blob.type || "image/jpeg" }) };
}

// Enregistrer dans Photos (iPhone : « Enregistrer l'image »)
export function sharePhotoFile({ url, file }) {
  if (navigator.canShare?.({ files: [file] })) {
    return navigator.share({ files: [file] });
  }

  const link = document.createElement("a");
  link.href = url;
  link.download = file.name;
  link.click();
  return Promise.resolve();
}

export async function deletePhoto(supabase, photo) {
  const { original, thumb } = paths(photo);
  const { error: removeError } = await supabase.storage
    .from(BUCKET)
    .remove([original, thumb]);

  if (removeError) {
    throw removeError;
  }

  const { error } = await supabase.rpc("delete_protocol_photo", {
    p_photo_id: photo.id,
  });

  if (error) {
    throw error;
  }

  for (const kind of ["thumb", "original"]) {
    const id = `${photo.id}/${kind}`;
    cache.get(id)?.then((url) => URL.revokeObjectURL(url)).catch(() => {});
    cache.delete(id);
  }
}
