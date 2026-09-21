import {
  useEffect,
  useMemo,
  useState,
} from "react";

import {
  getCardRecipient,
  personalizeCardForLibrary,
} from "./cardPersonalization.js";

import "./library.css";


/* =========================================================
   CONSTANTS
   ========================================================= */

const TYPE_FILTERS = [
  {
    value: "all",
    label: "Toutes",
  },
  {
    value: "action",
    label: "Actions",
  },
  {
    value: "truth",
    label: "Vérités",
  },
  {
    value: "duel",
    label: "Duels",
  },
  {
    value: "scene",
    label: "Scènes",
  },
];

const INTENSITY_FILTERS = [
  {
    value: "all",
    label: "Toutes",
  },
  {
    value: 1,
    label: "1",
  },
  {
    value: 2,
    label: "2",
  },
  {
    value: 3,
    label: "3",
  },
  {
    value: 4,
    label: "4",
  },
  {
    value: 5,
    label: "5",
  },
];


/* =========================================================
   HELPERS
   ========================================================= */

function normaliseSearchText(
  value
) {
  return String(value || "")
    .toLocaleLowerCase("fr")
    .normalize("NFD")
    .replace(
      /[\u0300-\u036f]/g,
      ""
    );
}

function getTypeLabel(
  type
) {
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
      return String(
        type || "CARTE"
      ).toUpperCase();
  }
}


