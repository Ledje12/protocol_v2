import {
  useEffect,
  useRef,
  useState,
} from "react";

import { BackIcon } from "./ScreenHeader.jsx";
import StateScreen from "./StateScreen.jsx";
import CardEditSheet from "./CardEditSheet.jsx";
import { fillNames } from "./personalise.js";
import CardPhotos from "./CardPhotos.jsx";
import CardRating from "./CardRating.jsx";
import { INTENSITY_LEVELS, levelForIntensity, levelRank } from "./gameConstants.js";
import { humanError } from "./networkError.js";
import { LovenseBanner, cardToyBanner, toyAvailable, useLovenseToys } from "./lovense.jsx";


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


function formatOpenedTime(
  value
) {
  if (!value) {
    return "";
  }

  try {
    return new Intl.DateTimeFormat(
      "fr-BE",
      {
        hour:
          "2-digit",

        minute:
          "2-digit",
      }
    ).format(
      new Date(value)
    );

  } catch {
    return "";
  }
}


/* 45 → « 45 s », 90 → « 1 min 30 », 300 → « 5 min » */
function formatDuration(seconds) {
  const minutes = Math.floor(seconds / 60);
  const rest = seconds % 60;

  if (!minutes) {
    return `${rest} s`;
  }

  return rest
    ? `${minutes} min ${String(rest).padStart(2, "0")}`
    : `${minutes} min`;
}

const RESPONSE_LABELS = {
  tonight: "Ce soir",
  later: "Plus tard",
  love: "J’adore",
};



