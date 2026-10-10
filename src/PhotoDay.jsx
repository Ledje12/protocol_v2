import { useCallback, useEffect, useRef, useState } from "react";

/* « À distance » : une journée de défis photo, à tour de rôle.
   Le bandeau vit dans Messages (là où arrivent les photos) ;
   l'accueil n'affiche qu'un rappel quand c'est à toi. */

const LEVELS = ["", "Suggestif", "Sensuel", "Osé", "Explicite"];

// « de Jérôme », « d’Audrey »
const deName = (name) =>
  /^[aeiouyhàâäéèêëîïôöûüœ]/i.test(name || "") ? `d’${name}` : `de ${name}`;

export function usePhotoDay(supabase, { poll = true } = {}) {
  const [day, setDay] = useState(null);

  const refresh = useCallback(async () => {
    const { data, error } = await supabase.rpc("get_photo_day");

    if (!error) {
      setDay(data || null);
    }

    return error ? null : data;
  }, [supabase]);

  useEffect(() => {
    refresh();

    if (!poll) {
      return undefined;
    }

    const timer = window.setInterval(() => {
      if (document.visibilityState === "visible") {
        refresh();
      }
    }, 6000);

    return () => window.clearInterval(timer);
  }, [refresh, poll]);

  return [day, refresh, setDay];
}

