import { useEffect, useState } from "react";
import { BackIcon } from "./ScreenHeader.jsx";

/* =========================================================
   CUSTOM LIBRARY
   ========================================================= */

  export default function CustomLibraryScreen({
    supabase,
    profile,
    couple,
    onBack,
  }) {
    const coupleId =
      couple?.id ||
      couple?.couple_id ||
      null;

    const [cards, setCards] =
      useState([]);

    const [loading, setLoading] =
      useState(true);

    const [error, setError] =
      useState("");

    const [showForm, setShowForm] =
      useState(false);

    const [saving, setSaving] =
      useState(false);

    const [saveError, setSaveError] =
      useState("");

    const [editingCardId, setEditingCardId] =
      useState(null);

    const [cardActionLoading, setCardActionLoading] =
      useState(null);

    const [form, setForm] =
      useState({
        type: "action",
        title: "",
        prompt: "",
        intensity: 1,
        target_sex: null,
        timer_seconds: "",
      });

    const loadCards = async () => {

      if (!coupleId) {
        setCards([]);
        setLoading(false);
        return;
      }

      try {
        setLoading(true);
        setError("");

        const {
          data,
          error: cardsError,
        } =
          await supabase
            .from(
              "protocol_custom_cards"
            )
            .select(`
              id,
              library_key,
              type,
              title,
              prompt,
              intensity,
              target_sex,
              timer_seconds,
              active,
              created_by,
              created_at,
              updated_at
            `)
            .eq(
              "couple_id",
              coupleId
            )
            .is(
              "deleted_at",
              null
            )
            .order(
              "created_at",
              {
                ascending: false,
              }
            );

        if (cardsError) {
          throw cardsError;
        }

        setCards(
          Array.isArray(data)
            ? data
            : []
        );

      } catch (err) {

        console.error(
          "CUSTOM LIBRARY LOAD ERROR:",
          err
        );

        setCards([]);

        setError(
          err?.message ||
          "Impossible de charger vos cartes."
        );

      } finally {
        setLoading(false);
      }
    };


    useEffect(() => {

      loadCards();

    }, [coupleId]);


    const typeLabel = (type) => {

      if (type === "truth") {
        return "VÉRITÉ";
      }

      if (type === "duel") {
        return "DUEL";
      }

      return "ACTION";
    };


    const targetLabel = (targetSex) => {

      if (targetSex === "female") {
        return "ELLE";
      }

      if (targetSex === "male") {
        return "LUI";
      }

      return "COMMUN";
    };

    const resetForm = () => {

      setForm({
        type: "action",
        title: "",
        prompt: "",
        intensity: 1,
        target_sex: null,
        timer_seconds: "",
      });

      setEditingCardId(null);
      setSaveError("");
    };


    const saveCard = async (event) => {

      event.preventDefault();

      if (!coupleId || !profile?.user_id) {
        setSaveError(
          "Couple ou utilisateur introuvable."
        );
        return;
      }

      const title =
        form.title.trim();

      const prompt =
        form.prompt.trim();

      if (!title || !prompt) {
        setSaveError(
          "Le titre et le texte sont obligatoires."
        );
        return;
      }

      try {

        setSaving(true);
        setSaveError("");

        const payload = {
          couple_id: coupleId,
          created_by:
            profile.user_id,

          type:
            form.type,

          title,
          prompt,

          intensity:
            form.type === "truth"
              ? 1
              : Number(
                  form.intensity
                ),

          target_sex:
            form.target_sex ||
            null,

          timer_seconds:
            form.timer_seconds
              ? Number(
                  form.timer_seconds
                )
              : null,

          active: true,
        };


        if (editingCardId) {

          const {
            error: updateError,
          } =
            await supabase
              .from(
                "protocol_custom_cards"
              )
              .update({
                type:
                  payload.type,

                title:
                  payload.title,

                prompt:
                  payload.prompt,

                intensity:
                  payload.intensity,

                target_sex:
                  payload.target_sex,

                timer_seconds:
                  payload.timer_seconds,
              })
              .eq(
                "id",
                editingCardId
              )
              .eq(
                "couple_id",
                coupleId
              );


          if (updateError) {
            throw updateError;
          }

        } else {

          const {
            error: insertError,
          } =
            await supabase
              .from(
                "protocol_custom_cards"
              )
              .insert(payload);


          if (insertError) {
            throw insertError;
          }

        }


        resetForm();

        setShowForm(false);

        await loadCards();

      } catch (err) {

        console.error(
          "CUSTOM CARD SAVE ERROR:",
          err
        );

        setSaveError(
          err?.message ||
          "Impossible d’enregistrer la carte."
        );

      } finally {

        setSaving(false);

      }
    };

    const editCard = (card) => {

          setForm({
            type:
              card.type || "action",

            title:
              card.title || "",

            prompt:
              card.prompt || "",

            intensity:
              Number(
                card.intensity || 1
              ),

            target_sex:
              card.target_sex || null,

            timer_seconds:
              card.timer_seconds
                ? String(
                    card.timer_seconds
                  )
                : "",
          });

          setEditingCardId(
            card.id
          );

          setSaveError("");

          setShowForm(true);

          window.scrollTo({
            top: 0,
            behavior: "smooth",
          });
        };

        const toggleCardActive = async (card) => {

          try {

            setCardActionLoading(
              card.id
            );

            const {
              error: updateError,
            } =
              await supabase
                .from(
                  "protocol_custom_cards"
                )
                .update({
                  active:
                    !card.active,
                })
                .eq(
                  "id",
                  card.id
                )
                .eq(
                  "couple_id",
                  coupleId
                );


            if (updateError) {
              throw updateError;
            }


            await loadCards();

          } catch (err) {

            console.error(
              "CUSTOM CARD TOGGLE ERROR:",
              err
            );

            setError(
              err?.message ||
              "Impossible de modifier le statut de la carte."
            );

          } finally {

            setCardActionLoading(
              null
            );

          }
        };


        const deleteCard = async (card) => {

          const confirmed =
            window.confirm(
              `Supprimer « ${card.title} » ?`
            );

          if (!confirmed) {
            return;
          }


          try {

            setCardActionLoading(
              card.id
            );

            const {
              error: deleteError,
            } =
              await supabase
                .from(
                  "protocol_custom_cards"
                )
                .update({
                  active: false,
                  deleted_at:
                    new Date().toISOString(),
                })
                .eq(
                  "id",
                  card.id
                )
                .eq(
                  "couple_id",
                  coupleId
                );


            if (deleteError) {
              throw deleteError;
            }


            if (
              editingCardId === card.id
            ) {

              resetForm();

              setShowForm(
                false
              );

            }


            await loadCards();

          } catch (err) {

            console.error(
              "CUSTOM CARD DELETE ERROR:",
              err
            );

            setError(
              err?.message ||
              "Impossible de supprimer la carte."
            );

          } finally {

            setCardActionLoading(
              null
            );

          }
        };


    return (
      <main className="app protocol-settings-page">

        <header className="header protocol-settings-header">

          <button
            className="back protocol-settings-back"
            onClick={onBack}
            aria-label="Retour"
          >
          <BackIcon />
        </button>

          <div className="protocol-settings-heading">
            <span className="logo protocol-settings-logo">
              PROTOCOL
            </span>

            <span className="protocol-settings-subtitle">
              Pour vous deux
            </span>
          </div>

        </header>


        <section className="protocol-settings">

          <section className="protocol-settings-intro">

            <p className="kicker">
              BIBLIOTHÈQUE PERSO
            </p>

            <h1>
              Vos cartes.
              <br />
              Vos règles.
            </h1>

            <p className="intro">
              {loading
                ? "Chargement…"
                : `${cards.length} carte${
                    cards.length > 1
                      ? "s"
                      : ""
                  } personnelle${
                    cards.length > 1
                      ? "s"
                      : ""
                  }`}
            </p>

          </section>

          {coupleId && !showForm && (
            <button
              type="button"
              className="settings-primary-action"
              onClick={() => {
                resetForm();
                setShowForm(true);
              }}
            >
              <span>
                + Nouvelle carte
              </span>

              <span className="settings-action-arrow">
                →
              </span>
            </button>
          )}

          {showForm && (

  <section className="settings-card">

    <div className="settings-card-heading">

      <span className="settings-card-eyebrow">
        {editingCardId
          ? "MODIFIER LA CARTE"
          : "NOUVELLE CARTE"}
      </span>

      <h2>
        {editingCardId
          ? "Ajustez votre carte."
          : "Créez votre carte."}
      </h2>

    </div>


    <form
      onSubmit={saveCard}
      className="custom-card-form"
    >


      <label>
        Titre

        <input
          type="text"
          value={form.title}
          maxLength={120}
          onChange={(event) =>
            setForm(
              (current) => ({
                ...current,
                title:
                  event.target.value,
              })
            )
          }
          placeholder="Ex. La chambre d’hôtel"
          required
        />
      </label>


      <label>
        Texte

        <textarea
          value={form.prompt}
          onChange={(event) =>
            setForm(
              (current) => ({
                ...current,
                prompt:
                  event.target.value,
              })
            )
          }
          rows={6}
          placeholder="Décris exactement la carte…"
          required
        />
      </label>

      <div className="custom-card-form-grid">

      <label>
        Type

        <select
          value={form.type}
          onChange={(event) => {

            const type =
              event.target.value;

            setForm(
              (current) => ({
                ...current,
                type,
                intensity:
                  type === "truth"
                    ? 1
                    : current.intensity,
              })
            );

          }}
        >
          <option value="action">
            Action
          </option>

          <option value="truth">
            Vérité
          </option>

          <option value="duel">
            Duel
          </option>
        </select>
      </label>


      <label>
        Cible

        <select
          value={
            form.target_sex ||
            ""
          }
          onChange={(event) =>
            setForm(
              (current) => ({
                ...current,
                target_sex:
                  event.target.value ||
                  null,
              })
            )
          }
        >
          <option value="">
            Commun
          </option>

          <option value="female">
            Elle
          </option>

          <option value="male">
            Lui
          </option>
        </select>
      </label>

    </div>


      <label>
        Intensité

        <select
          value={
            form.type === "truth"
              ? 1
              : form.intensity
          }
          disabled={
            form.type === "truth"
          }
          onChange={(event) =>
            setForm(
              (current) => ({
                ...current,
                intensity:
                  Number(
                    event.target.value
                  ),
              })
            )
          }
        >
          {[1, 2, 3, 4, 5].map(
            (value) => (
              <option
                key={value}
                value={value}
              >
                {value}
              </option>
            )
          )}
        </select>
      </label>

      <label>
        Durée optionnelle

        <input
          type="number"
          min="1"
          max="3600"
          value={
            form.timer_seconds
          }
          onChange={(event) =>
            setForm(
              (current) => ({
                ...current,
                timer_seconds:
                  event.target.value,
              })
            )
          }
          placeholder="Secondes"
        />
      </label>


      {saveError && (
        <p className="settings-card-copy">
          {saveError}
        </p>
      )}


      <div className="custom-card-form-actions">

      <button
        type="submit"
        className="settings-primary-action custom-card-submit"
        disabled={saving}
      >
        <span>
          {saving
            ? "Enregistrement…"
            : editingCardId
              ? "Enregistrer les modifications"
              : "Créer la carte"}
        </span>

        <span className="settings-action-arrow">
          ✓
        </span>
      </button>


      <button
        type="button"
        className="custom-card-cancel"
        disabled={saving}
        onClick={() => {
          resetForm();
          setShowForm(false);
        }}
      >
        Annuler
      </button>

</div>
    </form>

  </section>

)}

          {!coupleId && (

            <section className="settings-card">

              <div className="settings-card-heading">

                <span className="settings-card-eyebrow">
                  PARTENAIRE
                </span>

                <h2>
                  Duo requis.
                </h2>

              </div>

              <p className="settings-card-copy">
                Associez d’abord un partenaire
                pour créer une bibliothèque privée.
              </p>

            </section>

          )}


          {error && (

            <section className="settings-card">

              <div className="settings-card-heading">

                <span className="settings-card-eyebrow">
                  ERREUR
                </span>

                <h2>
                  Impossible de charger.
                </h2>

              </div>

              <p className="settings-card-copy">
                {error}
              </p>

              <button
                type="button"
                className="settings-primary-action"
                onClick={loadCards}
              >
                <span>
                  Réessayer
                </span>

                <span className="settings-action-arrow">
                  ↻
                </span>
              </button>

            </section>

          )}


          {!loading &&
            !error &&
            coupleId &&
            cards.length === 0 && (

              <section className="settings-card">

                <div className="settings-card-heading">

                  <span className="settings-card-eyebrow">
                    CARTES PERSONNELLES
                  </span>

                  <h2>
                    Rien ici pour l’instant.
                  </h2>

                </div>

                <p className="settings-card-copy">
                  Vos futures actions,
                  vérités et duels apparaîtront ici.
                </p>

              </section>

            )}


          {!loading &&
            !error &&
            cards.map(
              (card) => (

                <section
                  className={
                    card.active
                      ? "custom-manage-card"
                      : "custom-manage-card is-inactive"
                  }
                  data-type={card.type}
                  key={card.id}
                >

                  <div className="custom-manage-card-top">

                    <span className="custom-manage-type">
                      {typeLabel(
                        card.type
                      )}
                    </span>

                    <span
                      className={
                        card.active
                          ? "custom-manage-status is-active"
                          : "custom-manage-status"
                      }
                    >
                      <span />
                      {card.active
                        ? "ACTIVE"
                        : "INACTIVE"}
                    </span>

                  </div>


                  <h2 className="custom-manage-title">
                    {card.title}
                  </h2>


                  <p className="custom-manage-prompt">
                    {card.prompt}
                  </p>


                  <div className="custom-manage-meta">
                    <span
                      className="type-intensity"
                      aria-label={`Intensité ${card.intensity}`}
                    >
                      {Array.from({
                        length: 5,
                      }).map((_, index) => (
                        <i
                          key={index}
                          className={
                            index <
                            Number(card.intensity || 0)
                              ? "is-active"
                              : ""
                          }
                        />
                      ))}
                    </span>

                    <span className="custom-manage-target">
                      {targetLabel(
                        card.target_sex
                      )}
                    </span>
                  </div>


                  <div className="custom-manage-divider" />


                  <div className="custom-manage-actions">

                    <button
                      type="button"
                      className="custom-manage-action"
                      disabled={
                        cardActionLoading ===
                        card.id
                      }
                      onClick={() =>
                        editCard(card)
                      }
                    >
                      Modifier
                    </button>


                    <button
                      type="button"
                      className="custom-manage-action"
                      disabled={
                        cardActionLoading ===
                        card.id
                      }
                      onClick={() =>
                        toggleCardActive(
                          card
                        )
                      }
                    >
                      {card.active
                        ? "Désactiver"
                        : "Activer"}
                    </button>


                    <button
                      type="button"
                      className="custom-manage-delete"
                      disabled={
                        cardActionLoading ===
                        card.id
                      }
                      onClick={() =>
                        deleteCard(card)
                      }
                    >
                      Supprimer
                    </button>

                  </div>

                </section>

              )
            )}

        </section>

      </main>
    );
  }