export default function CardScreen({
  supabase,
  cardId,
  cardSource = "official",
  profile,
  couple,
  invitationId,
  challengeId,
  onBack,
}) {

  const [
    card,
    setCard,
  ] =
    useState(null);

  const [
    sceneSteps,
    setSceneSteps,
  ] =
    useState([]);

  const [
    loading,
    setLoading,
  ] =
    useState(true);

  const [
    error,
    setError,
  ] =
    useState("");

  const [
    sending,
    setSending,
  ] =
    useState(false);

  const [
    sendMessage,
    setSendMessage,
  ] =
    useState("");

  // modifier la carte (bibliothèque, comptes autorisés)
  const [canEdit, setCanEdit] = useState(false);
  const [editing, setEditing] = useState(false);
  const [reloadKey, setReloadKey] = useState(0);

  useEffect(() => {
    let active = true;

    supabase.rpc("protocol_is_admin").then(({ data, error: adminError }) => {
      if (active && !adminError) {
        setCanEdit(data === true);
      }
    });

    return () => {
      active = false;
    };
  }, [supabase]);

  const [
    trackedInvitationId,
    setTrackedInvitationId,
  ] =
    useState(
      invitationId || null
    );

  const [
    invitation,
    setInvitation,
  ] =
    useState(null);

  const [
    openedAt,
    setOpenedAt,
  ] =
    useState(null);

  /* réponse rapide du destinataire (« Ce soir »…) */
  const [
    response,
    setResponse,
  ] =
    useState(null);

  const [
    responding,
    setResponding,
  ] =
    useState(false);

  useEffect(() => {
    if (!trackedInvitationId) {
      return undefined;
    }

    let active = true;

    const loadResponse = () =>
      supabase
        .from("card_invitations")
        .select("response")
        .eq("id", String(trackedInvitationId))
        .maybeSingle()
        .then(({ data, error: responseError }) => {
          // colonne absente tant que la migration n'est pas appliquée
          if (active && !responseError) {
            setResponse(data?.response || null);
          }
        });

    loadResponse();

    // côté expéditeur : la réponse peut arriver écran ouvert
    const timer =
      window.setInterval(loadResponse, 15000);

    return () => {
      active = false;
      window.clearInterval(timer);
    };
  }, [
    supabase,
    trackedInvitationId,
  ]);

  const respond = async (value) => {
    if (!trackedInvitationId || responding) {
      return;
    }

    setResponding(true);

    const { error: respondError } =
      await supabase.rpc(
        "respond_card_invitation",
        {
          p_invitation_id: String(trackedInvitationId),
          p_response: value,
        }
      );

    if (!respondError) {
      setResponse(value);
    } else {
      console.error("RESPOND ERROR:", respondError);
    }

    setResponding(false);
  };


  // jouets Lovense connectés (Lush, Diamo) : bandeau et cartes « required »
  const lovense =
    useLovenseToys(
      supabase,
      Boolean(card?.lovense_mode)
    );

  const sendRequestKeyRef =
    useRef(null);

  const currentUserId =
    profile?.user_id ||
    null;


  const partner =
    couple?.partner ||
    null;


  /*
   * Sans invitation :
   * la carte est destinée au partenaire.
   *
   * Avec invitation reçue :
   * le destinataire est l'utilisateur courant.
   */
  const activePerson =
    invitation?.recipient_user_id ===
    currentUserId
      ? profile
      : partner;


  const senderPerson =
    invitation?.recipient_user_id ===
    currentUserId
      ? partner
      : profile;


  /*
   * Pas encore d'invitation :
   * on peut proposer la carte.
   *
   * Invitation existante :
   * seul son expéditeur est côté "proposition".
   */
  const canPropose =
    !trackedInvitationId ||
    invitation?.sender_user_id ===
      currentUserId;


  const isRecipient =
    Boolean(
      invitation &&
      invitation.recipient_user_id ===
        currentUserId
    );


  /* =========================================================
     SYNC INVITATION ID FROM URL
     ========================================================= */

  useEffect(() => {

    setTrackedInvitationId(
      invitationId ||
      null
    );

    setInvitation(
      null
    );

    setOpenedAt(
      null
    );

  }, [
    invitationId,
  ]);


  /* =========================================================
     LOAD INVITATION
     ========================================================= */

  useEffect(() => {

    let active =
      true;


    const loadInvitation =
      async () => {

        if (
          !trackedInvitationId
        ) {

          if (active) {
            setInvitation(
              null
            );
          }

          return;
        }


        try {

          const {
            data,
            error:
              rpcError,
          } =
            await supabase.rpc(
              "get_card_invitation_secure_v2",
              {
                p_invitation_id:
                  String(
                    trackedInvitationId
                  ),
              }
            );


          if (
            rpcError
          ) {
            throw rpcError;
          }


          const row =
            Array.isArray(
              data
            )
              ? data[0]
              : data;


          if (
            !active
          ) {
            return;
          }


          if (!row) {
            throw new Error(
              "Invitation introuvable ou non autorisée."
            );
          }


          const invitationCardId =
            Number(
              row.effective_card_id
            );

          if (
            invitationCardId !==
            Number(cardId)
          ) {
            throw new Error(
              "Cette invitation ne correspond pas à cette carte."
            );
          }


          setInvitation(
            row
          );


          setOpenedAt(
            row.opened_at ||
            null
          );


        } catch (err) {

          console.error(
            "INVITATION LOAD ERROR:",
            err
          );


          if (active) {

            setInvitation(
              null
            );

            setError(
              humanError(err, err?.message || "Impossible de charger cette invitation.")
            );

            setLoading(
              false
            );

          }

        }

      };


    loadInvitation();


    return () => {
      active =
        false;
    };

  }, [
    supabase,
    trackedInvitationId,
    cardId,
  ]);


  /* =========================================================
    LOAD CARD
    ========================================================= */

  useEffect(() => {

    let mounted =
      true;


    const loadCard =
      async () => {

        if (
          trackedInvitationId &&
          !invitation
        ) {
          return;
        }


        try {

          setLoading(
            true
          );

          setError(
            ""
          );


          const effectiveCardSource =
            trackedInvitationId
              ? (
                  invitation
                    ?.card_source ||
                  "official"
                )
              : (
                  cardSource ||
                  "official"
                );


          const effectiveCardId =
            trackedInvitationId
              ? Number(
                  invitation
                    ?.effective_card_id
                )
              : Number(
                  cardId
                );


          let data =
            null;


          if (
            effectiveCardSource ===
              "custom"
          ) {

            const {
              data:
                customCard,

              error:
                queryError,

            } =
              await supabase
                .from(
                  "protocol_custom_cards"
                )
                .select("*")
                .eq(
                  "id",
                  effectiveCardId
                )
                .eq(
                  "couple_id",
                  couple?.id ||
                    couple?.couple_id
                )
                .single();


            if (
              queryError
            ) {
              throw queryError;
            }


            data = {
              ...customCard,

              card_source:
                "custom",

              lovense_mode:
                null,

              lovense_action:
                null,

              lovense_controls_profile:
                null,
            };

          } else {

            const {
              data:
                officialCard,

              error:
                queryError,

            } =
              await supabase
                .from(
                  "protocol_cards"
                )
                .select("*")
                .eq(
                  "id",
                  effectiveCardId
                )
                .eq(
                  "library_version",
                  "v1"
                )
                .eq(
                  "active",
                  true
                )
                .single();


            if (
              queryError
            ) {
              throw queryError;
            }


            data = {
              ...officialCard,

              card_source:
                "official",
            };

          }


          if (
            !mounted
          ) {
            return;
          }


          /* carte prévue pour l'autre sexe : envoyable aussi (le
             texte dit clairement qui fait quoi). On la lit alors du
             point de vue de celui qui la jouera, l'expéditeur : les
             rôles s'inversent. */
          const notForRecipient =
            Boolean(
              data.target_sex &&
              activePerson?.sex &&
              data.target_sex !==
                activePerson.sex
            );

          const doer =
            notForRecipient
              ? senderPerson
              : activePerson;

          const other =
            notForRecipient
              ? activePerson
              : senderPerson;

          /* la carte s'adresse à la personne qui la jouera :
             {{me}} = elle, {{other}} = celui qui la propose ;
             élision comprise (« d’Audrey », « de Candy ») */
          const personaliseText = (
            value
          ) =>
            fillNames(
              value,
              {
                active: doer?.display_name || "ton partenaire",
                partner: other?.display_name || "toi",
                me: doer?.display_name || "ton partenaire",
                other: other?.display_name || "toi",
              },
              {
                active: doer?.sex,
                partner: other?.sex,
                me: doer?.sex,
                other: other?.sex,
              }
            );


          const displayPrompt =
            personaliseText(
              data.prompt
            );


          let loadedSceneSteps = [];

            if (
              effectiveCardSource === "official" &&
              data?.type === "scene"
            ) {
              const {
                data: sceneData,
                error: sceneError,
              } = await supabase.rpc(
                "get_protocol_scene_preview",
                {
                  p_card_id:
                    effectiveCardId,
                }
              );

              if (sceneError) {
                throw sceneError;
              }

              loadedSceneSteps =
                Array.isArray(sceneData)
                  ? sceneData
                  : [];
            }


          if (mounted) {
            setSceneSteps(
              loadedSceneSteps.map(
                (step) => ({
                  ...step,

                  displayPrompt:
                    personaliseText(
                      step.prompt
                    ),

                  displayPromptActive:
                    personaliseText(
                      step.prompt_active
                    ),

                  displayPromptPartner:
                    personaliseText(
                      step.prompt_partner
                    ),

                  displayPromptPlayer1:
                    personaliseText(
                      step.prompt_player_1
                    ),

                  displayPromptPlayer2:
                    personaliseText(
                      step.prompt_player_2
                    ),
                })
              )
            );
          }

          setCard({
            ...data,
            displayPrompt,
            notForRecipient,
          });


        } catch (err) {

          console.error(
            "CARD LOAD ERROR:",
            err
          );


          if (
            mounted
          ) {

            setError(
              humanError(err, err?.message || "Impossible de charger cette carte.")
            );

          }


        } finally {

          if (
            mounted
          ) {

            setLoading(
              false
            );

          }

        }

      };


    loadCard();


    return () => {

      mounted =
        false;

    };

  }, [
    supabase,
    cardId,
    cardSource,
    reloadKey,
    trackedInvitationId,
    invitation?.card_source,
    invitation?.effective_card_id,
    activePerson?.user_id,
    activePerson?.sex,
    activePerson?.display_name,
    senderPerson?.display_name,
    couple?.id,
    couple?.couple_id,
  ]);


  /* =========================================================
     RECIPIENT OPENS INVITATION
     ========================================================= */

  useEffect(() => {

    if (
      !isRecipient ||
      !trackedInvitationId
    ) {
      return;
    }


    let active =
      true;


    const markOpened =
      async () => {

        try {

          const {
            data,
            error:
              rpcError,
          } =
            await supabase.rpc(
              "mark_card_invitation_opened_secure",
              {
                p_invitation_id:
                  String(
                    trackedInvitationId
                  ),
              }
            );


          if (
            rpcError
          ) {
            throw rpcError;
          }


          if (
            active
          ) {
            setOpenedAt(
              data ||
              null
            );

            setInvitation(
              (
                previous
              ) =>
                previous
                  ? {
                      ...previous,

                      opened_at:
                        data ||
                        previous
                          .opened_at,
                    }
                  : previous
            );
          }


        } catch (err) {

          console.error(
            "MARK INVITATION OPENED ERROR:",
            err
          );

        }

      };


    markOpened();


    return () => {
      active =
        false;
    };

  }, [
    supabase,
    trackedInvitationId,
    isRecipient,
  ]);


  /* =========================================================
     SENDER WATCHES OPEN STATUS
     ========================================================= */

  useEffect(() => {

    if (
      !canPropose ||
      !trackedInvitationId
    ) {
      return;
    }


    let active =
      true;


    const checkStatus =
      async () => {

        try {

          const {
            data,
            error:
              rpcError,
          } =
            await supabase.rpc(
              "get_card_invitation_status_secure",
              {
                p_invitation_id:
                  String(
                    trackedInvitationId
                  ),
              }
            );


          if (
            rpcError
          ) {
            throw rpcError;
          }


          if (
            active &&
            data
          ) {
            setOpenedAt(
              data
            );

            setInvitation(
              (
                previous
              ) =>
                previous
                  ? {
                      ...previous,

                      opened_at:
                        data,
                    }
                  : previous
            );
          }


        } catch (err) {

          console.error(
            "INVITATION STATUS ERROR:",
            err
          );

        }

      };


    checkStatus();


    const interval =
      window.setInterval(
        checkStatus,
        2000
      );


    return () => {

      active =
        false;

      window.clearInterval(
        interval
      );

    };

  }, [
    supabase,
    trackedInvitationId,
    canPropose,
  ]);


  /* =========================================================
     SEND CARD
     ========================================================= */

  const sendCard =
    async () => {

      if (
        !card ||
        sending ||
        !canPropose
      ) {
        return;
      }


      try {

        setSending(
          true
        );

        setSendMessage(
          ""
        );

        setOpenedAt(
          null
        );

        if (
          !sendRequestKeyRef.current
        ) {
          sendRequestKeyRef.current =
            crypto.randomUUID();
        }

        const {
          data,
          error:
            functionError,
        } =
          await supabase
          .functions
          .invoke(
            "send-invitation",
            {
              body: {

                card_source:
                  card.card_source ||
                  "official",

                card_id:
                  card.id,

                challenge_id:
                  challengeId ||
                  null,

                request_key:
                  sendRequestKeyRef.current,
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
              "Impossible d’envoyer cette carte."
          );
        }


        const newInvitationId =
          data.invitation_id;

          sendRequestKeyRef.current =
            null;

        if (
          newInvitationId
        ) {

          const normalizedInvitationId =
            String(
              newInvitationId
            );


          setTrackedInvitationId(
            normalizedInvitationId
          );


          setInvitation({
            id:
              normalizedInvitationId,

            sender_user_id:
              currentUserId,

            recipient_user_id:
              partner?.user_id ||
              null,

            couple_id:
              couple?.id ||
              couple?.couple_id ||
              null,

            opened_at:
              null,
            
            card_source:
              card.card_source ||
              "official",

            card_id:
              card.card_source ===
                "custom"
                ? null
                : card.id,

            custom_card_id:
              card.card_source ===
                "custom"
                ? card.id
                : null,

            effective_card_id:
              card.id,
          });


          const challengeQuery =
            challengeId
              ? `&challenge=${challengeId}`
              : "";


          const newUrl =
            `/card/${card.id}?invite=${normalizedInvitationId}${challengeQuery}`;


          window.history
            .replaceState(
              {},
              "",
              newUrl
            );

        }


        setSendMessage(
          activePerson
            ?.display_name
            ? `Carte envoyée à ${activePerson.display_name}.`
            : "Carte envoyée."
        );


      } catch (err) {

        console.error(
          "SEND CARD ERROR:",
          err
        );


        setSendMessage(
          err?.message ||
            "Impossible d’envoyer cette carte."
        );


      } finally {

        setSending(
          false
        );

      }

    };


  /* =========================================================
     DISPLAY
     ========================================================= */

  if (
    loading
  ) {
    return (
      <StateScreen
        kind="loading"
        className="card-page"
        text="Chargement…"
      />
    );
  }


  if (
    error ||
    !card
  ) {
    return (
      <StateScreen
        className="card-page"
        title="Carte introuvable."
        text="Elle a peut-être été retirée de la bibliothèque, ou la connexion a échoué."
        actionLabel="Retour"
        onAction={onBack}
      />
    );
  }


  if (
    card.lovense_mode ===
      "required" &&
    lovense.loading
  ) {
    return (
      <StateScreen
        kind="loading"
        className="card-page"
        text="Vérification du jouet…"
      />
    );
  }


  if (
    card.lovense_mode ===
      "required" &&
    !toyAvailable(
      card.lovense_toy,
      lovense.has
    )
  ) {
    return (
      <StateScreen
        className="card-page"
        title="Il manque le jouet."
        text={
          card.lovense_toy === "both"
            ? "Cette carte se joue avec le Lush et le Diamo connectés. Connecte-les depuis les réglages."
            : card.lovense_toy === "ring"
              ? "Cette carte se joue avec l’anneau Diamo connecté. Connecte-le depuis les réglages."
              : card.lovense_toy === "lush"
                ? "Cette carte se joue avec le Lush connecté. Connecte-le depuis les réglages."
                : "Cette carte se joue avec un jouet Lovense connecté. Connecte-le depuis les réglages."
        }
        actionLabel="Retour"
        onAction={onBack}
      />
    );
  }


  return (
    <main className={`card-page card-page-${card.type}`}>

      <header className="card-topbar">

        <button
          type="button"
          className="card-back"
          onClick={() => {

            onBack();

          }}
          aria-label="Retour"
        >
          <BackIcon />
        </button>


        <div className="card-topbar-text">

          <span className="card-logo">
            PROTOCOL
          </span>

          <span className="card-recipient">
            Pour{" "}
            {
              activePerson
                ?.display_name ||
              "ton partenaire"
            }
          </span>

        </div>

      </header>


      <section className="card-content">

        <div className="card-meta-top">

          <span className="card-type">
            {
              getTypeLabel(
                card.type
              )
            }
          </span>

          <span className="card-number">
            #{Number(card.library_key?.match(/\d+$/)?.[0])}
          </span>

        </div>


        <h1 className="card-title">
          {card.title}
        </h1>


        <p className="card-prompt">
          {
            card.displayPrompt
          }
        </p>

        {/* repères : intensité et durée, dans la couleur du type */}
        <div
          className="card-facts"
          data-type={card.type}
        >
          <span
            className="type-intensity"
            aria-hidden="true"
          >
            {INTENSITY_LEVELS.map((level) => (
              <i
                key={level.rank}
                className={
                  level.rank <= levelRank(card.intensity)
                    ? "is-active"
                    : ""
                }
              />
            ))}
          </span>

          <span>
            {levelForIntensity(card.intensity).title}
          </span>

          {Number(card.timer_seconds) > 0 && (
            <>
              <span
                className="card-facts-dot"
                aria-hidden="true"
              >
                ·
              </span>

              <span>
                {formatDuration(
                  Number(card.timer_seconds)
                )}
              </span>
            </>
          )}
        </div>

        {/* photos de la carte (album) et ton avis, privé :
            n'influencent pas le tirage */}
        <div className="card-extras-detail">
          <CardPhotos
            key={`photos-${card.card_source || "official"}-${card.id}`}
            supabase={supabase}
            cardSource={card.card_source || "official"}
            cardId={card.id}
            canTake
          />

          <CardRating
            key={`${card.card_source || "official"}-${card.id}`}
            supabase={supabase}
            cardSource={card.card_source || "official"}
            cardId={card.id}
            className="card-rating-detail"
          />

          {/* bibliothèque seulement : pas depuis une invitation ou un défi */}
          {canEdit &&
            !trackedInvitationId &&
            !challengeId &&
            (cardSource || "official") === "official" && (
              <button
                type="button"
                className="card-edit-button"
                onClick={() => setEditing(true)}
              >
                Modifier
              </button>
            )}
        </div>

        {editing && (
          <CardEditSheet
            supabase={supabase}
            card={card}
            onSaved={() => {
              setEditing(false);
              setReloadKey((value) => value + 1);
            }}
            onClose={() => setEditing(false)}
          />
        )}
        {card.type === "scene" &&
          sceneSteps.length > 0 && (

            <section className="scene-preview">

              <div className="scene-preview-heading">
                <span>
                  DÉROULÉ
                </span>

                <strong>
                  {sceneSteps.length} étapes
                </strong>
              </div>

              <div className="scene-preview-timeline">

                {sceneSteps.map(
                  (step) => (

                    <article
                      key={step.step_no}
                      className="scene-preview-step"
                    >

                      <div className="scene-preview-marker">
                        {String(
                          step.step_no
                        ).padStart(
                          2,
                          "0"
                        )}
                      </div>

                      <div className="scene-preview-step-content">

                        {step.title && (
                          <h2>
                            {step.title}
                          </h2>
                        )}

                        <p>
                          {
                            step.displayPrompt
                          }
                        </p>


                        {(step.prompt_active ||
                          step.title_active) && (

                          <div className="scene-private-role">

                            <span>
                              POUR{" "}
                              {(
                                activePerson
                                  ?.display_name ||
                                "JOUEUR ACTIF"
                              ).toUpperCase()}
                            </span>

                            {step.title_active && (
                              <strong>
                                {
                                  step.title_active
                                }
                              </strong>
                            )}

                            {step.displayPromptActive && (
                              <p>
                                {
                                  step.displayPromptActive
                                }
                              </p>
                            )}

                          </div>
                        )}


                        {(step.prompt_partner ||
                          step.title_partner) && (

                          <div className="scene-private-role">

                            <span>
                              POUR{" "}
                              {(
                                senderPerson
                                  ?.display_name ||
                                "PARTENAIRE"
                              ).toUpperCase()}
                            </span>

                            {step.title_partner && (
                              <strong>
                                {
                                  step.title_partner
                                }
                              </strong>
                            )}

                            {step.displayPromptPartner && (
                              <p>
                                {
                                  step.displayPromptPartner
                                }
                              </p>
                            )}

                          </div>
                        )}

                      </div>

                    </article>

                  )
                )}

              </div>

            </section>
          )}


        {/* Lovense : quel jouet sert à cette carte (piloté depuis Lovense Remote) */}
        {card.lovense_mode && (
          <LovenseBanner
            label={cardToyBanner(
              card.lovense_toy,
              lovense.has,
              {
                female: [activePerson, senderPerson].find((person) => person?.sex === "female")?.display_name,
                male: [activePerson, senderPerson].find((person) => person?.sex === "male")?.display_name,
              }
            )}
          />
        )}


        {canPropose ? (
          <>

            {openedAt ? (

              <>
              <p className="card-send-message">
                ✓ Vue par{" "}
                {
                  activePerson
                    ?.display_name
                }

                {formatOpenedTime(
                  openedAt
                ) && (
                  <>
                    {" · "}
                    {
                      formatOpenedTime(
                        openedAt
                      )
                    }
                  </>
                )}
              </p>

              {response && (
                <p className="card-response-received">
                  {activePerson?.display_name || "Ton partenaire"} a répondu
                  {" "}
                  <strong>
                    « {RESPONSE_LABELS[response]} »
                  </strong>
                </p>
              )}
              </>

            ) : sendMessage ? (

              <p className="card-send-message">
                {
                  sendMessage
                }
              </p>

            ) : null}


            {card.notForRecipient && (
              <p className="card-send-message card-not-for">
                C’est toi qui joues cette carte :{" "}
                {activePerson?.display_name ||
                  "ton partenaire"}{" "}
                la reçoit comme une proposition.
              </p>
            )}

            <button
              type="button"
              className="card-propose"
              onClick={
                sendCard
              }
              disabled={sending}
            >
              {
                sending
                  ? "Envoi…"
                  : `Proposer à ${
                      activePerson
                        ?.display_name ||
                      "mon partenaire"
                    }`
              }
            </button>

          </>
        ) : (

          <div className="card-received">
            <p className="card-send-message">

              {
                senderPerson
                  ?.display_name
                  ? `Proposé par ${senderPerson.display_name}.`
                  : "Proposé par ton partenaire."
              }

              {card.notForRecipient &&
                ` C’est ${senderPerson?.sex === "female" ? "elle" : "lui"} qui la jouera.`}

            </p>

            {/* réponse rapide : l'expéditeur la voit */}
            {trackedInvitationId && (
              <div
                className="card-responses"
                role="group"
                aria-label="Ta réponse"
              >
                {Object.entries(RESPONSE_LABELS).map(
                  ([value, label]) => (
                    <button
                      key={value}
                      type="button"
                      className={
                        response === value
                          ? "card-response is-selected"
                          : "card-response"
                      }
                      aria-pressed={response === value}
                      disabled={responding}
                      onClick={() => respond(value)}
                    >
                      {label}
                    </button>
                  )
                )}
              </div>
            )}
          </div>

        )}

      </section>

    </main>
  );
}