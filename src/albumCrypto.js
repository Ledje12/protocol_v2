/* =========================================================
   ALBUM CHIFFRÉ : la cryptographie, sur le téléphone
   - La clé vient de la phrase secrète du duo (PBKDF2-SHA256,
     310 000 tours) et d'un sel propre au duo. Elle ne quitte
     jamais le téléphone : gardée dans IndexedDB, non exportable.
   - Chaque fichier est chiffré en AES-GCM 256 : 12 octets de
     vecteur aléatoire, puis le chiffré (authentifié).
   - La base ne reçoit qu'un « témoin » chiffré, pour vérifier
     qu'un téléphone a la même phrase que l'autre.
   ========================================================= */

const ITERATIONS = 310000;
const WITNESS = "protocol-album-v1";

const encoder = new TextEncoder();

export const toBase64 = (bytes) => {
  let text = "";
  bytes.forEach((byte) => {
    text += String.fromCharCode(byte);
  });
  return btoa(text);
};

export const fromBase64 = (text) =>
  Uint8Array.from(atob(text), (char) => char.charCodeAt(0));

// L'iPhone met une majuscule au premier mot, ajoute parfois une
// espace : on ignore casse et espaces pour que la même phrase
// donne la même clé sur les deux téléphones.
export const normalizePhrase = (phrase) =>
  phrase.normalize("NFC").trim().toLowerCase().replace(/\s+/g, " ");

export const newSalt = () =>
  toBase64(crypto.getRandomValues(new Uint8Array(16)));

export async function deriveKey(phrase, salt) {
  const base = await crypto.subtle.importKey(
    "raw",
    encoder.encode(normalizePhrase(phrase)),
    "PBKDF2",
    false,
    ["deriveKey"]
  );

  return crypto.subtle.deriveKey(
    { name: "PBKDF2", salt: fromBase64(salt), iterations: ITERATIONS, hash: "SHA-256" },
    base,
    { name: "AES-GCM", length: 256 },
    false,
    ["encrypt", "decrypt"]
  );
}

export async function encryptBytes(key, bytes) {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const cipher = new Uint8Array(
    await crypto.subtle.encrypt({ name: "AES-GCM", iv }, key, bytes)
  );
  const out = new Uint8Array(iv.length + cipher.length);
  out.set(iv);
  out.set(cipher, iv.length);
  return out;
}

export async function decryptBytes(key, data) {
  const bytes = new Uint8Array(data);
  return new Uint8Array(
    await crypto.subtle.decrypt(
      { name: "AES-GCM", iv: bytes.slice(0, 12) },
      key,
      bytes.slice(12)
    )
  );
}

export const makeWitness = async (key) =>
  toBase64(await encryptBytes(key, encoder.encode(WITNESS)));

export async function checkWitness(key, witness) {
  try {
    const plain = await decryptBytes(key, fromBase64(witness));
    return new TextDecoder().decode(plain) === WITNESS;
  } catch {
    return false;
  }
}


/* ---------------------------------------------------------
   CLÉ GARDÉE SUR CE TÉLÉPHONE (IndexedDB, non exportable)
   --------------------------------------------------------- */

const DB_NAME = "protocol-album";
const STORE = "keys";

function openDb() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, 1);
    request.onupgradeneeded = () => request.result.createObjectStore(STORE);
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

async function withStore(mode, action) {
  const db = await openDb();

  try {
    return await new Promise((resolve, reject) => {
      const transaction = db.transaction(STORE, mode);
      const request = action(transaction.objectStore(STORE));
      transaction.oncomplete = () => resolve(request?.result);
      transaction.onerror = () => reject(transaction.error);
    });
  } finally {
    db.close();
  }
}

// en mémoire aussi : IndexedDB peut être indisponible
// (navigation privée) ; la clé dure alors le temps de la session
const memory = new Map();