/* =========================================================
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

  const [
    selectedType,
    setSelectedType,
  ] = useState("all");

  const [
    selectedIntensity,
    setSelectedIntensity,
  ] = useState("all");

    const [
    lovenseConnected,
    setLovenseConnected,
  ] = useState(false);

  const [
    lovenseStatusLoading,
    setLovenseStatusLoading,
  ] = useState(true);


  /* =======================================================
     RECIPIENT
     ======================================================= */

  const recipient =
    getCardRecipient(
      ownerKey
    );

    /* =======================================================
     LOVENSE STATUS
     ======================================================= */

  useEffect(() => {

    let active = true;

    const checkLovenseStatus =
      async () => {

        try {

          setLovenseStatusLoading(
            true
          );

          const {
            data,
            error:
              functionError,
          } =
            await supabase
              .functions
              .invoke(
                "lovense-status",
                {
                  body: {
                    host:
                      "jerome",
                  },
                }
              );

          if (
            functionError
          ) {
            throw functionError;
          }

          if (
            !data?.success
          ) {
            throw new Error(
              data?.error ||
              "Impossible de vérifier Lovense."
            );
          }

          if (
            active
          ) {
            setLovenseConnected(
              Boolean(
                data.connected
              )
            );
          }

        } catch (err) {

          console.error(
            "LIBRARY LOVENSE STATUS ERROR:",
            err
          );

          if (
            active
          ) {
            setLovenseConnected(
              false
            );
          }

        } finally {

          if (
            active
          ) {
            setLovenseStatusLoading(
              false
            );
          }

        }

      };

    checkLovenseStatus();

    const handleVisibilityChange =
      () => {

        if (
          document.visibilityState ===
          "visible"
        ) {
          checkLovenseStatus();
        }

      };

    document.addEventListener(
      "visibilitychange",
      handleVisibilityChange
    );

    return () => {

      active = false;

      document.removeEventListener(
        "visibilitychange",
        handleVisibilityChange
      );

    };

  }, [
    supabase,
  ]);

  /* =======================================================
     LOAD CARDS
     ======================================================= */

  useEffect(() => {
    let active = true;

    const loadCards =
      async () => {
        try {
          setLoading(true);
          setError("");

          const {
            data,
            error:
              queryError,
          } =
            await supabase
              .from(
                "protocol_cards"
              )
              .select("*")
              .eq(
                "library_version",
                "v1"
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

          const personalised =
            (data || [])
              .map(
                (card) =>
                  personalizeCardForLibrary(
                    card,
                    ownerKey
                  )
              )
              .filter(
                (card) =>
                  card.compatible
              );

          setCards(
            personalised
          );

        } catch (err) {
          console.error(
            "LIBRARY LOAD ERROR:",
            err
          );

          if (active) {
            setError(
              err?.message ||
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


  /* =======================================================
     FILTERING
     ======================================================= */

  const visibleCards =
    useMemo(() => {
      const searchValue =
        normaliseSearchText(
          search
        );

      return cards.filter(
        (card) => {
            if (
              card.lovense_mode ===
                "required" &&
              (
                lovenseStatusLoading ||
                !lovenseConnected
              )
            ) {
              return false;
            }
          if (
            selectedType !==
              "all" &&
            card.type !==
              selectedType
          ) {
            return false;
          }

          if (
            selectedIntensity !==
              "all" &&
            Number(
              card.intensity
            ) !==
              Number(
                selectedIntensity
              )
          ) {
            return false;
          }

          if (
            !searchValue
          ) {
            return true;
          }

          const haystack =
            normaliseSearchText(
              [
                card.title,
                card.displayPrompt,
                card.type,
                card.library_key,
              ].join(" ")
            );

          return haystack.includes(
            searchValue
          );
        }
      );
    }, [
      cards,
      search,
      selectedType,
      selectedIntensity,
      lovenseConnected,
      lovenseStatusLoading,
    ]);


  /* =======================================================
     RENDER
     ======================================================= */

  return (
    <main className="library-page">

      <header className="library-topbar">

        <button
          type="button"
          className="library-back"
          onClick={onBack}
          aria-label="Retour"
        >
          ←
        </button>

        <div className="library-heading">

          <span className="library-logo">
            PROTOCOL
          </span>

          <span className="library-target">
            Pour{" "}
            {recipient?.name ||
              "ton partenaire"}
          </span>

        </div>

      </header>


      <section className="library-content">

        <div className="library-intro">

          <p className="kicker">
            BIBLIOTHÈQUE
          </p>

          <h1>
            Trouve
            <br />
            l’idée parfaite.
          </h1>

          <p className="intro">
            Les cartes affichées sont
            préparées pour{" "}
            <strong>
              {recipient?.name ||
                "ton partenaire"}
            </strong>
            .
          </p>

        </div>


        <div className="library-controls">

          <label className="library-search">

            <span className="library-search-icon">
              ⌕
            </span>

            <input
              type="search"
              value={search}
              onChange={(
                event
              ) =>
                setSearch(
                  event.target
                    .value
                )
              }
              placeholder="Chercher une carte..."
              autoComplete="off"
            />

          </label>


          <div className="library-filter-block">

            <span className="library-filter-label">
              TYPE
            </span>

            <div className="library-filter-row">

              {TYPE_FILTERS.map(
                (filter) => (
                  <button
                    key={
                      filter.value
                    }
                    type="button"
                    className={
                      selectedType ===
                      filter.value
                        ? "library-filter active"
                        : "library-filter"
                    }
                    onClick={() =>
                      setSelectedType(
                        filter.value
                      )
                    }
                  >
                    {
                      filter.label
                    }
                  </button>
                )
              )}

            </div>

          </div>


          <div className="library-filter-block">

            <span className="library-filter-label">
              INTENSITÉ
            </span>

            <div className="library-filter-row">

              {INTENSITY_FILTERS.map(
                (filter) => (
                  <button
                    key={
                      filter.value
                    }
                    type="button"
                    className={
                      selectedIntensity ===
                      filter.value
                        ? "library-filter active"
                        : "library-filter"
                    }
                    onClick={() =>
                      setSelectedIntensity(
                        filter.value
                      )
                    }
                  >
                    {
                      filter.label
                    }
                  </button>
                )
              )}

            </div>

          </div>

        </div>


        <div className="library-count">

          {loading
            ? "Chargement…"
            : `${visibleCards.length} carte${
                visibleCards.length >
                1
                  ? "s"
                  : ""
              }`}

        </div>


        {error && (
          <p className="error">
            {error}
          </p>
        )}


        {!loading &&
          !error &&
          visibleCards.length ===
            0 && (
            <div className="library-empty">

              <p>
                Aucune carte ne
                correspond à ces
                filtres.
              </p>

            </div>
          )}


        {!loading &&
          !error && (
            <div className="library-list">

              {visibleCards.map(
                (card) => (
                  <button
                    key={card.id}
                    type="button"
                    className="library-card"
                    onClick={() =>
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


                    {card.lovense_mode &&
                      lovenseConnected && (

                        <span
                          style={{
                            display: "inline-block",
                            marginBottom: "10px",
                            fontSize: "0.68rem",
                            opacity: 0.55,
                            letterSpacing: "0.08em",
                            textTransform: "uppercase",
                          }}
                        >
                          LUSH
                          {
                            card.lovense_pattern
                              ? ` · ${card.lovense_pattern.replaceAll(
                                  "_",
                                  " "
                                )}`
                              : ""
                          }
                        </span>

                      )}


                    <p className="library-card-prompt">
                      {
                        card.displayPrompt
                      }
                    </p>

                  </button>
                )
              )}

            </div>
          )}

      </section>

    </main>
  );
}