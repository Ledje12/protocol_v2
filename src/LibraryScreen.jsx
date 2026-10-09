import {
  useEffect,
  useMemo,
  useState,
} from "react";

import "./library.css";
import { BackIcon } from "./ScreenHeader.jsx";


/* =========================================================
   CONSTANTS
   ========================================================= */

const TYPE_FILTERS = [
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

/* Supabase renvoie au plus 1 000 lignes par requête : la
   bibliothèque officielle est chargée par pages. */
const PAGE_SIZE = 1000;

async function fetchOfficialCards(supabase) {
  const rows = [];

  for (let from = 0; ; from += PAGE_SIZE) {
    const { data, error } = await supabase
      .from("protocol_cards")
      .select("*")
      .eq("library_version", "v1")
      .eq("active", true)
      .order("id", { ascending: true })
      .range(from, from + PAGE_SIZE - 1);

    if (error) {
      return { data: null, error };
    }

    rows.push(...(data || []));

    if (!data || data.length < PAGE_SIZE) {
      return { data: rows, error: null };
    }
  }
}

/* catégories : les cartes perso d'abord, les familles non
   rangées à la fin */
const STYLE_FILTERS = [
  { value: "vanilla", label: "Vanilla" },
  { value: "kinky", label: "Kinky" },
];

// tri alphabétique à la française (accents et casse ignorés)
const byTitle = (a, b) =>
  String(a.title || "").localeCompare(
    String(b.title || ""),
    "fr",
    { sensitivity: "base" }
  );

// « Toutes » = liste vide ; retoucher un filtre actif le retire
const toggleIn = (list, value) =>
  list.includes(value)
    ? list.filter((item) => item !== value)
    : [...list, value];

const OWN_CATEGORY = "Vos cartes";

const RATING_ICONS = {
  fire: "🔥",
  like: "👍",
  dislike: "👎",
};
const OTHER_CATEGORY = "Autres";

/* filtres et catégorie retenus le temps de la session (ouvrir
   une carte puis revenir ne remet pas tout à zéro) */
const VIEW_KEY = "protocol-library-view";

function readSavedView() {
  try {
    return JSON.parse(sessionStorage.getItem(VIEW_KEY)) || {};
  } catch {
    return {};
  }
}

/* Une rangée de filtres : « Toutes » vide la sélection, chaque
   option s'ajoute ou se retire d'un toucher. */
function FilterRow({ label, options, selected, onChange }) {
  return (
    <div className="library-filter-block">
      <span className="library-filter-label">
        {label}
      </span>

      <div className="library-filter-row">
        <button
          type="button"
          className={
            selected.length === 0
              ? "library-filter active"
              : "library-filter"
          }
          aria-pressed={selected.length === 0}
          onClick={() => onChange([])}
        >
          Toutes
        </button>

        {options.map((filter) => (
          <button
            key={filter.value}
            type="button"
            className={
              selected.includes(filter.value)
                ? "library-filter active"
                : "library-filter"
            }
            aria-pressed={selected.includes(filter.value)}
            onClick={() =>
              onChange(toggleIn(selected, filter.value))
            }
          >
            {filter.label}
          </button>
        ))}
      </div>
    </div>
  );
}

export default function LibraryScreen({
  supabase,
  profile,
  couple,
  onBack,
  onOpenCard,
}) {
  const [cards, setCards] =
    useState([]);

  const [loading, setLoading] =
    useState(true);

  const [error, setError] =
    useState("");

  const [savedView] =
    useState(readSavedView);

  const [search, setSearch] =
    useState(savedView.search || "");

  const [
    selectedTypes,
    setSelectedTypes,
  ] = useState(
    Array.isArray(savedView.types) ? savedView.types : []
  );

  const [
    selectedIntensities,
    setSelectedIntensities,
  ] = useState(
    Array.isArray(savedView.intensities) ? savedView.intensities : []
  );

  // vanilla / kinky (null = toutes)
  const [
    selectedStyle,
    setSelectedStyle,
  ] = useState(savedView.style || null);

  const [
    selectedCategory,
    setSelectedCategory,
  ] = useState(savedView.category || null);

  // mes avis (🔥 👍 👎), affichés dans la liste
  const [ratings, setRatings] =
    useState({});

  useEffect(() => {
    let active = true;

    supabase
      .from("protocol_card_ratings")
      .select("card_source, card_id, rating")
      .then(({ data, error: ratingsError }) => {
        if (!active || ratingsError) {
          return;
        }

        const map = {};

        for (const row of data || []) {
          map[`${row.card_source}-${row.card_id}`] = row.rating;
        }

        setRatings(map);
      });

    return () => {
      active = false;
    };
  }, [supabase]);

  // familles -> catégorie (null tant que la table n'existe pas :
  // la bibliothèque reste alors une simple liste)
  const [families, setFamilies] =
    useState(null);

  useEffect(() => {
    try {
      sessionStorage.setItem(
        VIEW_KEY,
        JSON.stringify({
          search,
          types: selectedTypes,
          intensities: selectedIntensities,
          style: selectedStyle,
          category: selectedCategory,
        })
      );
    } catch {
      // stockage indisponible : sans conséquence
    }
  }, [
    search,
    selectedTypes,
    selectedIntensities,
    selectedStyle,
    selectedCategory,
  ]);

  useEffect(() => {
    let active = true;

    supabase
      .from("protocol_card_families")
      .select("family_key, category, category_position, style")
      .then(({ data, error: familiesError }) => {
        if (!active) {
          return;
        }

        if (familiesError || !data?.length) {
          setFamilies(null);
          return;
        }

        const map = {};

        for (const row of data) {
          map[row.family_key] = row;
        }

        setFamilies(map);
      });

    return () => {
      active = false;
    };
  }, [supabase]);

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
    couple?.partner ||
    null;


  const partnerName =
    recipient?.display_name ||
    "ton partenaire";


  const myName =
    profile?.display_name ||
    "toi";


  const partnerSex =
    recipient?.sex ||
    null;

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
                  body: {},
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


          const [
            officialResult,
            customResult,
          ] =
            await Promise.all([

              fetchOfficialCards(supabase),
              supabase
                .from(
                  "protocol_custom_cards"
                )
                .select("*")
                .eq(
                  "couple_id",
                  couple?.id ||
                    couple?.couple_id
                )
                .eq(
                  "active",
                  true
                )
                .is(
                  "deleted_at",
                  null
                )
                .order(
                  "id",
                  {
                    ascending: true,
                  }
                ),

            ]);


          if (
            officialResult.error
          ) {
            throw officialResult.error;
          }


          if (
            customResult.error
          ) {
            throw customResult.error;
          }


          if (!active) {
            return;
          }


          const officialCards =
            (
              officialResult.data ||
              []
            ).map(
              (card) => ({
                ...card,

                card_source:
                  "official",
              })
            );


          const customCards =
            (
              customResult.data ||
              []
            ).map(
              (card) => ({
                ...card,

                card_source:
                  "custom",

                lovense_mode:
                  null,

                lovense_action:
                  null,

                lovense_controls_profile:
                  null,
              })
            );


          const allCards = [
            ...officialCards,
            ...customCards,
          ];


          /* toutes les cartes sont visibles ; celles prévues pour
             l'autre sexe se lisent du point de vue de celui qui
             les jouerait (rôles inversés) et ne s'envoient pas */
          const personalised =
            allCards.map((card) => {
              const compatible =
                !card.target_sex ||
                !partnerSex ||
                card.target_sex === partnerSex;

              const doer =
                compatible ? partnerName : myName;

              const other =
                compatible ? myName : partnerName;

              const displayPrompt =
                String(card.prompt || "")
                  .replaceAll("{{active}}", doer)
                  .replaceAll("{{partner}}", other)
                  /* la carte s'adresse à la personne qui la
                     jouera : {{me}} = elle, {{other}} = l'autre */
                  .replaceAll("{{me}}", doer)
                  .replaceAll("{{other}}", other);

              return {
                ...card,
                compatible,
                displayPrompt,
              };
            });


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
    partnerName,
    myName,
    partnerSex,
    couple?.id,
    couple?.couple_id,
  ]);


  /* =======================================================
     FILTERING
     ======================================================= */

  const filteredCards =
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
            selectedTypes.length > 0 &&
            !selectedTypes.includes(card.type)
          ) {
            return false;
          }

          if (
            selectedIntensities.length > 0 &&
            !selectedIntensities.includes(
              Number(card.intensity)
            )
          ) {
            return false;
          }

          // vanilla / kinky : seules les cartes classées
          // (familles connues) entrent dans ces filtres
          if (
            selectedStyle &&
            families?.[card.family_key]?.style !== selectedStyle
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
      selectedTypes,
      selectedIntensities,
      selectedStyle,
      families,
      lovenseConnected,
      lovenseStatusLoading,
    ]);

  /* =======================================================
     CATÉGORIES
     Sans recherche : liste des catégories (nombre de cartes
     selon les filtres actifs), puis les cartes de celle choisie.
     Avec une recherche : toutes les cartes trouvées.
     ======================================================= */

  const categoryOf = (card) => {
    if (card.card_source === "custom") {
      return { name: OWN_CATEGORY, position: 0 };
    }

    const family = families?.[card.family_key];

    return family
      ? { name: family.category, position: family.category_position }
      : { name: OTHER_CATEGORY, position: 999 };
  };

  const isSearching =
    normaliseSearchText(search) !== "";

  const categories =
    useMemo(() => {
      if (!families) {
        return [];
      }

      const byName = new Map();

      for (const card of filteredCards) {
        const { name, position } = categoryOf(card);
        const entry = byName.get(name) || { name, position, count: 0 };
        entry.count += 1;
        byName.set(name, entry);
      }

      // « Vos cartes » en tête, « Autres » à la fin, le reste de A à Z
      const rank = (entry) =>
        entry.name === OWN_CATEGORY ? 0 : entry.name === OTHER_CATEGORY ? 2 : 1;

      return [...byName.values()].sort(
        (a, b) =>
          rank(a) - rank(b) ||
          a.name.localeCompare(b.name, "fr", { sensitivity: "base" })
      );
    // categoryOf ne dépend que de families
    // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [filteredCards, families]);

  const showCategories =
    Boolean(families) && !isSearching && !selectedCategory;

  const visibleCards =
    (
      families && !isSearching && selectedCategory
        ? filteredCards.filter(
            (card) => categoryOf(card).name === selectedCategory
          )
        : [...filteredCards]
    ).sort(byTitle);


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
          <BackIcon />
        </button>

        <div className="library-heading">

          <span className="library-logo">
            PROTOCOL
          </span>

          <span className="library-target">
            Pour {partnerName}
          </span>

        </div>

      </header>


      <section className="library-content">

        {/* =========================================
            INTRO
            ========================================= */}

        <section className="library-intro">

          <p className="kicker">
            BIBLIOTHÈQUE
          </p>

          <h1>
            Trouve
            <br />
            l’idée parfaite.
          </h1>

          <p className="intro">
            Les cartes affichées sont préparées
            pour{" "}
            <strong>
              {partnerName}
            </strong>
            .
          </p>

        </section>


        {/* =========================================
            CONTROLS
            ========================================= */}

        <section className="library-controls">

          <label className="library-search">

            <span
              className="library-search-icon"
              aria-hidden="true"
            >
              <svg
                width="17"
                height="17"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.6"
                strokeLinecap="round"
              >
                <circle cx="11" cy="11" r="6.5" />
                <path d="m16 16 4 4" />
              </svg>
            </span>

            <input
              type="search"
              value={search}
              onChange={(event) =>
                setSearch(
                  event.target.value
                )
              }
              placeholder="Chercher une carte..."
              autoComplete="off"
            />

          </label>


          <FilterRow
            label="TYPE"
            options={TYPE_FILTERS}
            selected={selectedTypes}
            onChange={setSelectedTypes}
          />

          <FilterRow
            label="INTENSITÉ"
            options={INTENSITY_FILTERS}
            selected={selectedIntensities}
            onChange={setSelectedIntensities}
          />

          {families && (
            <FilterRow
              label="STYLE"
              options={STYLE_FILTERS}
              selected={selectedStyle ? [selectedStyle] : []}
              onChange={(values) =>
                // un seul style à la fois : le dernier touché
                setSelectedStyle(
                  values.length ? values[values.length - 1] : null
                )
              }
            />
          )}

        </section>


        {/* =========================================
            RESULT SUMMARY
            ========================================= */}

        {families &&
          !isSearching &&
          selectedCategory && (
            <div className="library-category-head">
              <button
                type="button"
                className="library-category-back"
                onClick={() => setSelectedCategory(null)}
              >
                <span aria-hidden="true">←</span>
                {" "}Toutes les catégories
              </button>

              <h2>{selectedCategory}</h2>
            </div>
          )}

        <div className="library-results-meta">

          <span className="library-count">
            {loading
              ? "Chargement…"
              : showCategories
                ? `${filteredCards.length} cartes · ${categories.length} catégories`
                : `${visibleCards.length} carte${
                    visibleCards.length > 1
                      ? "s"
                      : ""
                  }`}
          </span>

          {!loading &&
            !error &&
            visibleCards.length > 0 && (

              <span
                className="library-results-line"
                aria-hidden="true"
              />

            )}

        </div>


        {error && (
          <p className="error">
            {error}
          </p>
        )}


        {!loading &&
          !error &&
          visibleCards.length === 0 && (

            <div className="library-empty">

              <span className="library-empty-symbol">
                <span className="protocol-diamond" aria-hidden="true" />
              </span>

              <p>
                Aucune carte ne correspond
                à ces filtres.
              </p>

            </div>

          )}


        {/* =========================================
            CARDS
            ========================================= */}

        {!loading &&
          !error && (

            showCategories ? (
            <div className="library-categories">
              {categories.map((category) => (
                <button
                  key={category.name}
                  type="button"
                  className="library-category"
                  onClick={() => {
                    setSelectedCategory(category.name);
                    window.scrollTo(0, 0);
                  }}
                >
                  <span className="library-category-name">
                    {category.name}
                  </span>

                  <span className="library-category-count">
                    {category.count}
                  </span>

                  <span
                    className="library-category-arrow"
                    aria-hidden="true"
                  >
                    →
                  </span>
                </button>
              ))}
            </div>
          ) : (
            <div className="library-list">

              {visibleCards.map(
                (card) => (

                  <button
                    key={card.id}
                    type="button"
                    className={
                      `library-card ` +
                      `library-card-${card.type} ` +
                      `library-card-intensity-${card.intensity}`
                    }
                    onClick={() =>
                      onOpenCard?.({
                        cardId:
                          card.id,

                        cardSource:
                          card.card_source ||
                          "official",
                      })
                    }
                  >

                    <div className="library-card-accent" />


                    <div className="library-card-header">

                      <div className="library-card-type-group">

                        <span className="library-card-type">
                          {getTypeLabel(
                            card.type
                          )}
                        </span>

                        {card.card_source ===
                          "custom" && (

                          <span className="library-card-personal-badge">
                            PERSO
                          </span>

                        )}

                      </div>


                      {!card.compatible && (
                        <span className="library-card-for-me">
                          Pour toi
                        </span>
                      )}

                      {ratings[`${card.card_source || "official"}-${card.id}`] && (
                        <span
                          className="library-card-rating"
                          aria-label="Ton avis"
                        >
                          {RATING_ICONS[
                            ratings[`${card.card_source || "official"}-${card.id}`]
                          ]}
                        </span>
                      )}

                      <span className="library-card-id">

                        {card.card_source ===
                          "custom"
                          ? `#P${card.id}`
                          : `#${card.id}`}

                      </span>

                    </div>


                    <h2 className="library-card-title">
                      {card.title}
                    </h2>


                    {card.lovense_mode &&
                      lovenseConnected && (

                        <div className="library-card-lovense">

                          <span className="library-card-lovense-dot" />

                          <span>
                            LUSH
                            {card.lovense_pattern
                              ? ` · ${card.lovense_pattern.replaceAll(
                                  "_",
                                  " "
                                )}`
                              : ""}
                          </span>

                        </div>

                      )}


                    <p className="library-card-prompt">
                      {card.displayPrompt}
                    </p>


                    <div className="library-card-footer">

                      <div className="library-card-intensity">

                        {Array.from({
                          length: 5,
                        }).map(
                          (_, index) => (

                            <span
                              key={index}
                              className={
                                index <
                                Number(
                                  card.intensity ||
                                  0
                                )
                                  ? "is-active"
                                  : ""
                              }
                            />

                          )
                        )}

                      </div>

                      <span className="library-card-open">
                        →
                      </span>

                    </div>

                  </button>

                )
              )}

            </div>
          )

          )}

      </section>

    </main>
  );
}