export async function loadSavedKey(coupleId) {
  if (memory.has(coupleId)) {
    return memory.get(coupleId);
  }

  try {
    const key = await withStore("readonly", (store) => store.get(coupleId));

    if (key) {
      memory.set(coupleId, key);
    }

    return key || null;
  } catch {
    return null;
  }
}

export async function saveKey(coupleId, key) {
  memory.set(coupleId, key);

  try {
    await withStore("readwrite", (store) => store.put(key, coupleId));
  } catch {
    // pas de stockage durable : la phrase sera redemandée plus tard
  }
}

export async function forgetKey(coupleId) {
  memory.delete(coupleId);

  try {
    await withStore("readwrite", (store) => store.delete(coupleId));
  } catch {
    // rien à effacer
  }
}


/* ---------------------------------------------------------
   PHOTOS : retirer la position GPS, faire une miniature
   --------------------------------------------------------- */

const TYPE_SIZES = { 1: 1, 2: 1, 3: 2, 4: 4, 5: 8, 7: 1, 9: 4, 10: 8 };

// Efface le bloc GPS des métadonnées EXIF d'un JPEG, sans toucher
// à l'image (pas de recompression : qualité d'origine).
export function stripJpegGps(input) {
  const bytes = new Uint8Array(input);

  if (bytes[0] !== 0xff || bytes[1] !== 0xd8) {
    return bytes;
  }

  let offset = 2;

  while (offset + 4 < bytes.length && bytes[offset] === 0xff) {
    const marker = bytes[offset + 1];
    const length = (bytes[offset + 2] << 8) | bytes[offset + 3];

    // APP1 « Exif\0\0 »
    if (
      marker === 0xe1 &&
      bytes[offset + 4] === 0x45 &&
      bytes[offset + 5] === 0x78 &&
      bytes[offset + 6] === 0x69 &&
      bytes[offset + 7] === 0x66
    ) {
      const tiff = offset + 10;
      const view = new DataView(bytes.buffer, bytes.byteOffset);
      const little = view.getUint16(tiff) === 0x4949;
      const u16 = (at) => view.getUint16(at, little);
      const u32 = (at) => view.getUint32(at, little);

      const ifd0 = tiff + u32(tiff + 4);
      const count = u16(ifd0);

      for (let i = 0; i < count; i += 1) {
        const entry = ifd0 + 2 + i * 12;

        if (u16(entry) !== 0x8825) {
          continue;
        }

        const gps = tiff + u32(entry + 8);
        const gpsCount = u16(gps);

        for (let j = 0; j < gpsCount; j += 1) {
          const gpsEntry = gps + 2 + j * 12;
          const size = (TYPE_SIZES[u16(gpsEntry + 2)] || 1) * u32(gpsEntry + 4);

          if (size > 4) {
            const at = tiff + u32(gpsEntry + 8);
            bytes.fill(0, at, Math.min(at + size, bytes.length));
          }

          bytes.fill(0, gpsEntry, gpsEntry + 12);
        }

        // bloc GPS vide
        view.setUint16(gps, 0, little);
      }

      return bytes;
    }

    if (marker === 0xda) {
      break; // début de l'image : plus de métadonnées
    }

    offset += 2 + length;
  }

  return bytes;
}

// Miniature JPEG (640 px max), orientation respectée
export async function makeThumbnail(file) {
  const bitmap = await createImageBitmap(file);
  const scale = Math.min(1, 640 / Math.max(bitmap.width, bitmap.height));
  const canvas = document.createElement("canvas");
  canvas.width = Math.round(bitmap.width * scale);
  canvas.height = Math.round(bitmap.height * scale);
  canvas.getContext("2d").drawImage(bitmap, 0, 0, canvas.width, canvas.height);

  const blob = await new Promise((resolve) =>
    canvas.toBlob(resolve, "image/jpeg", 0.82)
  );

  const result = {
    bytes: new Uint8Array(await blob.arrayBuffer()),
    width: bitmap.width,
    height: bitmap.height,
  };

  bitmap.close?.();
  return result;
}