export function PhotoDayBanner({
  supabase,
  partnerName,
  albumKey,
  onNeedAlbumKey,
  sendText,
  sendPhoto,
}) {
  const [day, refresh, setDay] = usePhotoDay(supabase);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [confirmStop, setConfirmStop] = useState(false);
  const fileRef = useRef(null);

  if (!day || ["declined", "stopped"].includes(day.status)) {
    return null;
  }

  const run = async (action) => {
    setBusy(true);
    setError("");

    try {
      await action();
      await refresh();
    } catch (err) {
      console.error("PHOTO DAY ERROR:", err);
      setError("Ça n’a pas marché. Réessaie dans un instant.");
    } finally {
      setBusy(false);
    }
  };

  const call = async (name, args) => {
    const { data, error: rpcError } = await supabase.rpc(name, args);

    if (rpcError) {
      throw rpcError;
    }

    setDay(data);
    return data;
  };

  const respond = (accept) =>
    run(async () => {
      await call("respond_photo_day", { p_day_id: day.id, p_accept: accept });
      await sendText(
        accept
          ? "📷 Défis photo : c’est parti. À toi le premier !"
          : "Pas aujourd’hui pour les défis photo."
      );
    });

  const stop = () =>
    run(async () => {
      await call("stop_photo_day", { p_day_id: day.id });
      setConfirmStop(false);
      await sendText("J’arrête les défis photo pour aujourd’hui.");
    });

  const skip = () =>
    run(async () => {
      const turn = day.turn_no;
      await call("skip_photo_turn", { p_day_id: day.id });
      await sendText(`Défi ${turn}/${day.total_turns} : je passe celui-là 🙈`);
    });

  const takePhoto = () => {
    if (!albumKey) {
      onNeedAlbumKey();
      return;
    }

    fileRef.current?.click();
  };

  const onFile = (file) =>
    file &&
    run(async () => {
      const caption = `Défi ${day.turn_no}/${day.total_turns} · ${day.challenge.title.replaceAll("{{partner}}", partnerName)}`;
      const photo = await sendPhoto(file, caption);
      await call("complete_photo_turn", { p_day_id: day.id, p_photo_id: photo.id });
    });

  const tonight = () =>
    run(async () => {
      const { data, error: fnError } = await supabase.functions.invoke("send-invitation", {
        body: { signal: "tonight" },
      });

      if (fnError || !data?.success) {
        throw fnError || new Error(data?.error || "send-invitation");
      }

      setError("Invitation envoyée. À ce soir.");
    });

  const progress = `${Math.min(day.turn_no, day.total_turns)}/${day.total_turns}`;

  return (
    <section className="photo-day" aria-live="polite">
      <p className="photo-day-kicker">
        DÉFIS PHOTO · À DISTANCE
        {day.status === "active" && <span>{progress}</span>}
      </p>

      {day.status === "invited" && !day.started_by_me && (
        <>
          <h2>{partnerName} te lance une journée.</h2>
          <p>
            6 défis photo chacun, à tour de rôle, de plus en plus osés.
            Tu peux toujours passer, sans te justifier.
          </p>
          <div className="photo-day-actions">
            <button type="button" className="primary" disabled={busy} onClick={() => respond(true)}>
              <span>J’accepte</span>
              <span aria-hidden="true">→</span>
            </button>
            <button type="button" disabled={busy} onClick={() => respond(false)}>
              Pas aujourd’hui
            </button>
          </div>
        </>
      )}

      {day.status === "invited" && day.started_by_me && (
        <>
          <h2>En attente {deName(partnerName)}…</h2>
          <p>Dès que l’invitation est acceptée, tu relèves le premier défi.</p>
          <div className="photo-day-actions">
            <button type="button" disabled={busy} onClick={stop}>Annuler</button>
          </div>
        </>
      )}

      {day.status === "active" && day.my_turn && day.challenge && (
        <>
          <span className="photo-day-level">Niveau {day.level} · {LEVELS[day.level]}</span>
          <h2>{day.challenge.title}</h2>
          <p className="photo-day-prompt">
            {day.challenge.prompt.replaceAll("{{partner}}", partnerName)}
          </p>
          <div className="photo-day-actions">
            <button type="button" className="primary" disabled={busy} onClick={takePhoto}>
              <span>{busy ? "Envoi chiffré…" : "Prendre la photo"}</span>
              <span aria-hidden="true">📷</span>
            </button>
            <button type="button" disabled={busy} onClick={skip}>Passer</button>
          </div>
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

      {day.status === "active" && !day.my_turn && (
        <>
          <h2>Au tour {deName(partnerName)}.</h2>
          <p>Son défi est secret jusqu’à sa photo. Tu seras prévenu·e.</p>
        </>
      )}

      {day.status === "finished" && (
        <>
          <h2>Journée terminée.</h2>
          <p>{day.done} photo{day.done > 1 ? "s" : ""} relevée{day.done > 1 ? "s" : ""}. Et maintenant ?</p>
          <div className="photo-day-actions">
            <button type="button" className="primary" disabled={busy} onClick={tonight}>
              <span>Ce soir, on joue ?</span>
              <span aria-hidden="true">→</span>
            </button>
          </div>
        </>
      )}

      {error && <p className="photo-day-note">{error}</p>}

      {day.status === "active" && (
        confirmStop ? (
          <p className="photo-day-stop">
            Arrêter la journée pour vous deux ?{" "}
            <button type="button" disabled={busy} onClick={stop}>Oui, arrêter</button>{" "}
            <button type="button" onClick={() => setConfirmStop(false)}>Non</button>
          </p>
        ) : (
          <button type="button" className="photo-day-stop-link" onClick={() => setConfirmStop(true)}>
            Arrêter les défis
          </button>
        )
      )}
    </section>
  );
}

/* Rappel sur l'accueil : invitation reçue, ou défi à relever */
export function PhotoDayHomeNotice({ supabase, onOpen }) {
  const [day] = usePhotoDay(supabase, { poll: false });

  if (!day) {
    return null;
  }

  const text =
    day.status === "invited" && !day.started_by_me
      ? "Une journée de défis photo t’attend."
      : day.status === "active" && day.my_turn
        ? `Défi photo ${day.turn_no}/${day.total_turns} : à toi.`
        : null;

  if (!text) {
    return null;
  }

  return (
    <button type="button" className="photo-day-notice" onClick={onOpen}>
      <span aria-hidden="true">📷</span>
      <strong>{text}</strong>
      <span aria-hidden="true">→</span>
    </button>
  );
}
