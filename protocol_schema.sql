


SET statement_timeout = 0;
SET lock_timeout = 0;
SET idle_in_transaction_session_timeout = 0;
SET client_encoding = 'UTF8';
SET standard_conforming_strings = on;
SELECT pg_catalog.set_config('search_path', '', false);
SET check_function_bodies = false;
SET xmloption = content;
SET client_min_messages = warning;
SET row_security = off;


CREATE SCHEMA IF NOT EXISTS "public";


ALTER SCHEMA "public" OWNER TO "pg_database_owner";


COMMENT ON SCHEMA "public" IS 'standard public schema';



CREATE OR REPLACE FUNCTION "public"."add_game_rule"("p_game_code" "text", "p_title" "text", "p_rule_text" "text", "p_target_player" integer, "p_duration_turns" integer, "p_rule_key" "text" DEFAULT NULL::"text") RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
declare

  v_game
    public.games%rowtype;

  v_rule_id bigint;

begin


  if
    p_target_player is not null
    and
    p_target_player not in (1,2)
  then
    raise exception
      'Invalid target player';
  end if;


  if p_duration_turns < 1 then
    raise exception
      'Invalid duration';
  end if;


  select *
  into v_game

  from public.games

  where code =
    upper(
      trim(
        p_game_code
      )
    )

  for update;


  if v_game.id is null then
    raise exception
      'Game not found';
  end if;


  insert into
  public.game_active_rules (

    game_id,

    source_card_id,

    rule_key,

    title,

    rule_text,

    target_player,

    remaining_turns,

    created_turn,

    expires_at_turn

  )

  values (

    v_game.id,

    v_game.current_card_id,

    p_rule_key,

    p_title,

    p_rule_text,

    p_target_player,

    p_duration_turns,

    v_game.turn_no,

    v_game.turn_no
      + p_duration_turns

  )

  returning id
  into v_rule_id;


  return jsonb_build_object(

    'rule_id',
    v_rule_id,

    'duration_turns',
    p_duration_turns,

    'target_player',
    p_target_player

  );

end;
$$;


