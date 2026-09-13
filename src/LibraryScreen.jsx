import {
  useEffect,
  useMemo,
  useState,
} from "react";

import {
  getPerson,
  personalizeCard,
} from "./cardPersonalization.js";

import "./library.css";


/* =========================================================
   PROTOCOL
   LIBRARY SCREEN
   ========================================================= */

export default function LibraryScreen({
  supabase,
  ownerKey,
  onBack,
  onOpenCard,
}) {

  const [cards, setCards] =
    useState([]);

  const [loading, setLoading] =
    useState(true);

  const [error, setError] =
    useState("");

  const [search, setSearch] =
    useState("");

  const [typeFilter, setTypeFilter] =
    useState("all");

  const [intensityFilter, setIntensityFilter] =
    useState("all");


  const viewer =
    getPerson(ownerKey);


  /* =========================================================
     LOAD CARDS
     ========================================================= */

  useEffect(() => {

    let active = true;


    const loadCards =
      async () => {

        try {

          setLoading(true);
          setError("");


          const {
            data,
            error: queryError,
          } = await supabase
            .from("protocol_cards")
            .select(`
              id,
              type,
              title,
              prompt,
              intensity,
              tension,
              sensations,
              unexpected,
              active,
              target_sex,
              library_version,
              library_key
            `)
            .eq(
              "library_version",
              "v2"
            )
            .eq(
              "active",
              true
            )
            .order(
              "id",
              {
                ascending: true,
              }
            );


          if (queryError) {
            throw queryError;
          }


          if (!active) {
            return;
          }


          const personalized =
            (data || [])
              .map(
                (card) =>
                  personalizeCard(
                    card,
                    ownerKey
                  )
              )
              .filter(
                (card) =>
                  card.compatible
              );


          setCards(
            personalized
          );


        } catch (err) {

          console.error(
            "LIBRARY LOAD ERROR:",
            err
          );


          if (active) {

            setError(
              "Impossible de charger la bibliothèque."
            );

          }


        } finally {

          if (active) {
            setLoading(false);
          }

        }

      };


    loadCards();


    return () => {
      active = false;
    };

  }, [
    supabase,
    ownerKey,
  ]);


  /* =========================================================
     FILTERS
     ========================================================= */

  const filteredCards =
    useMemo(() => {

      const normalizedSearch =
        search
          .trim()
          .toLocaleLowerCase(
            "fr"
          );


      return cards.filter(
        (card) => {

          /* -------------------------------------------------
             TYPE
             ------------------------------------------------- */

          if (
            typeFilter !== "all" &&
            card.type !== typeFilter
          ) {
            return false;
          }


          /* -------------------------------------------------
             INTENSITY
             ------------------------------------------------- */

          if (
            intensityFilter !== "all" &&
            Number(card.intensity) !==
              Number(intensityFilter)
          ) {
            return false;
          }


          /* -------------------------------------------------
             SEARCH
             ------------------------------------------------- */

          if (normalizedSearch) {

            const haystack =
              [
                card.title,
                card.displayPrompt,
                card.type,
              ]
                .filter(Boolean)
                .join(" ")
                .toLocaleLowerCase(
                  "fr"
                );


            if (
              !haystack.includes(
                normalizedSearch
              )
            ) {
              return false;
            }

          }


          return true;

        }
      );

    }, [
      cards,
      search,
      typeFilter,
      intensityFilter,
    ]);


  /* =========================================================
     TYPE LABEL
     ========================================================= */

  const getTypeLabel =
    (type) => {

      switch (type) {

        case "action":
          return "ACTION";

        case "truth":
          return "VÉRITÉ";

        case "duel":
          return "DUEL";

        case "scene":
          return "SCÈNE";

        default:
          return String(type || "")
            .toUpperCase();

      }

    };


  /* =========================================================
     LOADING
     ========================================================= */

  if (loading) {

    return (
      <main className="library-screen">

        <div className="library-topbar">

          <button
            type="button"
            className="library-back"
            onClick={onBack}
          >
            ←
          </button>

          <div>
            <div className="library-kicker">
              PROTOCOL
            </div>

            <h1>
              Bibliothèque
            </h1>
          </div>

        </div>


        <div className="library-loading">
          Chargement des cartes…
        </div>

      </main>
    );

  }


  /* =========================================================
     SCREEN
     ========================================================= */

  return (

    <main className="library-screen">

      {/* =====================================================
          HEADER
          ===================================================== */}

      <div className="library-topbar">

        <button
          type="button"
          className="library-back"
          onClick={onBack}
          aria-label="Retour"
        >
          ←
        </button>


        <div className="library-heading">

          <div className="library-kicker">
            PROTOCOL
          </div>

          <h1>
            Bibliothèque
          </h1>

          {viewer && (
            <div className="library-viewer">
              Pour {viewer.name}
            </div>
          )}

        </div>

      </div>


      {/* =====================================================
          SEARCH
          ===================================================== */}

      <div className="library-search-wrap">

        <span className="library-search-icon">
          ⌕
        </span>

        <input
          className="library-search"
          type="search"
          value={search}
          onChange={
            (event) =>
              setSearch(
                event.target.value
              )
          }
          placeholder="Rechercher un mot, un défi…"
          autoComplete="off"
        />

        {search && (

          <button
            type="button"
            className="library-search-clear"
            onClick={
              () =>
                setSearch("")
            }
          >
            ×
          </button>

        )}

      </div>


      {/* =====================================================
          TYPE FILTER
          ===================================================== */}

      <div className="library-filter-row">

        {[
          ["all", "Toutes"],
          ["action", "Actions"],
          ["truth", "Vérités"],
          ["duel", "Duels"],
          ["scene", "Scènes"],
        ].map(
          ([value, label]) => (

            <button
              key={value}
              type="button"
              className={
                typeFilter === value
                  ? "library-filter active"
                  : "library-filter"
              }
              onClick={
                () =>
                  setTypeFilter(
                    value
                  )
              }
            >
              {label}
            </button>

          )
        )}

      </div>


      {/* =====================================================
          INTENSITY FILTER
          ===================================================== */}

      <div className="library-intensity-row">

        <span>
          Intensité
        </span>

        {[
          ["all", "Toutes"],
          ["1", "1"],
          ["2", "2"],
          ["3", "3"],
        ].map(
          ([value, label]) => (

            <button
              key={value}
              type="button"
              className={
                intensityFilter === value
                  ? "library-level active"
                  : "library-level"
              }
              onClick={
                () =>
                  setIntensityFilter(
                    value
                  )
              }
            >
              {label}
            </button>

          )
        )}

      </div>


      {/* =====================================================
          COUNTER
          ===================================================== */}

      <div className="library-count">

        <strong>
          {filteredCards.length}
        </strong>

        {" "}

        {filteredCards.length > 1
          ? "cartes"
          : "carte"}

      </div>


      {/* =====================================================
          ERROR
          ===================================================== */}

      {error && (

        <div className="library-error">
          {error}
        </div>

      )}


      {/* =====================================================
          EMPTY
          ===================================================== */}

      {!error &&
        filteredCards.length === 0 && (

          <div className="library-empty">

            <div className="library-empty-symbol">
              ♢
            </div>

            <div>
              Aucune carte ne correspond
              à ces critères.
            </div>

          </div>

        )}


      {/* =====================================================
          CARDS
          ===================================================== */}

      <div className="library-list">

        {filteredCards.map(
          (card) => (

            <button
              key={card.id}
              type="button"
              className="library-card"
              onClick={
                () =>
                  onOpenCard?.(
                    card.id
                  )
              }
            >

              <div className="library-card-header">

                <span className="library-card-type">
                  {getTypeLabel(
                    card.type
                  )}
                </span>

                <span className="library-card-id">
                  #{card.id}
                </span>

              </div>


              <h2 className="library-card-title">
                {card.title}
              </h2>


              <div className="library-card-prompt">
                {card.displayPrompt}
              </div>


              <div className="library-card-levels">

                <div>
                  <span>
                    INT
                  </span>

                  <strong>
                    {card.intensity}
                  </strong>
                </div>


                <div>
                  <span>
                    TEN
                  </span>

                  <strong>
                    {card.tension}
                  </strong>
                </div>


                <div>
                  <span>
                    SEN
                  </span>

                  <strong>
                    {card.sensations}
                  </strong>
                </div>


                <div>
                  <span>
                    SUR
                  </span>

                  <strong>
                    {card.unexpected}
                  </strong>
                </div>

              </div>

            </button>

          )
        )}

      </div>

    </main>

  );
}