ALTER FUNCTION "public"."add_game_rule"("p_game_code" "text", "p_title" "text", "p_rule_text" "text", "p_target_player" integer, "p_duration_turns" integer, "p_rule_key" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."advance_protocol"("p_game_code" "text", "p_action" "text", "p_duel_winner" integer DEFAULT NULL::integer) RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
declare

  v_game
    public.games%rowtype;

  v_current_card
    public.protocol_cards%rowtype;

  v_card
    public.protocol_cards%rowtype;

  v_card_rule
    public.protocol_card_rules%rowtype;


  /* -------------------------------------------------------
     Tour / joueur
     ------------------------------------------------------- */

  v_next_player integer;

  v_next_turn integer;

  v_next_phase text;

  v_player_sex text;


  /* -------------------------------------------------------
     Intensite
     ------------------------------------------------------- */

  v_profile_intensity integer;

  v_max_intensity integer;

  v_desired_min_intensity integer;

  v_min_intensity_primary integer;

  v_min_intensity_fallback integer;


  /* -------------------------------------------------------
     Scores / bonus
     ------------------------------------------------------- */

  v_score_p1 integer;

  v_score_p2 integer;

  v_reward integer;

  v_bonus_p1 jsonb;

  v_bonus_p2 jsonb;

  v_forced_type text;

  v_forced_by integer;


  /* -------------------------------------------------------
     Rules
     ------------------------------------------------------- */

  v_rule_target integer;

  v_persistent_count integer;


  /* -------------------------------------------------------
     Scenes
     ------------------------------------------------------- */

  v_scene_count integer;


  /* -------------------------------------------------------
     Truth rhythm
     ------------------------------------------------------- */

  v_truth_count integer;

  v_truth_early_count integer;

  v_truth_before_11_count integer;

  v_truth_late_count integer;

  v_truth_needed integer;

  v_late_truth_needed integer;

  v_remaining_turns integer;

  v_truth_required boolean := false;


  /* -------------------------------------------------------
     Duel rhythm
     ------------------------------------------------------- */

  v_duel_count integer;

  v_last_duel_turn integer;

begin


  /* =======================================================
     VALIDATION
     ======================================================= */

  if p_action not in (
    'done',
    'pass',
    'alternative',
    'duel'
  ) then

    raise exception
      'Invalid action';

  end if;


  /* =======================================================
     GAME LOCK
     ======================================================= */

  select *
  into v_game

  from public.games

  where code =
    upper(trim(p_game_code))

  for update;


  if v_game.id is null then

    raise exception
      'Game not found';

  end if;


  if v_game.status <> 'playing' then

    raise exception
      'Game is not playing';

  end if;


  /* =======================================================
     CURRENT CARD
     ======================================================= */

  select *
  into v_current_card

  from public.protocol_cards

  where id =
    v_game.current_card_id;


  if v_current_card.id is null then

    raise exception
      'Current card not found';

  end if;


  /* =======================================================
     SCORES / BONUS
     ======================================================= */

  v_score_p1 :=
    coalesce(
      v_game.score_player_1,
      0
    );

  v_score_p2 :=
    coalesce(
      v_game.score_player_2,
      0
    );


  v_bonus_p1 :=
    coalesce(
      v_game.bonus_player_1,
      '{}'::jsonb
    );

  v_bonus_p2 :=
    coalesce(
      v_game.bonus_player_2,
      '{}'::jsonb
    );


  /* =======================================================
     DONE
     ======================================================= */

  if p_action = 'done' then

    v_reward := 1;


    if
      v_game.active_player = 1

      and

      coalesce(
        (
          v_bonus_p1
          ->> 'double_reward'
        )::boolean,
        false
      )
    then

      v_reward := 2;

      v_bonus_p1 :=
        v_bonus_p1
        - 'double_reward';


    elsif
      v_game.active_player = 2

      and

      coalesce(
        (
          v_bonus_p2
          ->> 'double_reward'
        )::boolean,
        false
      )
    then

      v_reward := 2;

      v_bonus_p2 :=
        v_bonus_p2
        - 'double_reward';

    end if;


    if v_game.active_player = 1 then

      v_score_p1 :=
        v_score_p1 + v_reward;

    else

      v_score_p2 :=
        v_score_p2 + v_reward;

    end if;

  end if;


  /* =======================================================
     DUEL
     ======================================================= */

  if p_action = 'duel' then

    if v_current_card.type <> 'duel' then

      raise exception
        'Current card is not a duel';

    end if;


    if p_duel_winner not in (1, 2) then

      raise exception
        'Invalid duel winner';

    end if;


    if p_duel_winner = 1 then

      v_score_p1 :=
        v_score_p1 + 2;

    else

      v_score_p2 :=
        v_score_p2 + 2;

    end if;

  end if;


  /* =======================================================
     RESOLVE HISTORY
     ======================================================= */

  update public.game_card_history

  set
    outcome =
      case

        when p_action = 'duel'
          then 'done'

        else
          p_action

      end,

    resolved_at =
      now()

  where game_id =
      v_game.id

    and card_id =
      v_game.current_card_id

    and outcome is null;


  /* =======================================================
     TICK EXISTING RULES
     ======================================================= */

  if p_action <> 'alternative' then

    perform public.tick_game_rules(
      v_game.id
    );

  end if;


  /* =======================================================
     CREATE RULE FROM CURRENT CARD
     ======================================================= */

  if p_action = 'done' then


    select *
    into v_card_rule

    from public.protocol_card_rules

    where card_id =
      v_current_card.id

      and active = true

    limit 1;


    if v_card_rule.id is not null then


      v_rule_target :=
        case

          when v_card_rule.target_mode =
            'active'
          then
            v_game.active_player


          when v_card_rule.target_mode =
            'partner'
          then

            case

              when v_game.active_player = 1
                then 2

              else 1

            end


          when v_card_rule.target_mode =
            'both'
          then
            null


          else
            null

        end;


      /* ===================================================
         BOTH
         =================================================== */

      if v_rule_target is null then


        if
          public.protocol_player_rule_count(
            v_game.id,
            1
          ) < 2

          and

          public.protocol_player_rule_count(
            v_game.id,
            2
          ) < 2

          and

          not public.protocol_player_has_active_rule(
            v_game.id,
            1
          )

          and

          not public.protocol_player_has_active_rule(
            v_game.id,
            2
          )
        then


          insert into public.game_active_rules (
            game_id,
            source_card_id,
            rule_key,
            title,
            rule_text,
            target_player,
            remaining_turns,
            active,
            created_turn,
            expires_at_turn
          )

          values (
            v_game.id,
            v_current_card.id,
            v_card_rule.rule_key,
            v_card_rule.title,
            v_card_rule.rule_text,
            null,
            v_card_rule.duration_turns,
            true,
            v_game.turn_no,
            v_game.turn_no
              + v_card_rule.duration_turns
          )

          on conflict (
            game_id,
            source_card_id,
            rule_key
          )

          where source_card_id is not null

          do nothing;

        end if;


      /* ===================================================
         ACTIVE / PARTNER
         =================================================== */

      else


        if
          public.protocol_player_rule_count(
            v_game.id,
            v_rule_target
          ) < 2

          and

          not public.protocol_player_has_active_rule(
            v_game.id,
            v_rule_target
          )
        then


          insert into public.game_active_rules (
            game_id,
            source_card_id,
            rule_key,
            title,
            rule_text,
            target_player,
            remaining_turns,
            active,
            created_turn,
            expires_at_turn
          )

          values (
            v_game.id,
            v_current_card.id,
            v_card_rule.rule_key,
            v_card_rule.title,
            v_card_rule.rule_text,
            v_rule_target,
            v_card_rule.duration_turns,
            true,
            v_game.turn_no,
            v_game.turn_no
              + v_card_rule.duration_turns
          )

          on conflict (
            game_id,
            source_card_id,
            rule_key
          )

          where source_card_id is not null

          do nothing;

        end if;

      end if;

    end if;

  end if;


  /* =======================================================
     NEXT TURN / PLAYER
     ======================================================= */

  if p_action = 'alternative' then

    v_next_player :=
      v_game.active_player;

    v_next_turn :=
      v_game.turn_no;

    v_next_phase :=
      v_game.phase;


  else


    /* TAKE CONTROL P1 */

    if coalesce(
      (
        v_bonus_p1
        ->> 'take_control_armed'
      )::boolean,
      false
    )
    then

      v_next_player := 1;

      v_bonus_p1 :=
        v_bonus_p1
        - 'take_control_armed';


    /* TAKE CONTROL P2 */

    elsif coalesce(
      (
        v_bonus_p2
        ->> 'take_control_armed'
      )::boolean,
      false
    )
    then

      v_next_player := 2;

      v_bonus_p2 :=
        v_bonus_p2
        - 'take_control_armed';


    /* NORMAL ALTERNATION */

    else

      v_next_player :=
        case

          when v_game.active_player = 1
            then 2

          else 1

        end;

    end if;


    v_next_turn :=
      v_game.turn_no + 1;


    v_next_phase :=
      public.protocol_phase(
        v_next_turn,
        v_game.target_turns
      );

  end if;


  /* =======================================================
     FINISH
     ======================================================= */

  if
    p_action <> 'alternative'

    and

    v_next_turn >
      v_game.target_turns
  then


    update public.games

    set
      status =
        'finished',

      phase =
        'finished',

      finished_at =
        now(),

      scene_step_no =
        null,

      scene_step_read_player_1 =
        false,

      scene_step_read_player_2 =
        false,

      score_player_1 =
        v_score_p1,

      score_player_2 =
        v_score_p2,

      bonus_player_1 =
        v_bonus_p1,

      bonus_player_2 =
        v_bonus_p2

    where id =
      v_game.id;


    return jsonb_build_object(

      'finished',
      true,

      'score_player_1',
      v_score_p1,

      'score_player_2',
      v_score_p2,

      'phase',
      'finished'

    );

  end if;


  /* =======================================================
     NEXT PLAYER SEX
     ======================================================= */

  v_player_sex :=
    case

      when v_next_player = 1
        then v_game.player_1_sex

      else
        v_game.player_2_sex

    end;


  /* =======================================================
     CHOOSE TYPE
     ======================================================= */

  v_forced_type :=
    null;

  v_forced_by :=
    null;


  if
    v_bonus_p1
    ? 'choose_type_armed'
  then

    v_forced_type :=
      v_bonus_p1
      ->> 'choose_type_armed';

    v_forced_by :=
      1;


  elsif
    v_bonus_p2
    ? 'choose_type_armed'
  then

    v_forced_type :=
      v_bonus_p2
      ->> 'choose_type_armed';

    v_forced_by :=
      2;

  end if;


  /* =======================================================
     INTENSITY CEILING
     ======================================================= */

  v_profile_intensity :=
    coalesce(
      (
        v_game.shared_profile
        ->> 'intensity'
      )::integer,
      1
    );


  v_max_intensity :=
    public.protocol_max_intensity(
      v_profile_intensity,
      v_next_turn
    );


  /* =======================================================
     INTENSITY FLOOR

     T1-12  : 1
     T13-16 : 2
     T17-20 : 3

     Jamais au-dessus de ce que la calibration autorise.
     ======================================================= */

  v_desired_min_intensity :=
    case

      when v_next_turn >= 17
        then 3

      when v_next_turn >= 13
        then 2

      else 1

    end;


  v_min_intensity_primary :=
    least(
      v_desired_min_intensity,
      v_max_intensity
    );


  v_min_intensity_fallback :=
    least(
      v_desired_min_intensity,
      v_profile_intensity
    );


  /* =======================================================
     COUNTERS
     ======================================================= */

  v_scene_count :=
    public.protocol_scene_count(
      v_game.id
    );


  v_truth_count :=
    public.protocol_type_count(
      v_game.id,
      'truth'
    );


  v_truth_early_count :=
    public.protocol_type_count_window(
      v_game.id,
      'truth',
      1,
      6
    );


  v_truth_before_11_count :=
    public.protocol_type_count_window(
      v_game.id,
      'truth',
      1,
      10
    );


  v_truth_late_count :=
    public.protocol_type_count_window(
      v_game.id,
      'truth',
      11,
      v_game.target_turns
    );


  v_duel_count :=
    public.protocol_type_count(
      v_game.id,
      'duel'
    );


  v_last_duel_turn :=
    public.protocol_last_type_turn(
      v_game.id,
      'duel'
    );


  v_persistent_count :=
    public.protocol_persistent_count(
      v_game.id
    );


  /* =======================================================
     TRUTH REQUIREMENTS
     ======================================================= */

  v_remaining_turns :=
    v_game.target_turns
    - v_next_turn
    + 1;


  /* Minimum 5 total */

  v_truth_needed :=
    greatest(
      5 - v_truth_count,
      0
    );


  /* Minimum 2 during T11+ */

  v_late_truth_needed :=
    greatest(
      2 - v_truth_late_count,
      0
    );


  /*
   * Une vérité devient obligatoire uniquement
   * quand il ne reste plus assez de marge.
   *
   * Un choose_type explicite autre que truth
   * reste prioritaire sur cette obligation.
   */

  v_truth_required :=
    (
      v_forced_type is null
      or
      v_forced_type = 'truth'
    )

    and

    (

      (
        v_truth_needed > 0

        and

        v_remaining_turns <=
          v_truth_needed
      )

      or

      (
        v_next_turn >= 11

        and

        v_late_truth_needed > 0

        and

        v_remaining_turns <=
          v_late_truth_needed
      )

    );


  /* =======================================================
     PRIMARY SELECTION
     ======================================================= */

  select *
  into v_card

  from public.protocol_cards c

  where c.active = true

    and c.library_version = 'v2'


    /* -----------------------------------------------------
       SEX
       ----------------------------------------------------- */

    and (
      c.target_sex is null
      or
      c.target_sex =
        v_player_sex
    )


    /* -----------------------------------------------------
       CHOOSE TYPE
       ----------------------------------------------------- */

    and (
      v_forced_type is null
      or
      c.type =
        v_forced_type
    )


    /* -----------------------------------------------------
       TRUTH HARD LIMITS
       ----------------------------------------------------- */

    and (

      c.type <> 'truth'

      or

      (

        /* Maximum 6 total */

        v_truth_count < 6


        /* Maximum 2 truths T1-6 */

        and (

          v_next_turn > 6

          or

          v_truth_early_count < 2

        )


        /*
         * Maximum 4 truths by T10.
         * This reserves at least 2 possible slots for T11+.
         */

        and (

          v_next_turn > 10

          or

          v_truth_before_11_count < 4

        )

      )

    )


    /* -----------------------------------------------------
       TRUTH REQUIRED
       ----------------------------------------------------- */

    and (

      not v_truth_required

      or

      c.type = 'truth'

    )


    /* -----------------------------------------------------
       DUELS
       Max 4
       At least 2 complete cards between duels
       ----------------------------------------------------- */

    and (

      c.type <> 'duel'

      or

      (

        v_duel_count < 4

        and

        (

          v_last_duel_turn is null

          or

          v_next_turn
          - v_last_duel_turn
          >= 3

        )

      )

    )


    /* -----------------------------------------------------
       PERSISTENT GLOBAL MAX 2
       ----------------------------------------------------- */

    and (

      not exists (

        select 1

        from public.protocol_card_rules pr

        where pr.card_id =
          c.id

          and pr.active =
            true

      )

      or

      v_persistent_count < 2

    )


    /* -----------------------------------------------------
       INTENSITY RANGE
       ----------------------------------------------------- */

    and c.intensity >=
      v_min_intensity_primary

    and c.intensity <=
      v_max_intensity


    /* -----------------------------------------------------
       CALIBRATION DIMENSIONS
       ----------------------------------------------------- */

    and c.tension <=
      coalesce(
        (
          v_game.shared_profile
          ->> 'tension'
        )::integer,
        1
      )


    and c.sensations <=
      coalesce(
        (
          v_game.shared_profile
          ->> 'sensations'
        )::integer,
        1
      )


    and c.unexpected <=
      coalesce(
        (
          v_game.shared_profile
          ->> 'unexpected'
        )::integer,
        1
      )


    /* -----------------------------------------------------
       SCENES
       ----------------------------------------------------- */

    and public.protocol_scene_allowed(
      v_game.id,
      c.id,
      v_next_turn
    )


    /* -----------------------------------------------------
       PERSISTENT TARGET / QUOTA / CUTOFF
       ----------------------------------------------------- */

    and public.protocol_rule_card_allowed(
      v_game.id,
      c.id,
      v_next_player,
      v_next_turn
    )


    /* -----------------------------------------------------
       NO REPEAT
       ----------------------------------------------------- */

    and not exists (

      select 1

      from public.game_card_history h

      where h.game_id =
        v_game.id

        and h.card_id =
          c.id

    )


  order by


    /* =====================================================
       1. HARD TRUTH REQUIREMENT
       ===================================================== */

    case

      when v_truth_required
           and c.type = 'truth'
        then -5000

      when v_truth_required
        then 5000

      else 0

    end,


    /* =====================================================
       2. SCENE PRIORITY

       If none by T14, very high priority.
       ===================================================== */

    case

      when
        v_scene_count = 0

        and

        v_next_turn >= 14

        and

        c.type = 'scene'
      then
        -1000


      when c.type = 'scene'
      then
        60


      else
        0

    end,


    /* =====================================================
       3. PERSISTENT PRIORITY
       ===================================================== */

    case

      when
        v_persistent_count = 0

        and

        exists (

          select 1

          from public.protocol_card_rules pr

          where pr.card_id =
            c.id

            and pr.active =
              true

        )

        and

        v_next_turn between 10 and 16

      then
        -160


      when
        v_persistent_count = 0

        and

        exists (

          select 1

          from public.protocol_card_rules pr

          where pr.card_id =
            c.id

            and pr.active =
              true

        )

        and

        v_next_turn between 6 and 9

      then
        -45


      else
        0

    end,


    /* =====================================================
       4. SOFT TRUTH DISTRIBUTION
       ===================================================== */

    case


      /* T1-6 : doucement, max 2 */

      when
        c.type = 'truth'

        and

        v_next_turn <= 6

        and

        v_truth_early_count < 2

      then
        -20


      /* T7-10 : viser environ 3-4 truths total */

      when
        c.type = 'truth'

        and

        v_next_turn between 7 and 10

        and

        v_truth_count < 3

      then
        -65


      when
        c.type = 'truth'

        and

        v_next_turn between 7 and 10

        and

        v_truth_count < 4

      then
        -30


      /* T11-16 : commencer les truths tardives */

      when
        c.type = 'truth'

        and

        v_next_turn between 11 and 16

        and

        v_truth_late_count = 0

      then
        -110


      when
        c.type = 'truth'

        and

        v_next_turn between 11 and 16

        and

        v_truth_late_count = 1

      then
        -60


      /* T17-20 : finir les 2 truths tardives */

      when
        c.type = 'truth'

        and

        v_next_turn >= 17

        and

        v_truth_late_count < 2

      then
        -260


      when
        c.type = 'truth'

        and

        v_next_turn >= 11

        and

        v_truth_count < 5

      then
        -40


      else
        0

    end,


    /* =====================================================
       5. FINALE INTENSITY PRIORITY

       T19-20 :
       5 > 4 > 3
       ===================================================== */

    case

      when
        v_next_turn >= 19

        and

        c.intensity = 5
      then
        -260


      when
        v_next_turn >= 19

        and

        c.intensity = 4
      then
        -190


      when
        v_next_turn >= 19

        and

        c.intensity = 3
      then
        -60


      else
        0

    end,


    /* =====================================================
       6. EXISTING TYPE DIVERSITY
       ===================================================== */

    case

      when v_forced_type is not null
        then 0

      else
        public.protocol_type_penalty(
          v_game.id,
          c.type,
          v_current_card.type
        )

    end,


    random()

  limit 1;


  /* =======================================================
     FALLBACK

     Same rhythm constraints.
     Lower intensity ceiling = profile intensity.
     ======================================================= */

  if v_card.id is null then


    select *
    into v_card

    from public.protocol_cards c

    where c.active = true

      and c.library_version =
        'v2'


      and (
        c.target_sex is null
        or
        c.target_sex =
          v_player_sex
      )


      and (
        v_forced_type is null
        or
        c.type =
          v_forced_type
      )


      /* TRUTH LIMITS */

      and (

        c.type <> 'truth'

        or

        (

          v_truth_count < 6

          and (

            v_next_turn > 6
            or
            v_truth_early_count < 2

          )

          and (

            v_next_turn > 10
            or
            v_truth_before_11_count < 4

          )

        )

      )


      and (

        not v_truth_required
        or
        c.type = 'truth'

      )


      /* DUEL */

      and (

        c.type <> 'duel'

        or

        (

          v_duel_count < 4

          and

          (

            v_last_duel_turn is null

            or

            v_next_turn
            - v_last_duel_turn
            >= 3

          )

        )

      )


      /* PERSISTENT MAX */

      and (

        not exists (

          select 1

          from public.protocol_card_rules pr

          where pr.card_id =
            c.id

            and pr.active =
              true

        )

        or

        v_persistent_count < 2

      )


      /* INTENSITY FALLBACK */

      and c.intensity >=
        v_min_intensity_fallback

      and c.intensity <=
        v_profile_intensity


      /* CALIBRATION */

      and c.tension <=
        coalesce(
          (
            v_game.shared_profile
            ->> 'tension'
          )::integer,
          1
        )


      and c.sensations <=
        coalesce(
          (
            v_game.shared_profile
            ->> 'sensations'
          )::integer,
          1
        )


      and c.unexpected <=
        coalesce(
          (
            v_game.shared_profile
            ->> 'unexpected'
          )::integer,
          1
        )


      /* SCENE */

      and public.protocol_scene_allowed(
        v_game.id,
        c.id,
        v_next_turn
      )


      /* RULE */

      and public.protocol_rule_card_allowed(
        v_game.id,
        c.id,
        v_next_player,
        v_next_turn
      )


      /* NO REPEAT */

      and not exists (

        select 1

        from public.game_card_history h

        where h.game_id =
          v_game.id

          and h.card_id =
            c.id

      )


    order by


      /* HARD TRUTH */

      case

        when v_truth_required
             and c.type = 'truth'
          then -5000

        when v_truth_required
          then 5000

        else 0

      end,


      /* SCENE */

      case

        when
          v_scene_count = 0

          and

          v_next_turn >= 14

          and

          c.type = 'scene'
        then
          -1000


        when c.type = 'scene'
        then
          60


        else
          0

      end,


      /* PERSISTENT */

      case

        when
          v_persistent_count = 0

          and

          exists (

            select 1

            from public.protocol_card_rules pr

            where pr.card_id =
              c.id

              and pr.active =
                true

          )

          and

          v_next_turn between 10 and 16

        then
          -160


        when
          v_persistent_count = 0

          and

          exists (

            select 1

            from public.protocol_card_rules pr

            where pr.card_id =
              c.id

              and pr.active =
                true

          )

          and

          v_next_turn between 6 and 9

        then
          -45


        else
          0

      end,


      /* SOFT TRUTH */

      case

        when
          c.type = 'truth'

          and

          v_next_turn <= 6

          and

          v_truth_early_count < 2

        then
          -20


        when
          c.type = 'truth'

          and

          v_next_turn between 7 and 10

          and

          v_truth_count < 3

        then
          -65


        when
          c.type = 'truth'

          and

          v_next_turn between 7 and 10

          and

          v_truth_count < 4

        then
          -30


        when
          c.type = 'truth'

          and

          v_next_turn between 11 and 16

          and

          v_truth_late_count = 0

        then
          -110


        when
          c.type = 'truth'

          and

          v_next_turn between 11 and 16

          and

          v_truth_late_count = 1

        then
          -60


        when
          c.type = 'truth'

          and

          v_next_turn >= 17

          and

          v_truth_late_count < 2

        then
          -260


        when
          c.type = 'truth'

          and

          v_next_turn >= 11

          and

          v_truth_count < 5

        then
          -40


        else
          0

      end,


      /* FINALE INTENSITY */

      case

        when
          v_next_turn >= 19
          and
          c.intensity = 5
        then
          -260

        when
          v_next_turn >= 19
          and
          c.intensity = 4
        then
          -190

        when
          v_next_turn >= 19
          and
          c.intensity = 3
        then
          -60

        else
          0

      end,


      /* DIVERSITY */

      case

        when v_forced_type is not null
          then 0

        else
          public.protocol_type_penalty(
            v_game.id,
            c.type,
            v_current_card.type
          )

      end,


      random()

    limit 1;

  end if;


  /* =======================================================
     NO CARD
     ======================================================= */

  if v_card.id is null then

    if v_forced_type is not null then

      raise exception
        'No unused compatible card of this type';

    else

      raise exception
        'No unused compatible card';

    end if;

  end if;


  /* =======================================================
     CONSUME CHOOSE TYPE
     ======================================================= */

  if v_forced_by = 1 then

    v_bonus_p1 :=
      v_bonus_p1
      - 'choose_type_armed';


  elsif v_forced_by = 2 then

    v_bonus_p2 :=
      v_bonus_p2
      - 'choose_type_armed';

  end if;


  /* =======================================================
     UPDATE GAME
     ======================================================= */

  update public.games

  set
    current_card_id =
      v_card.id,

    turn_no =
      v_next_turn,

    active_player =
      v_next_player,

    phase =
      v_next_phase,

    scene_step_no =
      case

        when v_card.type = 'scene'
          then 1

        else null

      end,

    scene_step_read_player_1 =
      false,

    scene_step_read_player_2 =
      false,

    score_player_1 =
      v_score_p1,

    score_player_2 =
      v_score_p2,

    bonus_player_1 =
      v_bonus_p1,

    bonus_player_2 =
      v_bonus_p2

  where id =
    v_game.id;


  /* =======================================================
     NEW HISTORY
     ======================================================= */

  insert into public.game_card_history (
    game_id,
    card_id,
    turn_no,
    player_no
  )

  values (
    v_game.id,
    v_card.id,
    v_next_turn,
    v_next_player
  );


  /* =======================================================
     RETURN DEBUG DATA
     ======================================================= */

  return jsonb_build_object(

    'finished',
      false,

    'card_id',
      v_card.id,

    'card_type',
      v_card.type,

    'card_intensity',
      v_card.intensity,

    'turn_no',
      v_next_turn,

    'active_player',
      v_next_player,

    'phase',
      v_next_phase,

    'target_turns',
      v_game.target_turns,

    'score_player_1',
      v_score_p1,

    'score_player_2',
      v_score_p2,

    'truth_count_before',
      v_truth_count,

    'truth_early_before',
      v_truth_early_count,

    'truth_late_before',
      v_truth_late_count,

    'truth_required',
      v_truth_required,

    'duel_count_before',
      v_duel_count,

    'scene_count_before',
      v_scene_count,

    'persistent_count_before',
      v_persistent_count,

    'min_intensity',
      v_min_intensity_primary,

    'max_intensity',
      v_max_intensity,

    'scene_step_no',
      case

        when v_card.type = 'scene'
          then 1

        else null

      end

  );

end;
$$;


ALTER FUNCTION "public"."advance_protocol"("p_game_code" "text", "p_action" "text", "p_duel_winner" integer) OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."advance_scene_step"("p_game_code" "text", "p_player_no" integer) RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
declare

  v_game
    public.games%rowtype;

  v_card
    public.protocol_cards%rowtype;

  v_step_count integer;

  v_next_step integer;

  v_scene_state jsonb;

  v_is_private boolean;

begin


  if p_player_no not in (1,2) then
    raise exception
      'Invalid player';
  end if;


  select *
  into v_game
  from public.games
  where code =
    upper(trim(p_game_code))
  for update;


  if v_game.id is null then
    raise exception
      'Game not found';
  end if;


  if v_game.status <> 'playing' then
    raise exception
      'Game is not playing';
  end if;


  if v_game.active_player <> p_player_no then
    raise exception
      'Not active player';
  end if;


  select *
  into v_card
  from public.protocol_cards
  where id =
    v_game.current_card_id;


  if
    v_card.id is null
    or
    v_card.type <> 'scene'
  then
    raise exception
      'Current card is not a scene';
  end if;


  select count(*)
  into v_step_count
  from public.protocol_scene_steps
  where card_id =
    v_card.id;


  if v_step_count = 0 then
    raise exception
      'Scene has no steps';
  end if;


  v_scene_state :=
    public.get_scene_state(
      p_game_code,
      p_player_no
    );


  v_is_private :=
    coalesce(
      (
        v_scene_state
        ->> 'is_private'
      )::boolean,
      false
    );


  /* =======================================================
     PRIVATE STEP : BOTH PLAYERS MUST HAVE READ
     ======================================================= */

  if v_is_private then

    if not (
      v_game.scene_step_read_player_1
      and
      v_game.scene_step_read_player_2
    )
    then
      raise exception
        'Both players must read the private instruction first';
    end if;

  end if;


  v_next_step :=
    coalesce(
      v_game.scene_step_no,
      1
    ) + 1;


  if v_next_step > v_step_count then
    raise exception
      'Already on last scene step';
  end if;


  update public.games
  set
    scene_step_no =
      v_next_step,

    scene_step_read_player_1 =
      false,

    scene_step_read_player_2 =
      false

  where id =
    v_game.id;


  return jsonb_build_object(

    'step_no',
    v_next_step,

    'step_count',
    v_step_count,

    'is_last',
    v_next_step >= v_step_count

  );

end;
$$;


ALTER FUNCTION "public"."advance_scene_step"("p_game_code" "text", "p_player_no" integer) OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."buy_protocol_bonus"("p_game_code" "text", "p_player_no" integer, "p_bonus" "text") RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
declare
  v_game public.games%rowtype;
  v_cost integer;
  v_score integer;
  v_current_bonus jsonb;
begin

  if p_player_no not in (1, 2) then
    raise exception 'Invalid player';
  end if;

  if p_bonus not in (
    'take_control',
    'double_reward',
    'choose_type'
  ) then
    raise exception 'Invalid bonus';
  end if;

  select *
  into v_game
  from public.games
  where code = upper(trim(p_game_code))
  for update;

  if v_game.id is null then
    raise exception 'Game not found';
  end if;

  if v_game.status <> 'playing' then
    raise exception 'Game is not playing';
  end if;

  v_cost :=
    case p_bonus
      when 'choose_type' then 2
      when 'take_control' then 3
      when 'double_reward' then 3
    end;

  if p_player_no = 1 then
    v_score := v_game.score_player_1;
    v_current_bonus := v_game.bonus_player_1;
  else
    v_score := v_game.score_player_2;
    v_current_bonus := v_game.bonus_player_2;
  end if;

  if v_score < v_cost then
    raise exception 'Not enough points';
  end if;

  /*
   * Pas de double achat du même pouvoir
   * tant qu'il n'a pas été consommé.
   */
  if coalesce(
    (v_current_bonus ->> p_bonus)::boolean,
    false
  ) then
    raise exception 'Bonus already owned';
  end if;

  if p_player_no = 1 then

    update public.games
    set
      score_player_1 =
        score_player_1 - v_cost,

      bonus_player_1 =
        bonus_player_1 ||
        jsonb_build_object(
          p_bonus,
          true
        )

    where id = v_game.id;

  else

    update public.games
    set
      score_player_2 =
        score_player_2 - v_cost,

      bonus_player_2 =
        bonus_player_2 ||
        jsonb_build_object(
          p_bonus,
          true
        )

    where id = v_game.id;

  end if;

  return jsonb_build_object(
    'ok', true,
    'bonus', p_bonus,
    'cost', v_cost
  );

end;
$$;


ALTER FUNCTION "public"."buy_protocol_bonus"("p_game_code" "text", "p_player_no" integer, "p_bonus" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."get_active_rules"("p_game_code" "text", "p_player_no" integer) RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
declare

  v_game_id uuid;

  v_rules jsonb;

begin


  if p_player_no not in (1,2) then
    raise exception
      'Invalid player';
  end if;


  select id
  into v_game_id

  from public.games

  where code =
    upper(
      trim(
        p_game_code
      )
    );


  if v_game_id is null then
    raise exception
      'Game not found';
  end if;


  select
    coalesce(
      jsonb_agg(
        jsonb_build_object(

          'id',
          r.id,

          'rule_key',
          r.rule_key,

          'title',
          r.title,

          'rule_text',
          r.rule_text,

          'target_player',
          r.target_player,

          'remaining_turns',
          r.remaining_turns,

          'created_turn',
          r.created_turn

        )
        order by
          r.created_at,
          r.id
      ),
      '[]'::jsonb
    )

  into v_rules

  from public.game_active_rules r

  where r.game_id =
      v_game_id

    and r.active = true

    and r.remaining_turns > 0

    and (
      r.target_player is null
      or
      r.target_player =
        p_player_no
    );


  return v_rules;

end;
$$;


ALTER FUNCTION "public"."get_active_rules"("p_game_code" "text", "p_player_no" integer) OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."get_scene_state"("p_game_code" "text", "p_player_no" integer) RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
declare

  v_game
    public.games%rowtype;

  v_card
    public.protocol_cards%rowtype;

  v_step
    public.protocol_scene_steps%rowtype;

  v_step_count integer;

  v_current_step integer;

  v_title text;

  v_prompt text;

  v_is_private boolean;

  v_is_active_player boolean;

begin


  if p_player_no not in (1,2) then
    raise exception
      'Invalid player';
  end if;


  select *
  into v_game
  from public.games
  where code =
    upper(trim(p_game_code));


  if v_game.id is null then
    raise exception
      'Game not found';
  end if;


  select *
  into v_card
  from public.protocol_cards
  where id =
    v_game.current_card_id;


  if
    v_card.id is null
    or
    v_card.type <> 'scene'
  then

    return jsonb_build_object(
      'is_multistep',
      false
    );

  end if;


  select count(*)
  into v_step_count
  from public.protocol_scene_steps
  where card_id =
    v_card.id;


  if v_step_count = 0 then

    return jsonb_build_object(
      'is_multistep',
      false
    );

  end if;


  v_current_step :=
    coalesce(
      v_game.scene_step_no,
      1
    );


  select *
  into v_step
  from public.protocol_scene_steps
  where card_id =
      v_card.id
    and step_no =
      v_current_step;


  if v_step.id is null then
    raise exception
      'Scene step not found';
  end if;


  v_is_active_player :=
    p_player_no =
    v_game.active_player;


  /* =======================================================
     JOUEUR ACTIF
     ======================================================= */

  if v_is_active_player then

    v_title :=
      coalesce(
        v_step.title_active,

        case
          when p_player_no = 1
            then v_step.title_player_1
          else v_step.title_player_2
        end,

        v_step.title
      );


    v_prompt :=
      coalesce(
        v_step.prompt_active,

        case
          when p_player_no = 1
            then v_step.prompt_player_1
          else v_step.prompt_player_2
        end,

        v_step.prompt
      );


    v_is_private :=
      v_step.prompt_active is not null
      or
      v_step.title_active is not null
      or
      (
        p_player_no = 1
        and
        (
          v_step.prompt_player_1 is not null
          or
          v_step.title_player_1 is not null
        )
      )
      or
      (
        p_player_no = 2
        and
        (
          v_step.prompt_player_2 is not null
          or
          v_step.title_player_2 is not null
        )
      );


  /* =======================================================
     PARTENAIRE
     ======================================================= */

  else

    v_title :=
      coalesce(
        v_step.title_partner,

        case
          when p_player_no = 1
            then v_step.title_player_1
          else v_step.title_player_2
        end,

        v_step.title
      );


    v_prompt :=
      coalesce(
        v_step.prompt_partner,

        case
          when p_player_no = 1
            then v_step.prompt_player_1
          else v_step.prompt_player_2
        end,

        v_step.prompt
      );


    v_is_private :=
      v_step.prompt_partner is not null
      or
      v_step.title_partner is not null
      or
      (
        p_player_no = 1
        and
        (
          v_step.prompt_player_1 is not null
          or
          v_step.title_player_1 is not null
        )
      )
      or
      (
        p_player_no = 2
        and
        (
          v_step.prompt_player_2 is not null
          or
          v_step.title_player_2 is not null
        )
      );

  end if;


  return jsonb_build_object(

    'is_multistep',
    true,

    'card_id',
    v_card.id,

    'step_no',
    v_current_step,

    'step_count',
    v_step_count,

    'title',
    v_title,

    'prompt',
    v_prompt,

    'is_private',
    v_is_private,

    'is_active_player',
    v_is_active_player,

    'is_last',
    v_current_step >=
      v_step_count

  );

end;
$$;


ALTER FUNCTION "public"."get_scene_state"("p_game_code" "text", "p_player_no" integer) OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."mark_scene_step_read"("p_game_code" "text", "p_player_no" integer) RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
declare

  v_game
    public.games%rowtype;

  v_card
    public.protocol_cards%rowtype;

  v_scene_state jsonb;

begin


  if p_player_no not in (1,2) then
    raise exception
      'Invalid player';
  end if;


  select *
  into v_game
  from public.games
  where code =
    upper(trim(p_game_code))
  for update;


  if v_game.id is null then
    raise exception
      'Game not found';
  end if;


  if v_game.status <> 'playing' then
    raise exception
      'Game is not playing';
  end if;


  select *
  into v_card
  from public.protocol_cards
  where id =
    v_game.current_card_id;


  if
    v_card.id is null
    or
    v_card.type <> 'scene'
  then
    raise exception
      'Current card is not a scene';
  end if;


  v_scene_state :=
    public.get_scene_state(
      p_game_code,
      p_player_no
    );


  if not coalesce(
    (
      v_scene_state
      ->> 'is_multistep'
    )::boolean,
    false
  )
  then
    raise exception
      'Current scene is not multistep';
  end if;


  if not coalesce(
    (
      v_scene_state
      ->> 'is_private'
    )::boolean,
    false
  )
  then
    raise exception
      'Current step is not private';
  end if;


  if p_player_no = 1 then

    update public.games
    set scene_step_read_player_1 = true
    where id = v_game.id;

  else

    update public.games
    set scene_step_read_player_2 = true
    where id = v_game.id;

  end if;


  select *
  into v_game
  from public.games
  where id = v_game.id;


  return jsonb_build_object(

    'player_1_read',
    v_game.scene_step_read_player_1,

    'player_2_read',
    v_game.scene_step_read_player_2,

    'both_read',
    (
      v_game.scene_step_read_player_1
      and
      v_game.scene_step_read_player_2
    )

  );

end;
$$;


ALTER FUNCTION "public"."mark_scene_step_read"("p_game_code" "text", "p_player_no" integer) OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."next_protocol_card"("p_game_code" "text") RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
declare
  v_game public.games%rowtype;
  v_card public.protocol_cards%rowtype;
  v_next_player integer;
begin

  select *
  into v_game
  from public.games
  where code = upper(trim(p_game_code));

  if v_game.id is null then
    raise exception 'Game not found';
  end if;

  if v_game.status <> 'playing' then
    raise exception 'Game is not playing';
  end if;

  select *
  into v_card
  from public.protocol_cards
  where active = true

    and id <> v_game.current_card_id

    and intensity <=
      (v_game.shared_profile ->> 'intensity')::integer

    and tension <=
      (v_game.shared_profile ->> 'tension')::integer

    and sensations <=
      (v_game.shared_profile ->> 'sensations')::integer

    and unexpected <=
      (v_game.shared_profile ->> 'unexpected')::integer

  order by random()
  limit 1;

  if v_card.id is null then
    raise exception 'No compatible card';
  end if;

  v_next_player :=
    case
      when v_game.active_player = 1 then 2
      else 1
    end;

  update public.games
  set
    current_card_id = v_card.id,
    turn_no = turn_no + 1,
    active_player = v_next_player
  where id = v_game.id;

  return jsonb_build_object(
    'card_id', v_card.id,
    'turn_no', v_game.turn_no + 1,
    'active_player', v_next_player
  );

end;
$$;


ALTER FUNCTION "public"."next_protocol_card"("p_game_code" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."protocol_last_scene_turn"("p_game_id" "uuid") RETURNS integer
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$

  select max(h.turn_no)::integer

  from public.game_card_history h

  join public.protocol_cards c
    on c.id = h.card_id

  where h.game_id = p_game_id
    and c.type = 'scene';

$$;


ALTER FUNCTION "public"."protocol_last_scene_turn"("p_game_id" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."protocol_last_type_turn"("p_game_id" "uuid", "p_type" "text") RETURNS integer
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$

  select max(h.turn_no)::integer

  from public.game_card_history h

  join public.protocol_cards c
    on c.id = h.card_id

  where h.game_id = p_game_id
    and c.type = p_type

    and coalesce(h.outcome, 'pending')
        <> 'alternative';

$$;


ALTER FUNCTION "public"."protocol_last_type_turn"("p_game_id" "uuid", "p_type" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."protocol_max_intensity"("p_profile_intensity" integer, "p_turn_no" integer) RETURNS integer
    LANGUAGE "plpgsql" IMMUTABLE
    AS $$
begin

  case p_profile_intensity

    when 1 then
      return 1;


    when 2 then

      if p_turn_no <= 5 then
        return 1;
      else
        return 2;
      end if;


    when 3 then

      if p_turn_no <= 3 then
        return 2;
      else
        return 3;
      end if;


    when 4 then

      if p_turn_no <= 3 then
        return 2;

      elsif p_turn_no <= 8 then
        return 3;

      else
        return 4;
      end if;


    else

      if p_turn_no <= 3 then
        return 3;

      elsif p_turn_no <= 8 then
        return 4;

      else
        return 5;
      end if;

  end case;

end;
$$;


ALTER FUNCTION "public"."protocol_max_intensity"("p_profile_intensity" integer, "p_turn_no" integer) OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."protocol_normalize_text"("p_text" "text") RETURNS "text"
    LANGUAGE "sql" IMMUTABLE
    AS $$
  select trim(
    regexp_replace(
      lower(
        coalesce(
          p_text,
          ''
        )
      ),
      '[^a-zà-ÿ0-9]+',
      ' ',
      'g'
    )
  );
$$;


ALTER FUNCTION "public"."protocol_normalize_text"("p_text" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."protocol_persistent_count"("p_game_id" "uuid") RETURNS integer
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$

  select count(*)::integer

  from public.game_card_history h

  join public.protocol_card_rules r
    on r.card_id = h.card_id
   and r.active = true

  where h.game_id = p_game_id

    and coalesce(h.outcome, 'pending')
        <> 'alternative';

$$;


ALTER FUNCTION "public"."protocol_persistent_count"("p_game_id" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."protocol_phase"("p_turn_no" integer, "p_target_turns" integer) RETURNS "text"
    LANGUAGE "plpgsql" IMMUTABLE
    AS $$
begin

  if p_turn_no <= 4 then
    return 'warmup';

  elsif p_turn_no <= 9 then
    return 'rise';

  elsif p_turn_no <= 15 then
    return 'intense';

  elsif p_turn_no <= p_target_turns then
    return 'finale';

  else
    return 'finished';

  end if;

end;
$$;


ALTER FUNCTION "public"."protocol_phase"("p_turn_no" integer, "p_target_turns" integer) OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."protocol_player_has_active_rule"("p_game_id" "uuid", "p_player_no" integer) RETURNS boolean
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$

  select exists (

    select 1

    from public.game_active_rules r

    where r.game_id = p_game_id

      and r.active = true

      and r.remaining_turns > 0

      and (
        r.target_player = p_player_no
        or
        r.target_player is null
      )

  );

$$;


ALTER FUNCTION "public"."protocol_player_has_active_rule"("p_game_id" "uuid", "p_player_no" integer) OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."protocol_player_rule_count"("p_game_id" "uuid", "p_player_no" integer) RETURNS integer
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$

  select count(*)::integer

  from public.game_active_rules r

  where r.game_id = p_game_id

    and (
      r.target_player = p_player_no
      or
      r.target_player is null
    );

$$;


ALTER FUNCTION "public"."protocol_player_rule_count"("p_game_id" "uuid", "p_player_no" integer) OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."protocol_rule_card_allowed"("p_game_id" "uuid", "p_card_id" bigint, "p_next_player" integer, "p_next_turn" integer) RETURNS boolean
    LANGUAGE "plpgsql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
declare

  v_rule
    public.protocol_card_rules%rowtype;

  v_partner integer;

  v_target_turns integer;

begin


  /* =======================================================
     REGLE ASSOCIEE A LA CARTE
     ======================================================= */

  select *
  into v_rule

  from public.protocol_card_rules

  where card_id = p_card_id

    and active = true

  limit 1;


  /* Carte ordinaire */

  if v_rule.id is null then
    return true;
  end if;


  /* =======================================================
     LONGUEUR DE PARTIE
     ======================================================= */

  select target_turns
  into v_target_turns

  from public.games

  where id = p_game_id;


  if v_target_turns is null then
    return false;
  end if;


  /* =======================================================
     CUTOFF FIN DE PARTIE

     Partie 20 tours :
       16 = autorise
       17 = refuse
       18 = refuse
       19 = refuse
       20 = refuse
     ======================================================= */

  if
    p_next_turn >
    v_target_turns - 4
  then

    return false;

  end if;


  /* =======================================================
     PARTENAIRE DU PROCHAIN JOUEUR
     ======================================================= */

  v_partner :=
    case

      when p_next_player = 1
        then 2

      else 1

    end;


  /* =======================================================
     TARGET = ACTIVE
     ======================================================= */

  if v_rule.target_mode = 'active' then


    /* Maximum 2 regles recues */

    if
      public.protocol_player_rule_count(
        p_game_id,
        p_next_player
      ) >= 2
    then

      return false;

    end if;


    /* Pas de chevauchement */

    if
      public.protocol_player_has_active_rule(
        p_game_id,
        p_next_player
      )
    then

      return false;

    end if;


    return true;

  end if;


  /* =======================================================
     TARGET = PARTNER
     ======================================================= */

  if v_rule.target_mode = 'partner' then


    if
      public.protocol_player_rule_count(
        p_game_id,
        v_partner
      ) >= 2
    then

      return false;

    end if;


    if
      public.protocol_player_has_active_rule(
        p_game_id,
        v_partner
      )
    then

      return false;

    end if;


    return true;

  end if;


  /* =======================================================
     TARGET = BOTH
     ======================================================= */

  if v_rule.target_mode = 'both' then


    /* La regle compte pour les deux joueurs */

    if
      public.protocol_player_rule_count(
        p_game_id,
        1
      ) >= 2

      or

      public.protocol_player_rule_count(
        p_game_id,
        2
      ) >= 2
    then

      return false;

    end if;


    /* Aucun des deux ne peut deja avoir une regle */

    if
      public.protocol_player_has_active_rule(
        p_game_id,
        1
      )

      or

      public.protocol_player_has_active_rule(
        p_game_id,
        2
      )
    then

      return false;

    end if;


    return true;

  end if;


  return false;

end;
$$;


ALTER FUNCTION "public"."protocol_rule_card_allowed"("p_game_id" "uuid", "p_card_id" bigint, "p_next_player" integer, "p_next_turn" integer) OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."protocol_scene_allowed"("p_game_id" "uuid", "p_card_id" bigint, "p_next_turn" integer) RETURNS boolean
    LANGUAGE "plpgsql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
declare

  v_type text;

  v_scene_count integer;

  v_last_scene_turn integer;

  v_step_count integer;

begin

  select type
  into v_type

  from public.protocol_cards

  where id = p_card_id;


  /* Carte normale */

  if v_type is distinct from 'scene' then
    return true;
  end if;


  /* =======================================================
     UNE VRAIE SCENE DOIT AVOIR DES ETAPES
     ======================================================= */

  select count(*)::integer
  into v_step_count

  from public.protocol_scene_steps

  where card_id = p_card_id;


  if v_step_count < 1 then
    return false;
  end if;


  /* =======================================================
     MAXIMUM 2 SCENES
     ======================================================= */

  v_scene_count :=
    public.protocol_scene_count(
      p_game_id
    );


  if v_scene_count >= 2 then
    return false;
  end if;


  /* =======================================================
     PAS AVANT TOUR 5
     ======================================================= */

  if p_next_turn < 5 then
    return false;
  end if;


  /* =======================================================
     ESPACEMENT
     ======================================================= */

  v_last_scene_turn :=
    public.protocol_last_scene_turn(
      p_game_id
    );


  if
    v_last_scene_turn is not null
    and
    p_next_turn - v_last_scene_turn < 5
  then

    return false;

  end if;


  return true;

end;
$$;


ALTER FUNCTION "public"."protocol_scene_allowed"("p_game_id" "uuid", "p_card_id" bigint, "p_next_turn" integer) OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."protocol_scene_count"("p_game_id" "uuid") RETURNS integer
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$

  select count(*)::integer

  from public.game_card_history h

  join public.protocol_cards c
    on c.id = h.card_id

  where h.game_id = p_game_id
    and c.type = 'scene';

$$;


ALTER FUNCTION "public"."protocol_scene_count"("p_game_id" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."protocol_truth_priority"("p_game_id" "uuid", "p_next_turn" integer, "p_target_turns" integer, "p_card_type" "text") RETURNS integer
    LANGUAGE "plpgsql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
declare

  v_truth_count integer;

  v_truth_target integer := 5;

  v_remaining_turns integer;

  v_truth_needed integer;

  v_expected_truths numeric;

begin

  v_truth_count :=
    public.protocol_type_count(
      p_game_id,
      'truth'
    );


  /* =======================================================
     PLUS AUCUNE VERITE APRES 6
     Cette fonction renvoie seulement un score.
     Le blocage réel est dans advance_protocol.
     ======================================================= */

  if v_truth_count >= 6 then

    if p_card_type = 'truth' then
      return 10000;
    end if;

    return 0;

  end if;


  v_remaining_turns :=
    p_target_turns
    - p_next_turn
    + 1;


  v_truth_needed :=
    greatest(
      v_truth_target - v_truth_count,
      0
    );


  /* =======================================================
     SITUATION CRITIQUE

     Il reste exactement assez de tours pour atteindre 5.
     Une vérité doit donc sortir.
     ======================================================= */

  if
    v_truth_needed > 0
    and
    v_remaining_turns <= v_truth_needed
  then

    if p_card_type = 'truth' then
      return -5000;
    else
      return 5000;
    end if;

  end if;


  /* =======================================================
     TRAJECTOIRE NORMALE

     5 vérités / target_turns.
     Pour 20 tours :
       ~1 à T4
       ~2 à T8
       ~3 à T12
       ~4 à T16
       5 à T20
     ======================================================= */

  v_expected_truths :=
    (
      p_next_turn::numeric
      * v_truth_target::numeric
      / p_target_turns::numeric
    );


  if
    v_truth_count <
    floor(v_expected_truths)
  then

    if p_card_type = 'truth' then
      return -220;
    else
      return 0;
    end if;

  end if;


  /*
   * Petite préférence générale.
   * Suffisante pour compenser une bibliothèque
   * où les vérités sont minoritaires.
   */

  if p_card_type = 'truth' then
    return -35;
  end if;


  return 0;

end;
$$;


ALTER FUNCTION "public"."protocol_truth_priority"("p_game_id" "uuid", "p_next_turn" integer, "p_target_turns" integer, "p_card_type" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."protocol_type_count"("p_game_id" "uuid", "p_type" "text") RETURNS integer
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$

  select count(*)::integer

  from public.game_card_history h

  join public.protocol_cards c
    on c.id = h.card_id

  where h.game_id = p_game_id

    and c.type = p_type

    /*
     * Une alternative n'est pas une carte réellement jouée.
     */

    and coalesce(h.outcome, 'pending')
        <> 'alternative';

$$;


ALTER FUNCTION "public"."protocol_type_count"("p_game_id" "uuid", "p_type" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."protocol_type_count_window"("p_game_id" "uuid", "p_type" "text", "p_from_turn" integer, "p_to_turn" integer) RETURNS integer
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$

  select count(*)::integer

  from public.game_card_history h

  join public.protocol_cards c
    on c.id = h.card_id

  where h.game_id = p_game_id

    and c.type = p_type

    and h.turn_no >= p_from_turn

    and h.turn_no <= p_to_turn

    and coalesce(
      h.outcome,
      'pending'
    ) <> 'alternative';

$$;


ALTER FUNCTION "public"."protocol_type_count_window"("p_game_id" "uuid", "p_type" "text", "p_from_turn" integer, "p_to_turn" integer) OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."protocol_type_penalty"("p_game_id" "uuid", "p_candidate_type" "text", "p_current_type" "text") RETURNS integer
    LANGUAGE "sql" STABLE
    SET "search_path" TO 'public'
    AS $$
  select

    case
      when p_candidate_type = p_current_type
        then 100
      else 0
    end

    +

    coalesce(
      (
        select
          count(*)::integer * 15

        from (
          select
            c.type

          from public.game_card_history h

          join public.protocol_cards c
            on c.id = h.card_id

          where h.game_id =
            p_game_id

          order by
            h.shown_at desc,
            h.id desc

          limit 4
        ) recent

        where recent.type =
          p_candidate_type
      ),
      0
    );
$$;


ALTER FUNCTION "public"."protocol_type_penalty"("p_game_id" "uuid", "p_candidate_type" "text", "p_current_type" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."start_protocol"("p_game_code" "text") RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
declare

  v_game
    public.games%rowtype;

  v_card
    public.protocol_cards%rowtype;

  v_first_player integer;

  v_player_sex text;

  v_profile_intensity integer;

  v_max_intensity integer;

  v_phase text;

begin


  /* =======================================================
     CHARGEMENT / LOCK PARTIE
     ======================================================= */

  select *
  into v_game

  from public.games

  where code =
    upper(trim(p_game_code))

  for update;


  if v_game.id is null then

    raise exception
      'Game not found';

  end if;


  if v_game.status <> 'calibration_ready' then

    raise exception
      'Game is not ready to start';

  end if;


  if v_game.shared_profile is null then

    raise exception
      'Shared profile not found';

  end if;


  /* =======================================================
     PREMIER JOUEUR

     p2_leads => joueur 2
     sinon => joueur 1

     Les tours suivants seront gérés par advance_protocol.
     ======================================================= */

  v_first_player :=
    case

      when
        v_game.shared_profile
        ->> 'control_mode'
        = 'p2_leads'
      then 2

      else 1

    end;


  /* =======================================================
     SEXE DU PREMIER JOUEUR
     ======================================================= */

  v_player_sex :=
    case

      when v_first_player = 1
        then v_game.player_1_sex

      else v_game.player_2_sex

    end;


  /* =======================================================
     PROFIL / INTENSITE
     ======================================================= */

  v_profile_intensity :=
    coalesce(
      (
        v_game.shared_profile
        ->> 'intensity'
      )::integer,
      1
    );


  v_max_intensity :=
    public.protocol_max_intensity(
      v_profile_intensity,
      1
    );


  v_phase :=
    public.protocol_phase(
      1,
      v_game.target_turns
    );


  /* =======================================================
     SELECTION PREMIERE CARTE
     ======================================================= */

  select *
  into v_card

  from public.protocol_cards c

  where c.active = true

    and c.library_version = 'v2'

    and (
      c.target_sex is null
      or
      c.target_sex =
        v_player_sex
    )

    and c.intensity <=
      v_max_intensity

    and c.tension <=
      coalesce(
        (
          v_game.shared_profile
          ->> 'tension'
        )::integer,
        1
      )

    and c.sensations <=
      coalesce(
        (
          v_game.shared_profile
          ->> 'sensations'
        )::integer,
        1
      )

    and c.unexpected <=
      coalesce(
        (
          v_game.shared_profile
          ->> 'unexpected'
        )::integer,
        1
      )

  order by
    random()

  limit 1;


  /* =======================================================
     FALLBACK

     Si aucune carte dans la courbe actuelle,
     on autorise jusqu'au niveau global calibré.
     ======================================================= */

  if v_card.id is null then

    select *
    into v_card

    from public.protocol_cards c

    where c.active = true

      and c.library_version = 'v2'

      and (
        c.target_sex is null
        or
        c.target_sex =
          v_player_sex
      )

      and c.intensity <=
        v_profile_intensity

      and c.tension <=
        coalesce(
          (
            v_game.shared_profile
            ->> 'tension'
          )::integer,
          1
        )

      and c.sensations <=
        coalesce(
          (
            v_game.shared_profile
            ->> 'sensations'
          )::integer,
          1
        )

      and c.unexpected <=
        coalesce(
          (
            v_game.shared_profile
            ->> 'unexpected'
          )::integer,
          1
        )

    order by
      random()

    limit 1;

  end if;


  /* =======================================================
     AUCUNE CARTE COMPATIBLE
     ======================================================= */

  if v_card.id is null then

    raise exception
      'No compatible card found';

  end if;


  /* =======================================================
     NETTOYAGE HISTORIQUE EVENTUEL

     Normalement une partie neuve n'en contient pas,
     mais ça rend start_protocol plus robuste.
     ======================================================= */

  delete from public.game_card_history
  where game_id =
    v_game.id;


  /* =======================================================
     INITIALISATION PARTIE
     ======================================================= */

  update public.games

  set

    status =
      'playing',

    turn_no =
      1,

    active_player =
      v_first_player,

    current_card_id =
      v_card.id,

    phase =
      v_phase,

    finished_at =
      null,

    score_player_1 =
      0,

    score_player_2 =
      0,

    bonus_player_1 =
      '{}'::jsonb,

    bonus_player_2 =
      '{}'::jsonb,

    scene_step_no =
      case

        when v_card.type = 'scene'
          then 1

        else null

      end,

    scene_step_read_player_1 =
      false,

    scene_step_read_player_2 =
      false

  where id =
    v_game.id;


  /* =======================================================
     PREMIERE CARTE DANS L'HISTORIQUE
     ======================================================= */

  insert into public.game_card_history (
    game_id,
    card_id,
    turn_no,
    player_no
  )

  values (
    v_game.id,
    v_card.id,
    1,
    v_first_player
  );


  /* =======================================================
     RESULTAT
     ======================================================= */

  return jsonb_build_object(

    'started',
    true,

    'card_id',
    v_card.id,

    'card_type',
    v_card.type,

    'turn_no',
    1,

    'active_player',
    v_first_player,

    'phase',
    v_phase,

    'target_turns',
    v_game.target_turns,

    'max_intensity',
    v_max_intensity,

    'scene_step_no',
    case

      when v_card.type = 'scene'
        then 1

      else null

    end

  );

end;
$$;


ALTER FUNCTION "public"."start_protocol"("p_game_code" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."submit_calibration"("p_game_code" "text", "p_player_no" integer, "p_intensity" integer, "p_answers" "jsonb") RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
declare
  v_game_id uuid;
  v_count integer;

  v_p1 record;
  v_p2 record;

  v_control_1 text;
  v_control_2 text;
  v_control_mode text;

  v_shared jsonb;
begin

  if p_player_no not in (1, 2) then
    raise exception 'Invalid player';
  end if;

  if p_intensity < 1 or p_intensity > 5 then
    raise exception 'Invalid intensity';
  end if;

  select id
  into v_game_id
  from public.games
  where code = upper(trim(p_game_code));

  if v_game_id is null then
    raise exception 'Game not found';
  end if;

  insert into public.calibration_responses (
    game_id,
    player_no,
    intensity,
    answers
  )
  values (
    v_game_id,
    p_player_no,
    p_intensity,
    p_answers
  )
  on conflict (game_id, player_no)
  do update set
    intensity = excluded.intensity,
    answers = excluded.answers,
    submitted_at = now();

  select count(*)
  into v_count
  from public.calibration_responses
  where game_id = v_game_id;

  if v_count < 2 then
    return jsonb_build_object(
      'ready', false
    );
  end if;

  select *
  into v_p1
  from public.calibration_responses
  where game_id = v_game_id
    and player_no = 1;

  select *
  into v_p2
  from public.calibration_responses
  where game_id = v_game_id
    and player_no = 2;

  v_control_1 :=
    v_p1.answers ->> 'control';

  v_control_2 :=
    v_p2.answers ->> 'control';

  /*
    On ne stocke pas les réponses individuelles
    dans le profil commun.

    On transforme simplement les deux préférences
    en mode exploitable par le moteur.
  */

  if
    v_control_1 = 'guide'
    and
    v_control_2 = 'follow'
  then
    v_control_mode := 'p1_leads';

  elsif
    v_control_1 = 'follow'
    and
    v_control_2 = 'guide'
  then
    v_control_mode := 'p2_leads';

  elsif
    v_control_1 = 'both'
    or
    v_control_2 = 'both'
  then
    v_control_mode := 'flexible';

  else
    v_control_mode := 'alternate';
  end if;

  v_shared :=
    jsonb_build_object(

      'intensity',
      least(
        v_p1.intensity,
        v_p2.intensity
      ),

      'control_mode',
      v_control_mode,

      'tension',
      least(
        (v_p1.answers ->> 'tension')::int,
        (v_p2.answers ->> 'tension')::int
      ),

      'sensations',
      least(
        (v_p1.answers ->> 'sensations')::int,
        (v_p2.answers ->> 'sensations')::int
      ),

      'unexpected',
      least(
        (v_p1.answers ->> 'unexpected')::int,
        (v_p2.answers ->> 'unexpected')::int
      )
    );

  update public.games
  set
    shared_profile = v_shared,
    status = 'calibration_ready'
  where id = v_game_id;

  return jsonb_build_object(
    'ready', true,
    'shared_profile', v_shared
  );

end;
$$;


ALTER FUNCTION "public"."submit_calibration"("p_game_code" "text", "p_player_no" integer, "p_intensity" integer, "p_answers" "jsonb") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."tick_game_rules"("p_game_id" "uuid") RETURNS "void"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
begin

  update public.game_active_rules

  set
    remaining_turns =
      greatest(
        remaining_turns - 1,
        0
      ),

    active =
      case

        when remaining_turns - 1 <= 0
          then false

        else true

      end

  where game_id =
    p_game_id

    and active = true

    and remaining_turns > 0;

end;
$$;


ALTER FUNCTION "public"."tick_game_rules"("p_game_id" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."use_choose_type"("p_game_code" "text", "p_player_no" integer, "p_card_type" "text") RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
declare

  v_game public.games%rowtype;

  v_bonus jsonb;

begin


  if p_player_no not in (1,2) then
    raise exception 'Invalid player';
  end if;


  if p_card_type not in (
    'truth',
    'action',
    'duel',
    'scene'
  ) then
    raise exception 'Invalid card type';
  end if;


  select *
  into v_game

  from public.games

  where code =
    upper(trim(p_game_code))

  for update;


  if v_game.id is null then
    raise exception 'Game not found';
  end if;


  if v_game.status <> 'playing' then
    raise exception 'Game is not playing';
  end if;


  if v_game.active_player <> p_player_no then
    raise exception
      'Only active player can choose next type';
  end if;


  v_bonus :=
    case

      when p_player_no = 1
        then
          coalesce(
            v_game.bonus_player_1,
            '{}'::jsonb
          )

      else
        coalesce(
          v_game.bonus_player_2,
          '{}'::jsonb
        )

    end;


  if not coalesce(
    (
      v_bonus
      ->> 'choose_type'
    )::boolean,
    false
  )
  then

    raise exception
      'Bonus not owned';

  end if;


  /*
   * On arme simplement le choix.
   *
   * advance_protocol vérifiera
   * ensuite sexe, profil, historique,
   * niveau et disponibilité réelle.
   */


  if p_player_no = 1 then

    update public.games
    set
      bonus_player_1 =
        (
          coalesce(
            bonus_player_1,
            '{}'::jsonb
          )
          - 'choose_type'
        )
        ||
        jsonb_build_object(
          'choose_type_armed',
          p_card_type
        )

    where id =
      v_game.id;


  else

    update public.games
    set
      bonus_player_2 =
        (
          coalesce(
            bonus_player_2,
            '{}'::jsonb
          )
          - 'choose_type'
        )
        ||
        jsonb_build_object(
          'choose_type_armed',
          p_card_type
        )

    where id =
      v_game.id;

  end if;


  return jsonb_build_object(
    'ok',
    true,

    'type',
    p_card_type
  );

end;
$$;


ALTER FUNCTION "public"."use_choose_type"("p_game_code" "text", "p_player_no" integer, "p_card_type" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."use_take_control"("p_game_code" "text", "p_player_no" integer) RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
declare
  v_game public.games%rowtype;
  v_bonus jsonb;
begin

  if p_player_no not in (1, 2) then
    raise exception 'Invalid player';
  end if;

  select *
  into v_game
  from public.games
  where code = upper(trim(p_game_code))
  for update;

  if v_game.id is null then
    raise exception 'Game not found';
  end if;

  if v_game.status <> 'playing' then
    raise exception 'Game is not playing';
  end if;

  v_bonus :=
    case
      when p_player_no = 1
        then v_game.bonus_player_1
      else v_game.bonus_player_2
    end;

  if not coalesce(
    (v_bonus ->> 'take_control')::boolean,
    false
  ) then
    raise exception 'Bonus not owned';
  end if;

  /*
   * Le pouvoir détermine QUI jouera
   * la prochaine carte.
   *
   * On ne vole pas la carte déjà en cours.
   */
if p_player_no = 1 then

  update public.games
  set
    bonus_player_1 =
      (
        bonus_player_1
        - 'take_control'
      ) ||
      jsonb_build_object(
        'take_control_armed',
        true
      )

  where id = v_game.id;

else

  update public.games
  set
    bonus_player_2 =
      (
        bonus_player_2
        - 'take_control'
      ) ||
      jsonb_build_object(
        'take_control_armed',
        true
      )

  where id = v_game.id;

end if;

  return jsonb_build_object(
    'ok', true
  );

end;
$$;


ALTER FUNCTION "public"."use_take_control"("p_game_code" "text", "p_player_no" integer) OWNER TO "postgres";

SET default_tablespace = '';

SET default_table_access_method = "heap";


CREATE TABLE IF NOT EXISTS "public"."calibration_responses" (
    "game_id" "uuid" NOT NULL,
    "player_no" smallint NOT NULL,
    "intensity" smallint NOT NULL,
    "answers" "jsonb" NOT NULL,
    "submitted_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "calibration_responses_intensity_check" CHECK ((("intensity" >= 1) AND ("intensity" <= 5))),
    CONSTRAINT "calibration_responses_player_no_check" CHECK (("player_no" = ANY (ARRAY[1, 2])))
);


ALTER TABLE "public"."calibration_responses" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."game_active_rules" (
    "id" bigint NOT NULL,
    "game_id" "uuid" NOT NULL,
    "source_card_id" bigint,
    "rule_key" "text",
    "title" "text" NOT NULL,
    "rule_text" "text" NOT NULL,
    "target_player" integer,
    "remaining_turns" integer NOT NULL,
    "active" boolean DEFAULT true NOT NULL,
    "created_turn" integer,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "expires_at_turn" integer,
    CONSTRAINT "game_active_rules_remaining_turns_check" CHECK (("remaining_turns" >= 0)),
    CONSTRAINT "game_active_rules_target_player_check" CHECK ((("target_player" IS NULL) OR ("target_player" = ANY (ARRAY[1, 2]))))
);


ALTER TABLE "public"."game_active_rules" OWNER TO "postgres";


ALTER TABLE "public"."game_active_rules" ALTER COLUMN "id" ADD GENERATED BY DEFAULT AS IDENTITY (
    SEQUENCE NAME "public"."game_active_rules_id_seq"
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);



CREATE TABLE IF NOT EXISTS "public"."game_card_history" (
    "id" bigint NOT NULL,
    "game_id" "uuid" NOT NULL,
    "card_id" bigint NOT NULL,
    "turn_no" integer NOT NULL,
    "player_no" smallint NOT NULL,
    "outcome" "text",
    "shown_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "resolved_at" timestamp with time zone,
    CONSTRAINT "game_card_history_outcome_check" CHECK ((("outcome" IS NULL) OR ("outcome" = ANY (ARRAY['done'::"text", 'pass'::"text", 'alternative'::"text"])))),
    CONSTRAINT "game_card_history_player_no_check" CHECK (("player_no" = ANY (ARRAY[1, 2])))
);


ALTER TABLE "public"."game_card_history" OWNER TO "postgres";


ALTER TABLE "public"."game_card_history" ALTER COLUMN "id" ADD GENERATED ALWAYS AS IDENTITY (
    SEQUENCE NAME "public"."game_card_history_id_seq"
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);



CREATE TABLE IF NOT EXISTS "public"."games" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "code" "text" NOT NULL,
    "player_count" integer DEFAULT 1 NOT NULL,
    "status" "text" DEFAULT 'waiting'::"text" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "player_1_ready" boolean DEFAULT false NOT NULL,
    "player_2_ready" boolean DEFAULT false NOT NULL,
    "shared_profile" "jsonb",
    "current_card_id" bigint,
    "turn_no" integer DEFAULT 0 NOT NULL,
    "active_player" smallint,
    "score_player_1" integer DEFAULT 0 NOT NULL,
    "score_player_2" integer DEFAULT 0 NOT NULL,
    "bonus_player_1" "jsonb" DEFAULT '{}'::"jsonb" NOT NULL,
    "bonus_player_2" "jsonb" DEFAULT '{}'::"jsonb" NOT NULL,
    "target_turns" integer DEFAULT 20 NOT NULL,
    "phase" "text" DEFAULT 'warmup'::"text" NOT NULL,
    "finished_at" timestamp with time zone,
    "player_1_name" "text",
    "player_1_sex" "text",
    "player_2_name" "text",
    "player_2_sex" "text",
    "scene_step_no" integer,
    "scene_step_read_player_1" boolean DEFAULT false NOT NULL,
    "scene_step_read_player_2" boolean DEFAULT false NOT NULL,
    CONSTRAINT "games_active_player_check" CHECK (("active_player" = ANY (ARRAY[1, 2]))),
    CONSTRAINT "games_player_1_sex_check" CHECK ((("player_1_sex" IS NULL) OR ("player_1_sex" = ANY (ARRAY['female'::"text", 'male'::"text"])))),
    CONSTRAINT "games_player_2_sex_check" CHECK ((("player_2_sex" IS NULL) OR ("player_2_sex" = ANY (ARRAY['female'::"text", 'male'::"text"]))))
);


ALTER TABLE "public"."games" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."protocol_cards" (
    "id" bigint NOT NULL,
    "type" "text" NOT NULL,
    "title" "text",
    "prompt" "text" NOT NULL,
    "intensity" smallint NOT NULL,
    "tension" smallint DEFAULT 1 NOT NULL,
    "sensations" smallint DEFAULT 1 NOT NULL,
    "unexpected" smallint DEFAULT 1 NOT NULL,
    "active" boolean DEFAULT true NOT NULL,
    "target_sex" "text",
    "library_version" "text",
    "library_key" "text",
    CONSTRAINT "protocol_cards_intensity_check" CHECK ((("intensity" >= 1) AND ("intensity" <= 5))),
    CONSTRAINT "protocol_cards_sensations_check" CHECK ((("sensations" >= 1) AND ("sensations" <= 3))),
    CONSTRAINT "protocol_cards_target_sex_check" CHECK ((("target_sex" IS NULL) OR ("target_sex" = ANY (ARRAY['female'::"text", 'male'::"text"])))),
    CONSTRAINT "protocol_cards_tension_check" CHECK ((("tension" >= 1) AND ("tension" <= 3))),
    CONSTRAINT "protocol_cards_type_check" CHECK (("type" = ANY (ARRAY['truth'::"text", 'action'::"text", 'duel'::"text", 'scene'::"text"]))),
    CONSTRAINT "protocol_cards_unexpected_check" CHECK ((("unexpected" >= 1) AND ("unexpected" <= 3)))
);


ALTER TABLE "public"."protocol_cards" OWNER TO "postgres";


CREATE OR REPLACE VIEW "public"."protocol_card_duplicate_audit" AS
 WITH "cards" AS (
         SELECT "protocol_cards"."id",
            "protocol_cards"."library_key",
            "protocol_cards"."library_version",
            "protocol_cards"."type",
            "protocol_cards"."title",
            "protocol_cards"."prompt",
            "protocol_cards"."intensity",
            "protocol_cards"."target_sex",
            "protocol_cards"."tension",
            "protocol_cards"."sensations",
            "protocol_cards"."unexpected",
            "public"."protocol_normalize_text"("protocol_cards"."title") AS "normalized_title",
            "public"."protocol_normalize_text"("protocol_cards"."prompt") AS "normalized_prompt"
           FROM "public"."protocol_cards"
          WHERE ("protocol_cards"."active" = true)
        ), "pairs" AS (
         SELECT "a"."id" AS "card_1_id",
            "a"."library_key" AS "card_1_key",
            "a"."type" AS "card_1_type",
            "a"."title" AS "card_1_title",
            "a"."prompt" AS "card_1_prompt",
            "a"."intensity" AS "card_1_intensity",
            "a"."target_sex" AS "card_1_target_sex",
            "b"."id" AS "card_2_id",
            "b"."library_key" AS "card_2_key",
            "b"."type" AS "card_2_type",
            "b"."title" AS "card_2_title",
            "b"."prompt" AS "card_2_prompt",
            "b"."intensity" AS "card_2_intensity",
            "b"."target_sex" AS "card_2_target_sex",
            "public"."similarity"("a"."normalized_title", "b"."normalized_title") AS "title_similarity",
            "public"."similarity"("a"."normalized_prompt", "b"."normalized_prompt") AS "prompt_similarity",
                CASE
                    WHEN ("a"."normalized_prompt" = "b"."normalized_prompt") THEN true
                    ELSE false
                END AS "exact_prompt_duplicate",
                CASE
                    WHEN (("a"."normalized_title" = "b"."normalized_title") AND ("a"."normalized_title" <> ''::"text")) THEN true
                    ELSE false
                END AS "exact_title_duplicate"
           FROM ("cards" "a"
             JOIN "cards" "b" ON (("b"."id" > "a"."id")))
        )
 SELECT "card_1_id",
    "card_1_key",
    "card_1_type",
    "card_1_title",
    "card_1_prompt",
    "card_1_intensity",
    "card_1_target_sex",
    "card_2_id",
    "card_2_key",
    "card_2_type",
    "card_2_title",
    "card_2_prompt",
    "card_2_intensity",
    "card_2_target_sex",
    "title_similarity",
    "prompt_similarity",
    "exact_prompt_duplicate",
    "exact_title_duplicate",
        CASE
            WHEN "exact_prompt_duplicate" THEN 'EXACT'::"text"
            WHEN ("prompt_similarity" >= (0.90)::double precision) THEN 'VERY_HIGH'::"text"
            WHEN ("prompt_similarity" >= (0.78)::double precision) THEN 'HIGH'::"text"
            WHEN (("prompt_similarity" >= (0.65)::double precision) AND ("title_similarity" >= (0.50)::double precision)) THEN 'MEDIUM'::"text"
            ELSE 'LOW'::"text"
        END AS "suspicion_level"
   FROM "pairs"
  WHERE ("exact_prompt_duplicate" OR ("prompt_similarity" >= (0.65)::double precision) OR ("exact_title_duplicate" AND ("prompt_similarity" >= (0.45)::double precision)));


ALTER VIEW "public"."protocol_card_duplicate_audit" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."protocol_card_rules" (
    "id" bigint NOT NULL,
    "card_id" bigint NOT NULL,
    "rule_key" "text" NOT NULL,
    "title" "text" NOT NULL,
    "rule_text" "text" NOT NULL,
    "target_mode" "text" DEFAULT 'active'::"text" NOT NULL,
    "duration_turns" integer DEFAULT 3 NOT NULL,
    "active" boolean DEFAULT true NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "protocol_card_rules_duration_check" CHECK (("duration_turns" >= 1)),
    CONSTRAINT "protocol_card_rules_target_mode_check" CHECK (("target_mode" = ANY (ARRAY['active'::"text", 'partner'::"text", 'both'::"text"])))
);


ALTER TABLE "public"."protocol_card_rules" OWNER TO "postgres";


ALTER TABLE "public"."protocol_card_rules" ALTER COLUMN "id" ADD GENERATED BY DEFAULT AS IDENTITY (
    SEQUENCE NAME "public"."protocol_card_rules_id_seq"
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);



ALTER TABLE "public"."protocol_cards" ALTER COLUMN "id" ADD GENERATED ALWAYS AS IDENTITY (
    SEQUENCE NAME "public"."protocol_cards_id_seq"
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);



CREATE TABLE IF NOT EXISTS "public"."protocol_scene_steps" (
    "id" bigint NOT NULL,
    "card_id" bigint NOT NULL,
    "step_no" integer NOT NULL,
    "title" "text",
    "prompt" "text" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "title_player_1" "text",
    "prompt_player_1" "text",
    "title_player_2" "text",
    "prompt_player_2" "text",
    "title_active" "text",
    "prompt_active" "text",
    "title_partner" "text",
    "prompt_partner" "text",
    CONSTRAINT "protocol_scene_steps_step_positive" CHECK (("step_no" >= 1))
);


ALTER TABLE "public"."protocol_scene_steps" OWNER TO "postgres";


ALTER TABLE "public"."protocol_scene_steps" ALTER COLUMN "id" ADD GENERATED ALWAYS AS IDENTITY (
    SEQUENCE NAME "public"."protocol_scene_steps_id_seq"
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);



ALTER TABLE ONLY "public"."calibration_responses"
    ADD CONSTRAINT "calibration_responses_pkey" PRIMARY KEY ("game_id", "player_no");



ALTER TABLE ONLY "public"."game_active_rules"
    ADD CONSTRAINT "game_active_rules_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."game_card_history"
    ADD CONSTRAINT "game_card_history_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."games"
    ADD CONSTRAINT "games_code_key" UNIQUE ("code");



ALTER TABLE ONLY "public"."games"
    ADD CONSTRAINT "games_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."protocol_card_rules"
    ADD CONSTRAINT "protocol_card_rules_card_unique" UNIQUE ("card_id");



ALTER TABLE ONLY "public"."protocol_card_rules"
    ADD CONSTRAINT "protocol_card_rules_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."protocol_cards"
    ADD CONSTRAINT "protocol_cards_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."protocol_scene_steps"
    ADD CONSTRAINT "protocol_scene_steps_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."protocol_scene_steps"
    ADD CONSTRAINT "protocol_scene_steps_unique" UNIQUE ("card_id", "step_no");



CREATE UNIQUE INDEX "game_active_rules_source_unique" ON "public"."game_active_rules" USING "btree" ("game_id", "source_card_id", "rule_key") WHERE ("source_card_id" IS NOT NULL);



CREATE INDEX "game_card_history_game_idx" ON "public"."game_card_history" USING "btree" ("game_id");



CREATE INDEX "idx_game_active_rules_game_active" ON "public"."game_active_rules" USING "btree" ("game_id", "active");



CREATE UNIQUE INDEX "protocol_cards_library_key_uidx" ON "public"."protocol_cards" USING "btree" ("library_key") WHERE ("library_key" IS NOT NULL);



CREATE UNIQUE INDEX "protocol_cards_library_key_unique_idx" ON "public"."protocol_cards" USING "btree" ("library_key");



CREATE INDEX "protocol_scene_steps_card_idx" ON "public"."protocol_scene_steps" USING "btree" ("card_id");



ALTER TABLE ONLY "public"."calibration_responses"
    ADD CONSTRAINT "calibration_responses_game_id_fkey" FOREIGN KEY ("game_id") REFERENCES "public"."games"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."game_active_rules"
    ADD CONSTRAINT "game_active_rules_game_id_fkey" FOREIGN KEY ("game_id") REFERENCES "public"."games"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."game_active_rules"
    ADD CONSTRAINT "game_active_rules_source_card_id_fkey" FOREIGN KEY ("source_card_id") REFERENCES "public"."protocol_cards"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."game_card_history"
    ADD CONSTRAINT "game_card_history_card_id_fkey" FOREIGN KEY ("card_id") REFERENCES "public"."protocol_cards"("id");



ALTER TABLE ONLY "public"."game_card_history"
    ADD CONSTRAINT "game_card_history_game_id_fkey" FOREIGN KEY ("game_id") REFERENCES "public"."games"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."games"
    ADD CONSTRAINT "games_current_card_id_fkey" FOREIGN KEY ("current_card_id") REFERENCES "public"."protocol_cards"("id");



ALTER TABLE ONLY "public"."protocol_card_rules"
    ADD CONSTRAINT "protocol_card_rules_card_id_fkey" FOREIGN KEY ("card_id") REFERENCES "public"."protocol_cards"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."protocol_scene_steps"
    ADD CONSTRAINT "protocol_scene_steps_card_id_fkey" FOREIGN KEY ("card_id") REFERENCES "public"."protocol_cards"("id") ON DELETE CASCADE;



ALTER TABLE "public"."calibration_responses" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."game_active_rules" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."games" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "games_insert" ON "public"."games" FOR INSERT TO "anon" WITH CHECK (true);



CREATE POLICY "games_select" ON "public"."games" FOR SELECT TO "anon" USING (true);



CREATE POLICY "games_update" ON "public"."games" FOR UPDATE TO "anon" USING (true) WITH CHECK (true);



ALTER TABLE "public"."protocol_card_rules" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."protocol_scene_steps" ENABLE ROW LEVEL SECURITY;


GRANT USAGE ON SCHEMA "public" TO "postgres";
GRANT USAGE ON SCHEMA "public" TO "anon";
GRANT USAGE ON SCHEMA "public" TO "authenticated";
GRANT USAGE ON SCHEMA "public" TO "service_role";



GRANT ALL ON FUNCTION "public"."add_game_rule"("p_game_code" "text", "p_title" "text", "p_rule_text" "text", "p_target_player" integer, "p_duration_turns" integer, "p_rule_key" "text") TO "anon";
GRANT ALL ON FUNCTION "public"."add_game_rule"("p_game_code" "text", "p_title" "text", "p_rule_text" "text", "p_target_player" integer, "p_duration_turns" integer, "p_rule_key" "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."add_game_rule"("p_game_code" "text", "p_title" "text", "p_rule_text" "text", "p_target_player" integer, "p_duration_turns" integer, "p_rule_key" "text") TO "service_role";



GRANT ALL ON FUNCTION "public"."advance_protocol"("p_game_code" "text", "p_action" "text", "p_duel_winner" integer) TO "anon";
GRANT ALL ON FUNCTION "public"."advance_protocol"("p_game_code" "text", "p_action" "text", "p_duel_winner" integer) TO "authenticated";
GRANT ALL ON FUNCTION "public"."advance_protocol"("p_game_code" "text", "p_action" "text", "p_duel_winner" integer) TO "service_role";



GRANT ALL ON FUNCTION "public"."advance_scene_step"("p_game_code" "text", "p_player_no" integer) TO "anon";
GRANT ALL ON FUNCTION "public"."advance_scene_step"("p_game_code" "text", "p_player_no" integer) TO "authenticated";
GRANT ALL ON FUNCTION "public"."advance_scene_step"("p_game_code" "text", "p_player_no" integer) TO "service_role";



GRANT ALL ON FUNCTION "public"."buy_protocol_bonus"("p_game_code" "text", "p_player_no" integer, "p_bonus" "text") TO "anon";
GRANT ALL ON FUNCTION "public"."buy_protocol_bonus"("p_game_code" "text", "p_player_no" integer, "p_bonus" "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."buy_protocol_bonus"("p_game_code" "text", "p_player_no" integer, "p_bonus" "text") TO "service_role";



GRANT ALL ON FUNCTION "public"."get_active_rules"("p_game_code" "text", "p_player_no" integer) TO "anon";
GRANT ALL ON FUNCTION "public"."get_active_rules"("p_game_code" "text", "p_player_no" integer) TO "authenticated";
GRANT ALL ON FUNCTION "public"."get_active_rules"("p_game_code" "text", "p_player_no" integer) TO "service_role";



GRANT ALL ON FUNCTION "public"."get_scene_state"("p_game_code" "text", "p_player_no" integer) TO "anon";
GRANT ALL ON FUNCTION "public"."get_scene_state"("p_game_code" "text", "p_player_no" integer) TO "authenticated";
GRANT ALL ON FUNCTION "public"."get_scene_state"("p_game_code" "text", "p_player_no" integer) TO "service_role";



GRANT ALL ON FUNCTION "public"."mark_scene_step_read"("p_game_code" "text", "p_player_no" integer) TO "anon";
GRANT ALL ON FUNCTION "public"."mark_scene_step_read"("p_game_code" "text", "p_player_no" integer) TO "authenticated";
GRANT ALL ON FUNCTION "public"."mark_scene_step_read"("p_game_code" "text", "p_player_no" integer) TO "service_role";



GRANT ALL ON FUNCTION "public"."next_protocol_card"("p_game_code" "text") TO "anon";
GRANT ALL ON FUNCTION "public"."next_protocol_card"("p_game_code" "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."next_protocol_card"("p_game_code" "text") TO "service_role";



GRANT ALL ON FUNCTION "public"."protocol_last_scene_turn"("p_game_id" "uuid") TO "anon";
GRANT ALL ON FUNCTION "public"."protocol_last_scene_turn"("p_game_id" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."protocol_last_scene_turn"("p_game_id" "uuid") TO "service_role";



GRANT ALL ON FUNCTION "public"."protocol_last_type_turn"("p_game_id" "uuid", "p_type" "text") TO "anon";
GRANT ALL ON FUNCTION "public"."protocol_last_type_turn"("p_game_id" "uuid", "p_type" "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."protocol_last_type_turn"("p_game_id" "uuid", "p_type" "text") TO "service_role";



GRANT ALL ON FUNCTION "public"."protocol_max_intensity"("p_profile_intensity" integer, "p_turn_no" integer) TO "anon";
GRANT ALL ON FUNCTION "public"."protocol_max_intensity"("p_profile_intensity" integer, "p_turn_no" integer) TO "authenticated";
GRANT ALL ON FUNCTION "public"."protocol_max_intensity"("p_profile_intensity" integer, "p_turn_no" integer) TO "service_role";



GRANT ALL ON FUNCTION "public"."protocol_normalize_text"("p_text" "text") TO "anon";
GRANT ALL ON FUNCTION "public"."protocol_normalize_text"("p_text" "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."protocol_normalize_text"("p_text" "text") TO "service_role";



GRANT ALL ON FUNCTION "public"."protocol_persistent_count"("p_game_id" "uuid") TO "anon";
GRANT ALL ON FUNCTION "public"."protocol_persistent_count"("p_game_id" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."protocol_persistent_count"("p_game_id" "uuid") TO "service_role";



GRANT ALL ON FUNCTION "public"."protocol_phase"("p_turn_no" integer, "p_target_turns" integer) TO "anon";
GRANT ALL ON FUNCTION "public"."protocol_phase"("p_turn_no" integer, "p_target_turns" integer) TO "authenticated";
GRANT ALL ON FUNCTION "public"."protocol_phase"("p_turn_no" integer, "p_target_turns" integer) TO "service_role";



GRANT ALL ON FUNCTION "public"."protocol_player_has_active_rule"("p_game_id" "uuid", "p_player_no" integer) TO "anon";
GRANT ALL ON FUNCTION "public"."protocol_player_has_active_rule"("p_game_id" "uuid", "p_player_no" integer) TO "authenticated";
GRANT ALL ON FUNCTION "public"."protocol_player_has_active_rule"("p_game_id" "uuid", "p_player_no" integer) TO "service_role";



GRANT ALL ON FUNCTION "public"."protocol_player_rule_count"("p_game_id" "uuid", "p_player_no" integer) TO "anon";
GRANT ALL ON FUNCTION "public"."protocol_player_rule_count"("p_game_id" "uuid", "p_player_no" integer) TO "authenticated";
GRANT ALL ON FUNCTION "public"."protocol_player_rule_count"("p_game_id" "uuid", "p_player_no" integer) TO "service_role";



GRANT ALL ON FUNCTION "public"."protocol_rule_card_allowed"("p_game_id" "uuid", "p_card_id" bigint, "p_next_player" integer, "p_next_turn" integer) TO "anon";
GRANT ALL ON FUNCTION "public"."protocol_rule_card_allowed"("p_game_id" "uuid", "p_card_id" bigint, "p_next_player" integer, "p_next_turn" integer) TO "authenticated";
GRANT ALL ON FUNCTION "public"."protocol_rule_card_allowed"("p_game_id" "uuid", "p_card_id" bigint, "p_next_player" integer, "p_next_turn" integer) TO "service_role";



GRANT ALL ON FUNCTION "public"."protocol_scene_allowed"("p_game_id" "uuid", "p_card_id" bigint, "p_next_turn" integer) TO "anon";
GRANT ALL ON FUNCTION "public"."protocol_scene_allowed"("p_game_id" "uuid", "p_card_id" bigint, "p_next_turn" integer) TO "authenticated";
GRANT ALL ON FUNCTION "public"."protocol_scene_allowed"("p_game_id" "uuid", "p_card_id" bigint, "p_next_turn" integer) TO "service_role";



GRANT ALL ON FUNCTION "public"."protocol_scene_count"("p_game_id" "uuid") TO "anon";
GRANT ALL ON FUNCTION "public"."protocol_scene_count"("p_game_id" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."protocol_scene_count"("p_game_id" "uuid") TO "service_role";



GRANT ALL ON FUNCTION "public"."protocol_truth_priority"("p_game_id" "uuid", "p_next_turn" integer, "p_target_turns" integer, "p_card_type" "text") TO "anon";
GRANT ALL ON FUNCTION "public"."protocol_truth_priority"("p_game_id" "uuid", "p_next_turn" integer, "p_target_turns" integer, "p_card_type" "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."protocol_truth_priority"("p_game_id" "uuid", "p_next_turn" integer, "p_target_turns" integer, "p_card_type" "text") TO "service_role";



GRANT ALL ON FUNCTION "public"."protocol_type_count"("p_game_id" "uuid", "p_type" "text") TO "anon";
GRANT ALL ON FUNCTION "public"."protocol_type_count"("p_game_id" "uuid", "p_type" "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."protocol_type_count"("p_game_id" "uuid", "p_type" "text") TO "service_role";



GRANT ALL ON FUNCTION "public"."protocol_type_count_window"("p_game_id" "uuid", "p_type" "text", "p_from_turn" integer, "p_to_turn" integer) TO "anon";
GRANT ALL ON FUNCTION "public"."protocol_type_count_window"("p_game_id" "uuid", "p_type" "text", "p_from_turn" integer, "p_to_turn" integer) TO "authenticated";
GRANT ALL ON FUNCTION "public"."protocol_type_count_window"("p_game_id" "uuid", "p_type" "text", "p_from_turn" integer, "p_to_turn" integer) TO "service_role";



GRANT ALL ON FUNCTION "public"."protocol_type_penalty"("p_game_id" "uuid", "p_candidate_type" "text", "p_current_type" "text") TO "anon";
GRANT ALL ON FUNCTION "public"."protocol_type_penalty"("p_game_id" "uuid", "p_candidate_type" "text", "p_current_type" "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."protocol_type_penalty"("p_game_id" "uuid", "p_candidate_type" "text", "p_current_type" "text") TO "service_role";



GRANT ALL ON FUNCTION "public"."start_protocol"("p_game_code" "text") TO "anon";
GRANT ALL ON FUNCTION "public"."start_protocol"("p_game_code" "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."start_protocol"("p_game_code" "text") TO "service_role";



GRANT ALL ON FUNCTION "public"."submit_calibration"("p_game_code" "text", "p_player_no" integer, "p_intensity" integer, "p_answers" "jsonb") TO "anon";
GRANT ALL ON FUNCTION "public"."submit_calibration"("p_game_code" "text", "p_player_no" integer, "p_intensity" integer, "p_answers" "jsonb") TO "authenticated";
GRANT ALL ON FUNCTION "public"."submit_calibration"("p_game_code" "text", "p_player_no" integer, "p_intensity" integer, "p_answers" "jsonb") TO "service_role";



GRANT ALL ON FUNCTION "public"."tick_game_rules"("p_game_id" "uuid") TO "anon";
GRANT ALL ON FUNCTION "public"."tick_game_rules"("p_game_id" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."tick_game_rules"("p_game_id" "uuid") TO "service_role";



GRANT ALL ON FUNCTION "public"."use_choose_type"("p_game_code" "text", "p_player_no" integer, "p_card_type" "text") TO "anon";
GRANT ALL ON FUNCTION "public"."use_choose_type"("p_game_code" "text", "p_player_no" integer, "p_card_type" "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."use_choose_type"("p_game_code" "text", "p_player_no" integer, "p_card_type" "text") TO "service_role";



GRANT ALL ON FUNCTION "public"."use_take_control"("p_game_code" "text", "p_player_no" integer) TO "anon";
GRANT ALL ON FUNCTION "public"."use_take_control"("p_game_code" "text", "p_player_no" integer) TO "authenticated";
GRANT ALL ON FUNCTION "public"."use_take_control"("p_game_code" "text", "p_player_no" integer) TO "service_role";



GRANT ALL ON TABLE "public"."calibration_responses" TO "authenticated";
GRANT ALL ON TABLE "public"."calibration_responses" TO "service_role";



GRANT ALL ON TABLE "public"."game_active_rules" TO "service_role";



GRANT ALL ON SEQUENCE "public"."game_active_rules_id_seq" TO "anon";
GRANT ALL ON SEQUENCE "public"."game_active_rules_id_seq" TO "authenticated";
GRANT ALL ON SEQUENCE "public"."game_active_rules_id_seq" TO "service_role";



GRANT ALL ON TABLE "public"."game_card_history" TO "anon";
GRANT ALL ON TABLE "public"."game_card_history" TO "authenticated";
GRANT ALL ON TABLE "public"."game_card_history" TO "service_role";



GRANT ALL ON SEQUENCE "public"."game_card_history_id_seq" TO "anon";
GRANT ALL ON SEQUENCE "public"."game_card_history_id_seq" TO "authenticated";
GRANT ALL ON SEQUENCE "public"."game_card_history_id_seq" TO "service_role";



GRANT ALL ON TABLE "public"."games" TO "anon";
GRANT ALL ON TABLE "public"."games" TO "authenticated";
GRANT ALL ON TABLE "public"."games" TO "service_role";



GRANT ALL ON TABLE "public"."protocol_cards" TO "anon";
GRANT ALL ON TABLE "public"."protocol_cards" TO "authenticated";
GRANT ALL ON TABLE "public"."protocol_cards" TO "service_role";



GRANT ALL ON TABLE "public"."protocol_card_duplicate_audit" TO "anon";
GRANT ALL ON TABLE "public"."protocol_card_duplicate_audit" TO "authenticated";
GRANT ALL ON TABLE "public"."protocol_card_duplicate_audit" TO "service_role";



GRANT ALL ON TABLE "public"."protocol_card_rules" TO "service_role";



GRANT ALL ON SEQUENCE "public"."protocol_card_rules_id_seq" TO "anon";
GRANT ALL ON SEQUENCE "public"."protocol_card_rules_id_seq" TO "authenticated";
GRANT ALL ON SEQUENCE "public"."protocol_card_rules_id_seq" TO "service_role";



GRANT ALL ON SEQUENCE "public"."protocol_cards_id_seq" TO "anon";
GRANT ALL ON SEQUENCE "public"."protocol_cards_id_seq" TO "authenticated";
GRANT ALL ON SEQUENCE "public"."protocol_cards_id_seq" TO "service_role";



GRANT ALL ON TABLE "public"."protocol_scene_steps" TO "service_role";



GRANT ALL ON SEQUENCE "public"."protocol_scene_steps_id_seq" TO "anon";
GRANT ALL ON SEQUENCE "public"."protocol_scene_steps_id_seq" TO "authenticated";
GRANT ALL ON SEQUENCE "public"."protocol_scene_steps_id_seq" TO "service_role";



ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON SEQUENCES TO "postgres";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON SEQUENCES TO "anon";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON SEQUENCES TO "authenticated";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON SEQUENCES TO "service_role";






ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON FUNCTIONS TO "postgres";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON FUNCTIONS TO "anon";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON FUNCTIONS TO "authenticated";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON FUNCTIONS TO "service_role";






ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON TABLES TO "postgres";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON TABLES TO "anon";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON TABLES TO "authenticated";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON TABLES TO "service_role";







