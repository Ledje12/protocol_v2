


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


COMMENT ON SCHEMA "public" IS 'standard public schema';



CREATE EXTENSION IF NOT EXISTS "pg_stat_statements" WITH SCHEMA "extensions";






CREATE EXTENSION IF NOT EXISTS "pg_trgm" WITH SCHEMA "public";






CREATE EXTENSION IF NOT EXISTS "pgcrypto" WITH SCHEMA "extensions";






CREATE EXTENSION IF NOT EXISTS "supabase_vault" WITH SCHEMA "vault";






CREATE EXTENSION IF NOT EXISTS "uuid-ossp" WITH SCHEMA "extensions";






CREATE OR REPLACE FUNCTION "public"."add_game_rule"("p_game_code" "text", "p_title" "text", "p_rule_text" "text", "p_target_player" integer, "p_duration_turns" integer, "p_rule_key" "text" DEFAULT NULL::"text") RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
declare
  v_game public.games%rowtype;
  v_rule_id bigint;
begin
  /*
   * Authentification + appartenance à la partie.
   * Le numéro de joueur est volontairement ignoré ici :
   * il ne sert pas à la logique métier de cette fonction.
   */
  perform public.protocol_current_player_no(
    p_game_code
  );

  if
    p_target_player is not null
    and p_target_player not in (1, 2)
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
    upper(trim(p_game_code))
  for update;

  if v_game.id is null then
    raise exception
      'Game not found';
  end if;

  insert into public.game_active_rules (
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
    SET "search_path" TO ''
    AS $$

declare

    v_player_no integer;

    v_game
        public.games%rowtype;

    /*
     * Carte courante :
     * peut être officielle ou personnalisée.
     */
    v_current_card
        public.protocol_playable_cards%rowtype;

    v_card_rule
        public.protocol_card_rules%rowtype;

    v_next_player integer;
    v_next_turn integer;
    v_next_phase text;

    /*
     * Résultat du sélecteur V2 unified.
     */
    v_next_pick jsonb;

    v_next_card_source text;

    v_next_source_id bigint;

    v_next_official_card_id bigint;

    v_next_custom_card_id bigint;

    v_next_card_type text;

    v_next_card_intensity integer;

    v_score_p1 integer;
    v_score_p2 integer;
    v_reward integer;

    v_bonus_p1 jsonb;
    v_bonus_p2 jsonb;

    v_forced_type text;
    v_forced_by integer;

    v_rule_target integer;
    v_rule_text text;

    v_scene_state jsonb;

    v_truth_count integer;
    v_duel_count integer;
    v_scene_count integer;
    v_persistent_count integer;

begin

    -- ========================================================
    -- AUTH
    -- ========================================================

    v_player_no :=
        public.protocol_current_player_no(
            p_game_code
        );


    if
        p_action is null

        or p_action not in (
            'done',
            'pass',
            'alternative',
            'duel'
        )
    then
        raise exception
            'Invalid action';
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


    if v_game.active_player <> v_player_no then
        raise exception
            'Not active player';
    end if;


    -- ========================================================
    -- CARTE COURANTE
    -- official + custom
    -- ========================================================

    select *
    into v_current_card

    from public.protocol_playable_cards c

    where
        (
            coalesce(
                v_game.current_card_source,
                'official'
            ) = 'official'

            and c.card_source = 'official'

            and c.official_card_id =
                v_game.current_card_id
        )

        or

        (
            v_game.current_card_source = 'custom'

            and c.card_source = 'custom'

            and c.custom_card_id =
                v_game.current_custom_card_id

            and c.couple_id =
                v_game.couple_id
        )

    limit 1;


    if not found then
        raise exception
            'Current card not found';
    end if;


    -- ========================================================
    -- RESOLUTION SERVEUR DUEL / SCENE
    -- ========================================================

    if
        v_current_card.type = 'duel'

        and p_action = 'done'
    then
        raise exception
            'Duel must be resolved with duel action';
    end if;


    /*
     * Les cartes custom V1 ne sont jamais des scènes.
     */
    if
        v_current_card.card_source = 'official'

        and v_current_card.type = 'scene'

        and p_action = 'done'
    then

        v_scene_state :=
            public.get_scene_state(
                p_game_code
            );


        if coalesce(
            (
                v_scene_state
                ->> 'is_multistep'
            )::boolean,
            false
        )
        then

            if not coalesce(
                (
                    v_scene_state
                    ->> 'is_last'
                )::boolean,
                false
            )
            then
                raise exception
                    'Scene is not on its last step';
            end if;


            if
                coalesce(
                    (
                        v_scene_state
                        ->> 'is_private'
                    )::boolean,
                    false
                )

                and not (
                    v_game.scene_step_read_player_1
                    and
                    v_game.scene_step_read_player_2
                )
            then
                raise exception
                    'Both players must read the private instruction first';
            end if;

        end if;

    end if;


    -- ========================================================
    -- ETAT SCORE / BONUS
    -- ========================================================

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


    -- ========================================================
    -- SCORE CARTE NORMALE
    -- ========================================================

    if p_action = 'done' then

        v_reward :=
            case

                when coalesce(
                    v_current_card.intensity,
                    1
                ) >= 5
                    then 3

                when coalesce(
                    v_current_card.intensity,
                    1
                ) >= 3
                    then 2

                else 1

            end;


        if
            v_game.active_player = 1

            and coalesce(
                (
                    v_bonus_p1
                    ->> 'double_reward'
                )::boolean,
                false
            )
        then

            v_reward :=
                v_reward * 2;

            v_bonus_p1 :=
                v_bonus_p1
                - 'double_reward';


        elsif
            v_game.active_player = 2

            and coalesce(
                (
                    v_bonus_p2
                    ->> 'double_reward'
                )::boolean,
                false
            )
        then

            v_reward :=
                v_reward * 2;

            v_bonus_p2 :=
                v_bonus_p2
                - 'double_reward';

        end if;


        if v_game.active_player = 1 then

            v_score_p1 :=
                v_score_p1
                + v_reward;

        else

            v_score_p2 :=
                v_score_p2
                + v_reward;

        end if;

    end if;


    -- ========================================================
    -- SCORE DUEL
    -- ========================================================

    if p_action = 'duel' then

        if v_current_card.type <> 'duel' then
            raise exception
                'Current card is not a duel';
        end if;


        if
            p_duel_winner is null

            or p_duel_winner not in (
                1,
                2
            )
        then
            raise exception
                'Invalid duel winner';
        end if;


        v_reward :=
            case

                when coalesce(
                    v_current_card.intensity,
                    1
                ) >= 5
                    then 6

                when coalesce(
                    v_current_card.intensity,
                    1
                ) >= 3
                    then 4

                else 2

            end;


        if p_duel_winner = 1 then

            v_score_p1 :=
                v_score_p1
                + v_reward;

        else

            v_score_p2 :=
                v_score_p2
                + v_reward;

        end if;

    end if;


    -- ========================================================
    -- HISTORIQUE
    -- ========================================================

    update public.game_card_history

    set
        outcome =
            case

                when p_action = 'duel'
                    then 'done'

                else p_action

            end,

        resolved_at =
            now()

    where game_id =
        v_game.id

      and outcome is null

      and (
        (
            v_current_card.card_source = 'official'

            and card_source = 'official'

            and card_id =
                v_current_card.official_card_id
        )

        or

        (
            v_current_card.card_source = 'custom'

            and card_source = 'custom'

            and custom_card_id =
                v_current_card.custom_card_id
        )
      );


    -- ========================================================
    -- TICK DES REGLES
    -- Alternative = même tour
    -- ========================================================

    if p_action <> 'alternative' then

        perform public.tick_game_rules(
            v_game.id
        );

    end if;


    -- ========================================================
    -- ACTIVATION REGLE PERSISTANTE
    -- uniquement officielle
    -- ========================================================

    if
        p_action = 'done'

        and v_current_card.card_source =
            'official'
    then

        select *
        into v_card_rule

        from public.protocol_card_rules

        where card_id =
            v_current_card.official_card_id

          and active = true

        limit 1;


        if v_card_rule.id is not null then

            v_rule_text :=
                replace(
                    replace(
                        v_card_rule.rule_text,

                        '{{active}}',

                        case

                            when v_game.active_player = 1
                                then coalesce(
                                    v_game.player_1_name,
                                    'Joueur 1'
                                )

                            else
                                coalesce(
                                    v_game.player_2_name,
                                    'Joueur 2'
                                )

                        end
                    ),

                    '{{partner}}',

                    case

                        when v_game.active_player = 1
                            then coalesce(
                                v_game.player_2_name,
                                'Joueur 2'
                            )

                        else
                            coalesce(
                                v_game.player_1_name,
                                'Joueur 1'
                            )

                    end
                );


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
                        v_current_card.official_card_id,
                        v_card_rule.rule_key,
                        v_card_rule.title,
                        v_rule_text,
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
                        v_current_card.official_card_id,
                        v_card_rule.rule_key,
                        v_card_rule.title,
                        v_rule_text,
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


    -- ========================================================
    -- PROCHAIN JOUEUR / TOUR
    -- ========================================================

    if p_action = 'alternative' then

        v_next_player :=
            v_game.active_player;

        v_next_turn :=
            v_game.turn_no;

        v_next_phase :=
            v_game.phase;


    else

        if coalesce(
            (
                v_bonus_p1
                ->> 'take_control_armed'
            )::boolean,
            false
        )
        then

            v_next_player :=
                1;

            v_bonus_p1 :=
                v_bonus_p1
                - 'take_control_armed';


        elsif coalesce(
            (
                v_bonus_p2
                ->> 'take_control_armed'
            )::boolean,
            false
        )
        then

            v_next_player :=
                2;

            v_bonus_p2 :=
                v_bonus_p2
                - 'take_control_armed';


        else

            v_next_player :=
                case

                    when v_game.active_player = 1
                        then 2

                    else 1

                end;

        end if;


        v_next_turn :=
            v_game.turn_no
            + 1;


        v_next_phase :=
            public.protocol_phase(
                v_next_turn,
                v_game.target_turns
            );

    end if;


    -- ========================================================
    -- FIN NORMALE
    -- ========================================================

    if
        p_action <> 'alternative'

        and v_next_turn >
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
                v_bonus_p2,

            timer_card_id =
                null,

            timer_custom_card_id =
                null,

            timer_started_at =
                null,

            timer_remaining_seconds =
                null,

            timer_running =
                false

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


    -- ========================================================
    -- BONUS CHOOSE TYPE
    -- ========================================================

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


    -- ========================================================
    -- STATS AVANT SELECTION
    -- ========================================================

    v_truth_count :=
        public.protocol_type_count(
            v_game.id,
            'truth'
        );


    v_duel_count :=
        public.protocol_type_count(
            v_game.id,
            'duel'
        );


    v_scene_count :=
        public.protocol_scene_count(
            v_game.id
        );


    v_persistent_count :=
        public.protocol_persistent_count(
            v_game.id
        );


    -- ========================================================
    -- DIRECTEUR V2 UNIFIED
    -- ========================================================

    v_next_pick :=
        public.protocol_select_card_v2_unified(
            v_game.id,
            v_next_player,
            v_next_turn,
            v_forced_type
        );


    if v_next_pick is null then

        if v_forced_type is not null then

            raise exception
                'No unused compatible card of this type';

        end if;


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
                v_bonus_p2,

            timer_card_id =
                null,

            timer_custom_card_id =
                null,

            timer_started_at =
                null,

            timer_remaining_seconds =
                null,

            timer_running =
                false

        where id =
            v_game.id;


        return jsonb_build_object(

            'finished',
                true,

            'reason',
                'compatible_pool_exhausted',

            'score_player_1',
                v_score_p1,

            'score_player_2',
                v_score_p2,

            'phase',
                'finished'
        );

    end if;


    -- ========================================================
    -- DECODE PICK
    -- ========================================================

    v_next_card_source :=
        v_next_pick
        ->> 'card_source';


    v_next_source_id :=
        (
            v_next_pick
            ->> 'source_id'
        )::bigint;


    v_next_official_card_id :=
        nullif(
            v_next_pick
            ->> 'official_card_id',
            ''
        )::bigint;


    v_next_custom_card_id :=
        nullif(
            v_next_pick
            ->> 'custom_card_id',
            ''
        )::bigint;


    v_next_card_type :=
        v_next_pick
        ->> 'type';


    v_next_card_intensity :=
        (
            v_next_pick
            ->> 'intensity'
        )::integer;


    if
        v_next_card_source not in (
            'official',
            'custom'
        )
    then
        raise exception
            'Invalid selected card source';
    end if;


    if
        v_next_card_source = 'official'

        and v_next_official_card_id is null
    then
        raise exception
            'Official card id missing';
    end if;


    if
        v_next_card_source = 'custom'

        and v_next_custom_card_id is null
    then
        raise exception
            'Custom card id missing';
    end if;


    -- ========================================================
    -- CONSOMMER CHOOSE TYPE
    -- uniquement après sélection réussie
    -- ========================================================

    if v_forced_by = 1 then

        v_bonus_p1 :=
            v_bonus_p1
            - 'choose_type_armed';


    elsif v_forced_by = 2 then

        v_bonus_p2 :=
            v_bonus_p2
            - 'choose_type_armed';

    end if;


    -- ========================================================
    -- UPDATE GAME
    -- ========================================================

    update public.games

    set
        current_card_source =
            v_next_card_source,

        current_card_id =
            case

                when v_next_card_source =
                    'official'

                then
                    v_next_official_card_id

                else
                    null

            end,

        current_custom_card_id =
            case

                when v_next_card_source =
                    'custom'

                then
                    v_next_custom_card_id

                else
                    null

            end,

        turn_no =
            v_next_turn,

        active_player =
            v_next_player,

        phase =
            v_next_phase,

        scene_step_no =
            case

                when
                    v_next_card_source =
                        'official'

                    and v_next_card_type =
                        'scene'

                then
                    1

                else
                    null

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
            v_bonus_p2,

        /*
         * Le timer appartient à la carte précédente.
         * On remet son état à zéro lors du changement.
         */
        timer_card_source =
            v_next_card_source,

        timer_card_id =
            null,

        timer_custom_card_id =
            null,

        timer_started_at =
            null,

        timer_remaining_seconds =
            null,

        timer_running =
            false

    where id =
        v_game.id;


    -- ========================================================
    -- HISTORY
    -- ========================================================

    insert into public.game_card_history (
        game_id,
        card_source,
        card_id,
        custom_card_id,
        turn_no,
        player_no
    )

    values (
        v_game.id,

        v_next_card_source,

        case

            when v_next_card_source =
                'official'

            then
                v_next_official_card_id

            else
                null

        end,

        case

            when v_next_card_source =
                'custom'

            then
                v_next_custom_card_id

            else
                null

        end,

        v_next_turn,

        v_next_player
    );


    -- ========================================================
    -- RETURN
    -- ========================================================

    return jsonb_build_object(

        'finished',
            false,

        'card_source',
            v_next_card_source,

        /*
         * ID utilisable côté frontend.
         * card_source lève l'ambiguïté official/custom.
         */
        'card_id',
            v_next_source_id,

        'official_card_id',
            v_next_official_card_id,

        'custom_card_id',
            v_next_custom_card_id,

        'card_type',
            v_next_card_type,

        'card_intensity',
            v_next_card_intensity,

        'turn_no',
            v_next_turn,

        'active_player',
            v_next_player,

        'phase',
            v_next_phase,

        'target_turns',
            v_game.target_turns,

        'progress',
            public.protocol_progress(
                v_next_turn,
                v_game.target_turns
            ),

        'effective_profile',
            public.protocol_effective_profile(
                v_game.director_mode,
                v_game.director_profile
            ),

        'score_player_1',
            v_score_p1,

        'score_player_2',
            v_score_p2,

        'truth_count_before',
            v_truth_count,

        'duel_count_before',
            v_duel_count,

        'scene_count_before',
            v_scene_count,

        'persistent_count_before',
            v_persistent_count,

        'scene_step_no',
            case

                when
                    v_next_card_source =
                        'official'

                    and v_next_card_type =
                        'scene'

                then
                    1

                else
                    null

            end
    );

end;

$$;


ALTER FUNCTION "public"."advance_protocol"("p_game_code" "text", "p_action" "text", "p_duel_winner" integer) OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."advance_protocol_guarded"("p_game_code" "text", "p_action" "text", "p_duel_winner" integer, "p_expected_turn_no" integer, "p_expected_card_id" bigint, "p_expected_card_source" "text") RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO ''
    AS $$

declare

  v_game
    public.games%rowtype;

  v_result jsonb;

  v_current_card_source text;

  v_current_card_id bigint;

begin

  perform public.protocol_current_player_no(
    p_game_code
  );


  if
    p_expected_turn_no is null
    or p_expected_card_id is null
    or p_expected_card_source is null
    or p_expected_card_source not in (
      'official',
      'custom'
    )
  then

    raise exception
      'Expected game state is required';

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


  v_current_card_source :=
    coalesce(
      v_game.current_card_source,
      'official'
    );


  v_current_card_id :=
    case

      when v_current_card_source =
        'custom'

      then
        v_game.current_custom_card_id

      else
        v_game.current_card_id

    end;


  if
    v_game.turn_no is distinct from
      p_expected_turn_no

    or

    v_current_card_source is distinct from
      p_expected_card_source

    or

    v_current_card_id is distinct from
      p_expected_card_id

  then

    return jsonb_build_object(

      'stale',
        true,

      'reason',
        'game_state_changed',

      'expected_turn_no',
        p_expected_turn_no,

      'current_turn_no',
        v_game.turn_no,

      'expected_card_source',
        p_expected_card_source,

      'current_card_source',
        v_current_card_source,

      'expected_card_id',
        p_expected_card_id,

      'current_card_id',
        v_current_card_id
    );

  end if;


  v_result :=
    public.advance_protocol(
      p_game_code,
      p_action,
      p_duel_winner
    );


  return
    coalesce(
      v_result,
      '{}'::jsonb
    )
    ||
    jsonb_build_object(
      'stale',
      false
    );

end;

$$;


ALTER FUNCTION "public"."advance_protocol_guarded"("p_game_code" "text", "p_action" "text", "p_duel_winner" integer, "p_expected_turn_no" integer, "p_expected_card_id" bigint, "p_expected_card_source" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."advance_scene_step"("p_game_code" "text") RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
declare
  v_player_no integer;

  v_game
    public.games%rowtype;

  v_card
    public.protocol_cards%rowtype;

  v_step_count integer;
  v_next_step integer;

  v_scene_state jsonb;
  v_is_private boolean;
begin
  v_player_no :=
    public.protocol_current_player_no(
      p_game_code
    );

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

  if v_game.active_player <> v_player_no then
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
      p_game_code
    );

  v_is_private :=
    coalesce(
      (
        v_scene_state
        ->> 'is_private'
      )::boolean,
      false
    );

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
    v_next_step >=
      v_step_count
  );
end;
$$;


ALTER FUNCTION "public"."advance_scene_step"("p_game_code" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."advance_scene_step_guarded"("p_game_code" "text", "p_expected_card_id" bigint, "p_expected_scene_step_no" integer) RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
declare
  v_game public.games%rowtype;
  v_result jsonb;
begin

  perform public.protocol_current_player_no(
    p_game_code
  );


  if
    p_expected_card_id is null
    or p_expected_scene_step_no is null
  then
    raise exception
      'Expected scene state is required';
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


  /*
   * Carte ou étape déjà modifiée :
   * on ignore cette ancienne requête.
   */
  if
    v_game.current_card_id is distinct from
      p_expected_card_id
    or
    v_game.scene_step_no is distinct from
      p_expected_scene_step_no
  then

    return jsonb_build_object(
      'stale',
      true,

      'reason',
      'scene_state_changed',

      'expected_card_id',
      p_expected_card_id,

      'current_card_id',
      v_game.current_card_id,

      'expected_scene_step_no',
      p_expected_scene_step_no,

      'current_scene_step_no',
      v_game.scene_step_no
    );

  end if;


  v_result :=
    public.advance_scene_step(
      p_game_code
    );


  return
    coalesce(
      v_result,
      '{}'::jsonb
    )
    ||
    jsonb_build_object(
      'stale',
      false
    );

end;
$$;


ALTER FUNCTION "public"."advance_scene_step_guarded"("p_game_code" "text", "p_expected_card_id" bigint, "p_expected_scene_step_no" integer) OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."buy_protocol_bonus"("p_game_code" "text", "p_bonus" "text") RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
declare
  v_player_no integer;
  v_game public.games%rowtype;
  v_cost integer;
  v_score integer;
  v_current_bonus jsonb;
begin
  v_player_no :=
    public.protocol_current_player_no(
      p_game_code
    );

  if p_bonus not in (
    'take_control',
    'double_reward',
    'choose_type'
  ) then
    raise exception
      'Invalid bonus';
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

  v_cost :=
    case p_bonus
      when 'choose_type' then 2
      when 'take_control' then 3
      when 'double_reward' then 3
    end;

  if v_player_no = 1 then

    v_score :=
      coalesce(
        v_game.score_player_1,
        0
      );

    v_current_bonus :=
      coalesce(
        v_game.bonus_player_1,
        '{}'::jsonb
      );

  elsif v_player_no = 2 then

    v_score :=
      coalesce(
        v_game.score_player_2,
        0
      );

    v_current_bonus :=
      coalesce(
        v_game.bonus_player_2,
        '{}'::jsonb
      );

  else
    raise exception
      'Invalid player number';
  end if;

  if v_score < v_cost then
    raise exception
      'Not enough points';
  end if;

  if coalesce(
    (
      v_current_bonus
      ->> p_bonus
    )::boolean,
    false
  ) then
    raise exception
      'Bonus already owned';
  end if;

  if v_player_no = 1 then

    update public.games
    set
      score_player_1 =
        coalesce(
          score_player_1,
          0
        ) - v_cost,

      bonus_player_1 =
        coalesce(
          bonus_player_1,
          '{}'::jsonb
        )
        ||
        jsonb_build_object(
          p_bonus,
          true
        )

    where id =
      v_game.id;

  else

    update public.games
    set
      score_player_2 =
        coalesce(
          score_player_2,
          0
        ) - v_cost,

      bonus_player_2 =
        coalesce(
          bonus_player_2,
          '{}'::jsonb
        )
        ||
        jsonb_build_object(
          p_bonus,
          true
        )

    where id =
      v_game.id;

  end if;

  return jsonb_build_object(
    'ok',
    true,

    'bonus',
    p_bonus,

    'cost',
    v_cost
  );
end;
$$;


ALTER FUNCTION "public"."buy_protocol_bonus"("p_game_code" "text", "p_bonus" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."buy_protocol_bonus_guarded"("p_game_code" "text", "p_bonus" "text", "p_expected_turn_no" integer, "p_expected_card_id" bigint, "p_expected_card_source" "text") RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO ''
    AS $$

declare

  v_game
    public.games%rowtype;

  v_result jsonb;

  v_current_card_source text;

  v_current_card_id bigint;

begin

  perform public.protocol_current_player_no(
    p_game_code
  );


  if
    p_expected_turn_no is null
    or p_expected_card_id is null
    or p_expected_card_source is null
    or p_expected_card_source not in (
      'official',
      'custom'
    )
  then

    raise exception
      'Expected game state is required';

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


  v_current_card_source :=
    coalesce(
      v_game.current_card_source,
      'official'
    );


  v_current_card_id :=
    case

      when v_current_card_source =
        'custom'

      then
        v_game.current_custom_card_id

      else
        v_game.current_card_id

    end;


  if
    v_game.turn_no is distinct from
      p_expected_turn_no

    or

    v_current_card_source is distinct from
      p_expected_card_source

    or

    v_current_card_id is distinct from
      p_expected_card_id

  then

    return jsonb_build_object(
      'stale',
      true,

      'reason',
      'game_state_changed'
    );

  end if;


  v_result :=
    public.buy_protocol_bonus(
      p_game_code,
      p_bonus
    );


  return
    coalesce(
      v_result,
      '{}'::jsonb
    )
    ||
    jsonb_build_object(
      'stale',
      false
    );

end;

$$;


ALTER FUNCTION "public"."buy_protocol_bonus_guarded"("p_game_code" "text", "p_bonus" "text", "p_expected_turn_no" integer, "p_expected_card_id" bigint, "p_expected_card_source" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."create_protocol_couple_invite"() RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
declare
  v_user_id uuid;
  v_code text;
  v_expires_at timestamptz;
begin
  v_user_id := auth.uid();

  if v_user_id is null then
    raise exception 'Authentication required';
  end if;

  if exists (
    select 1
    from public.protocol_couple_members
    where user_id = v_user_id
  ) then
    raise exception 'User already belongs to a couple';
  end if;

  /*
   * Invalide les anciens codes encore ouverts.
   */
  update public.protocol_couple_invites
  set consumed_at = now()
  where created_by = v_user_id
    and consumed_at is null;

  /*
   * 10 caractères hexadécimaux.
   */
  loop
    v_code :=
      upper(
        substring(
          replace(
            gen_random_uuid()::text,
            '-',
            ''
          )
          from 1 for 10
        )
      );

    exit when not exists (
      select 1
      from public.protocol_couple_invites
      where code = v_code
    );
  end loop;

  v_expires_at :=
    now() + interval '24 hours';

  insert into public.protocol_couple_invites (
    created_by,
    code,
    expires_at
  )
  values (
    v_user_id,
    v_code,
    v_expires_at
  );

  return jsonb_build_object(
    'success', true,
    'code', v_code,
    'expires_at', v_expires_at
  );
end;
$$;


ALTER FUNCTION "public"."create_protocol_couple_invite"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."create_protocol_game"() RETURNS TABLE("code" "text", "player_no" integer)
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
declare
  v_user_id uuid;
  v_couple_id uuid;

  v_director_mode text :=
    'classic';

  v_director_profile text :=
    null;

  v_director_duration text :=
    'normal';

  v_code text;
  v_game_id uuid;
  v_attempt integer := 0;

begin

  /* =======================================================
     AUTH
     ======================================================= */

  v_user_id :=
    auth.uid();

  if v_user_id is null then
    raise exception
      'Authentication required';
  end if;


  /* =======================================================
     COUPLE
     ======================================================= */

  select pcm.couple_id
  into v_couple_id
  from public.protocol_couple_members pcm
  where pcm.user_id =
    v_user_id
  limit 1;


  if v_couple_id is null then
    raise exception
      'User is not linked to a couple';
  end if;


  /* =======================================================
     DIRECTOR SETTINGS SNAPSHOT
     ======================================================= */

  select
    s.director_mode,
    s.director_profile,
    s.director_duration

  into
    v_director_mode,
    v_director_profile,
    v_director_duration

  from public.protocol_couple_settings s
  where s.couple_id =
    v_couple_id;


  /*
   * Aucun réglage enregistré :
   * comportement historique.
   */
  if not found then

    v_director_mode :=
      'classic';

    v_director_profile :=
      null;

    v_director_duration :=
      'normal';

  end if;


  /* =======================================================
     GAME CODE
     ======================================================= */

  loop

    v_attempt :=
      v_attempt + 1;


    if v_attempt > 20 then
      raise exception
        'Unable to generate unique game code';
    end if;


    v_code :=
      public.protocol_generate_game_code();


    begin

      insert into public.games (
        code,
        player_count,
        status,
        player_1_ready,
        player_2_ready,
        couple_id,

        director_mode,
        director_profile,
        director_duration,
        target_turns
      )
      values (
        v_code,
        1,
        'waiting',
        false,
        false,
        v_couple_id,

        v_director_mode,
        v_director_profile,
        v_director_duration,

        case

          when v_director_mode <> 'custom' then
            20

          when v_director_duration = 'short' then
            16

          when v_director_duration = 'long' then
            28

          else
            20

        end
      )
      returning id
      into v_game_id;


      exit;


    exception
      when unique_violation then
        null;

    end;

  end loop;


  /* =======================================================
     PLAYER 1
     ======================================================= */

  insert into public.game_players (
    game_id,
    user_id,
    player_no
  )
  values (
    v_game_id,
    v_user_id,
    1
  );


  /* =======================================================
     RESULT
     ======================================================= */

  return query
  select
    v_code,
    1;

end;
$$;


ALTER FUNCTION "public"."create_protocol_game"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."current_protocol_couple_id"() RETURNS "uuid"
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
    SELECT COALESCE(
        NULLIF(
            to_jsonb(public.get_protocol_couple())
                ->> 'id',
            ''
        )::uuid,

        NULLIF(
            to_jsonb(public.get_protocol_couple())
                ->> 'couple_id',
            ''
        )::uuid
    );
$$;


ALTER FUNCTION "public"."current_protocol_couple_id"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."delete_protocol_account_data"() RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
declare
  v_user_id uuid;
  v_couple_id uuid;
  v_membership_count integer := 0;

  v_games_count integer := 0;
  v_partner_count integer := 0;

  v_deleted_card_invitations integer := 0;
  v_deleted_messages integer := 0;
  v_deleted_signals integer := 0;
  v_deleted_couple_invites integer := 0;
  v_deleted_legacy_games integer := 0;
  v_deleted_lovense integer := 0;
  v_deleted_push integer := 0;
  v_deleted_profile integer := 0;
  v_deleted_memberships integer := 0;
  v_deleted_couple integer := 0;

  v_residual_references integer := 0;
  v_row_count integer := 0;
begin
  /*
   * 1. IDENTITÉ DU COMPTE CONNECTÉ
   */
  v_user_id := auth.uid();

  if v_user_id is null then
    raise exception 'Authentication required';
  end if;


  /*
   * 2. RETROUVER LE COUPLE
   */
  select count(*)
  into v_membership_count
  from public.protocol_couple_members
  where user_id = v_user_id;

  if v_membership_count > 1 then
    raise exception
      'Account belongs to more than one couple';
  end if;

  select pcm.couple_id
  into v_couple_id
  from public.protocol_couple_members pcm
  where pcm.user_id = v_user_id
  limit 1;


  /*
   * 3. SI COUPLE :
   *    supprimer les données communes puis le couple
   */
  if v_couple_id is not null then

    select count(*)
    into v_games_count
    from public.games
    where couple_id = v_couple_id;

    select count(*)
    into v_partner_count
    from public.protocol_couple_members
    where couple_id = v_couple_id
      and user_id <> v_user_id;


    delete from public.card_invitations
    where couple_id = v_couple_id;

    get diagnostics v_row_count = row_count;
    v_deleted_card_invitations :=
      v_deleted_card_invitations + v_row_count;


    delete from public.protocol_messages
    where couple_id = v_couple_id;

    get diagnostics v_row_count = row_count;
    v_deleted_messages :=
      v_deleted_messages + v_row_count;


    delete from public.protocol_signals
    where couple_id = v_couple_id;

    get diagnostics v_row_count = row_count;
    v_deleted_signals :=
      v_deleted_signals + v_row_count;


    /*
     * Cascade :
     * protocol_couples
     *   -> protocol_couple_members
     *   -> protocol_lovense_connections
     *   -> push_subscriptions
     *   -> games
     *
     * games
     *   -> game_players
     *   -> game_card_history
     *   -> game_active_rules
     *   -> calibration_responses
     */
    delete from public.protocol_couples
    where id = v_couple_id;

    get diagnostics
      v_deleted_couple = row_count;

  end if;


  /*
   * 4. NETTOYAGE PERSONNEL / LEGACY
   */
  delete from public.card_invitations
  where sender_user_id = v_user_id
     or recipient_user_id = v_user_id;

  get diagnostics v_row_count = row_count;
  v_deleted_card_invitations :=
    v_deleted_card_invitations + v_row_count;


  delete from public.protocol_messages
  where sender_user_id = v_user_id
     or recipient_user_id = v_user_id;

  get diagnostics v_row_count = row_count;
  v_deleted_messages :=
    v_deleted_messages + v_row_count;


  delete from public.protocol_signals
  where sender_user_id = v_user_id
     or recipient_user_id = v_user_id;

  get diagnostics v_row_count = row_count;
  v_deleted_signals :=
    v_deleted_signals + v_row_count;


  delete from public.protocol_couple_invites
  where created_by = v_user_id;

  get diagnostics
    v_deleted_couple_invites = row_count;


  /*
   * Vieilles parties éventuelles liées au user
   * uniquement via game_players.
   */
  delete from public.games g
  where exists (
    select 1
    from public.game_players gp
    where gp.game_id = g.id
      and gp.user_id = v_user_id
  );

  get diagnostics
    v_deleted_legacy_games = row_count;


  /*
   * Filets de sécurité legacy
   */
  delete from public.protocol_lovense_connections
  where user_id = v_user_id;

  get diagnostics
    v_deleted_lovense = row_count;


  delete from public.push_subscriptions
  where user_id = v_user_id;

  get diagnostics
    v_deleted_push = row_count;


  delete from public.protocol_couple_members
  where user_id = v_user_id;

  get diagnostics
    v_deleted_memberships = row_count;


  delete from public.protocol_profiles
  where user_id = v_user_id;

  get diagnostics
    v_deleted_profile = row_count;


  /*
   * 5. AUDIT FINAL DES RÉFÉRENCES UTILISATEUR
   */
  select
      (
        select count(*)
        from public.protocol_profiles
        where user_id = v_user_id
      )
    +
      (
        select count(*)
        from public.protocol_couple_members
        where user_id = v_user_id
      )
    +
      (
        select count(*)
        from public.protocol_couple_invites
        where created_by = v_user_id
      )
    +
      (
        select count(*)
        from public.protocol_couples
        where created_by = v_user_id
      )
    +
      (
        select count(*)
        from public.game_players
        where user_id = v_user_id
      )
    +
      (
        select count(*)
        from public.protocol_lovense_connections
        where user_id = v_user_id
      )
    +
      (
        select count(*)
        from public.card_invitations
        where sender_user_id = v_user_id
           or recipient_user_id = v_user_id
      )
    +
      (
        select count(*)
        from public.protocol_messages
        where sender_user_id = v_user_id
           or recipient_user_id = v_user_id
      )
    +
      (
        select count(*)
        from public.protocol_signals
        where sender_user_id = v_user_id
           or recipient_user_id = v_user_id
      )
    +
      (
        select count(*)
        from public.push_subscriptions
        where user_id = v_user_id
      )
  into v_residual_references;


  /*
   * 6. RETOUR
   */
  return jsonb_build_object(
    'ok',
      v_residual_references = 0,

    'user_id',
      v_user_id,

    'couple_id',
      v_couple_id,

    'partner_accounts_preserved',
      v_partner_count,

    'games_deleted_by_couple',
      v_games_count,

    'deleted',
      jsonb_build_object(
        'couple',
          v_deleted_couple,

        'card_invitations',
          v_deleted_card_invitations,

        'messages',
          v_deleted_messages,

        'signals',
          v_deleted_signals,

        'couple_invites',
          v_deleted_couple_invites,

        'legacy_games',
          v_deleted_legacy_games,

        'legacy_lovense_connections',
          v_deleted_lovense,

        'legacy_push_subscriptions',
          v_deleted_push,

        'legacy_memberships',
          v_deleted_memberships,

        'profile',
          v_deleted_profile
      ),

    'residual_user_references',
      v_residual_references
  );
end;
$$;


ALTER FUNCTION "public"."delete_protocol_account_data"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."get_active_rules"("p_game_code" "text") RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
declare
  v_player_no integer;
  v_game_id uuid;
  v_rules jsonb;
begin
  v_player_no :=
    public.protocol_current_player_no(
      p_game_code
    );

  select g.id
  into v_game_id
  from public.games g
  where g.code =
    upper(trim(p_game_code));

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
        v_player_no
    );

  return v_rules;
end;
$$;


ALTER FUNCTION "public"."get_active_rules"("p_game_code" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."get_card_invitation_secure_v2"("p_invitation_id" "text") RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
declare
  v_user_id uuid;
  v_inv public.card_invitations%rowtype;
begin
  v_user_id := auth.uid();

  if v_user_id is null then
    raise exception 'Authentication required';
  end if;

  select *
  into v_inv
  from public.card_invitations
  where id::text = trim(p_invitation_id)
    and (
      sender_user_id = v_user_id
      or recipient_user_id = v_user_id
    )
  limit 1;

  if v_inv.id is null then
    return null;
  end if;

  return
    to_jsonb(v_inv)
    ||
    jsonb_build_object(
      'card_source',
        coalesce(v_inv.card_source, 'official'),

      'effective_card_id',
        case
          when coalesce(v_inv.card_source, 'official') = 'custom'
            then v_inv.custom_card_id
          else v_inv.card_id
        end
    );
end;
$$;


ALTER FUNCTION "public"."get_card_invitation_secure_v2"("p_invitation_id" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."get_card_invitation_status_secure"("p_invitation_id" "uuid") RETURNS timestamp with time zone
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
declare
  v_user_id uuid := auth.uid();
  v_opened_at timestamptz;
begin
  if v_user_id is null then
    raise exception 'Authentication required';
  end if;

  select ci.opened_at
  into v_opened_at
  from public.card_invitations ci
  where
    ci.id = p_invitation_id
    and ci.sender_user_id = v_user_id;

  if not found then
    raise exception
      'Invitation introuvable ou non autorisée';
  end if;

  return v_opened_at;
end;
$$;


ALTER FUNCTION "public"."get_card_invitation_status_secure"("p_invitation_id" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."get_protocol_couple"() RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
declare
  v_user_id uuid;
  v_couple_id uuid;
  v_me jsonb;
  v_partner jsonb;
begin
  v_user_id := auth.uid();

  if v_user_id is null then
    raise exception 'Authentication required';
  end if;

  select couple_id
  into v_couple_id
  from public.protocol_couple_members
  where user_id = v_user_id;

  if v_couple_id is null then
    return null;
  end if;

  select jsonb_build_object(
    'user_id', p.user_id,
    'display_name', p.display_name,
    'sex', p.sex
  )
  into v_me
  from public.protocol_profiles p
  where p.user_id = v_user_id;

  select jsonb_build_object(
    'user_id', p.user_id,
    'display_name', p.display_name,
    'sex', p.sex
  )
  into v_partner
  from public.protocol_couple_members m
  join public.protocol_profiles p
    on p.user_id = m.user_id
  where m.couple_id = v_couple_id
    and m.user_id <> v_user_id
  limit 1;

  return jsonb_build_object(
    'id', v_couple_id,
    'me', v_me,
    'partner', v_partner
  );
end;
$$;


ALTER FUNCTION "public"."get_protocol_couple"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."get_protocol_couple_settings"() RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
declare
  v_user_id uuid;
  v_couple_id uuid;

  v_mode text;
  v_profile text;
  v_duration text;
begin

  v_user_id :=
    auth.uid();

  if v_user_id is null then
    raise exception
      'Authentication required';
  end if;


  select m.couple_id
  into v_couple_id
  from public.protocol_couple_members m
  where m.user_id =
    v_user_id
  limit 1;


  if v_couple_id is null then
    raise exception
      'User does not belong to a couple';
  end if;


  select
    s.director_mode,
    s.director_profile,
    s.director_duration
  into
    v_mode,
    v_profile,
    v_duration
  from public.protocol_couple_settings s
  where s.couple_id =
    v_couple_id;


  /*
   * Aucun réglage enregistré :
   * on retourne le comportement historique.
   */

  if not found then
    return jsonb_build_object(
      'director_mode',
      'classic',

      'director_profile',
      null,

      'director_duration',
      'normal'
    );
  end if;


  return jsonb_build_object(
    'director_mode',
    v_mode,

    'director_profile',
    v_profile,

    'director_duration',
    v_duration
  );

end;
$$;


ALTER FUNCTION "public"."get_protocol_couple_settings"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."get_protocol_current_card"("p_game_code" "text") RETURNS "jsonb"
    LANGUAGE "plpgsql" STABLE SECURITY DEFINER
    SET "search_path" TO ''
    AS $$

declare

  v_player_no integer;

  v_game
    public.games%rowtype;

  v_result jsonb;

begin

  -- Autorise uniquement un joueur de la partie
  v_player_no :=
    public.protocol_current_player_no(
      p_game_code
    );


  select *
  into v_game
  from public.games
  where code =
    upper(trim(p_game_code));


  if v_game.id is null then
    raise exception
      'Game not found';
  end if;


  if coalesce(
    v_game.current_card_source,
    'official'
  ) = 'custom'
  then

    select
      to_jsonb(c)
      ||
      jsonb_build_object(
        'card_source',
          'custom',

        'source_id',
          c.id,

        'official_card_id',
          null,

        'custom_card_id',
          c.id,

        'lovense_mode',
          null,

        'lovense_action',
          null,

        'lovense_intensity',
          null,

        'lovense_duration_sec',
          null,

        'lovense_pattern',
          null
      )

    into v_result

    from public.protocol_custom_cards c

    where c.id =
      v_game.current_custom_card_id

      and c.couple_id =
        v_game.couple_id;


  else

    select
      to_jsonb(c)
      ||
      jsonb_build_object(
        'card_source',
          'official',

        'source_id',
          c.id,

        'official_card_id',
          c.id,

        'custom_card_id',
          null
      )

    into v_result

    from public.protocol_cards c

    where c.id =
      v_game.current_card_id;

  end if;


  if v_result is null then
    raise exception
      'Current card not found';
  end if;


  return v_result;

end;

$$;


ALTER FUNCTION "public"."get_protocol_current_card"("p_game_code" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."get_protocol_final_stats"("p_game_code" "text") RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
declare
  v_player_no integer;
  v_game public.games%rowtype;

  v_total_cards integer := 0;
  v_actions integer := 0;
  v_truths integer := 0;
  v_duels integer := 0;
  v_scenes integer := 0;

  v_done integer := 0;
  v_passed integer := 0;

  v_max_intensity integer := 0;
begin
  v_player_no :=
    public.protocol_current_player_no(
      p_game_code
    );

  select *
  into v_game
  from public.games
  where code =
    upper(trim(p_game_code));

  if v_game.id is null then
    raise exception
      'Game not found';
  end if;

  select
    count(*),

    count(*) filter (
      where c.type = 'action'
    ),

    count(*) filter (
      where c.type = 'truth'
    ),

    count(*) filter (
      where c.type = 'duel'
    ),

    count(*) filter (
      where c.type = 'scene'
    ),

    count(*) filter (
      where h.outcome = 'done'
    ),

    count(*) filter (
      where h.outcome = 'pass'
    ),

    coalesce(
      max(c.intensity),
      0
    )

  into
    v_total_cards,
    v_actions,
    v_truths,
    v_duels,
    v_scenes,
    v_done,
    v_passed,
    v_max_intensity

  from public.game_card_history h

  join public.protocol_cards c
    on c.id = h.card_id

  where h.game_id =
    v_game.id;

  return jsonb_build_object(
    'total_cards',
    v_total_cards,

    'actions',
    v_actions,

    'truths',
    v_truths,

    'duels',
    v_duels,

    'scenes',
    v_scenes,

    'done',
    v_done,

    'passed',
    v_passed,

    'max_intensity',
    v_max_intensity
  );
end;
$$;


ALTER FUNCTION "public"."get_protocol_final_stats"("p_game_code" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."get_protocol_game"("p_game_code" "text") RETURNS TABLE("id" "uuid", "code" "text", "status" "text", "player_count" integer, "player_no" integer, "player_1_name" "text", "player_1_sex" "text", "player_2_name" "text", "player_2_sex" "text", "player_1_ready" boolean, "player_2_ready" boolean, "turn_no" integer, "active_player" smallint, "current_card_id" bigint, "score_player_1" integer, "score_player_2" integer, "bonus_player_1" "jsonb", "bonus_player_2" "jsonb", "target_turns" integer, "phase" "text", "finished_at" timestamp with time zone, "shared_profile" "jsonb", "timer_card_id" bigint, "timer_started_at" timestamp with time zone, "timer_remaining_seconds" integer, "timer_running" boolean, "scene_step_no" integer, "scene_step_read_player_1" boolean, "scene_step_read_player_2" boolean)
    LANGUAGE "plpgsql" STABLE SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
declare
  v_player_no integer;
begin
  v_player_no :=
    public.protocol_current_player_no(p_game_code);

  return query
  select
    g.id,
    g.code,
    g.status,
    g.player_count,
    v_player_no,
    g.player_1_name,
    g.player_1_sex,
    g.player_2_name,
    g.player_2_sex,
    g.player_1_ready,
    g.player_2_ready,
    g.turn_no,
    g.active_player,
    g.current_card_id,
    g.score_player_1,
    g.score_player_2,
    g.bonus_player_1,
    g.bonus_player_2,
    g.target_turns,
    g.phase,
    g.finished_at,
    g.shared_profile,
    g.timer_card_id,
    g.timer_started_at,
    g.timer_remaining_seconds,
    g.timer_running,
    g.scene_step_no,
    g.scene_step_read_player_1,
    g.scene_step_read_player_2
  from public.games g
  where g.code = upper(trim(p_game_code));
end;
$$;


ALTER FUNCTION "public"."get_protocol_game"("p_game_code" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."get_protocol_scene_preview"("p_card_id" bigint) RETURNS "jsonb"
    LANGUAGE "plpgsql" STABLE SECURITY DEFINER
    SET "search_path" TO ''
    AS $$

DECLARE
    v_steps jsonb;

BEGIN

    IF NOT EXISTS (
        SELECT 1
        FROM public.protocol_cards c
        WHERE c.id = p_card_id
          AND c.type = 'scene'
          AND c.active = true
          AND c.library_version = 'v1'
    ) THEN
        RETURN NULL;
    END IF;

    SELECT
        COALESCE(
            jsonb_agg(
                jsonb_build_object(
                    'step_no', s.step_no,
                    'title', s.title,
                    'prompt', s.prompt,

                    'title_active', s.title_active,
                    'prompt_active', s.prompt_active,

                    'title_partner', s.title_partner,
                    'prompt_partner', s.prompt_partner,

                    'title_player_1', s.title_player_1,
                    'prompt_player_1', s.prompt_player_1,

                    'title_player_2', s.title_player_2,
                    'prompt_player_2', s.prompt_player_2
                )
                ORDER BY s.step_no
            ),
            '[]'::jsonb
        )
    INTO v_steps
    FROM public.protocol_scene_steps s
    WHERE s.card_id = p_card_id;

    RETURN v_steps;

END;

$$;


ALTER FUNCTION "public"."get_protocol_scene_preview"("p_card_id" bigint) OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."get_scene_state"("p_game_code" "text") RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
declare
  v_player_no integer;

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
  v_player_no :=
    public.protocol_current_player_no(
      p_game_code
    );

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
    v_player_no =
    v_game.active_player;

  if v_is_active_player then

    v_title :=
      coalesce(
        v_step.title_active,

        case
          when v_player_no = 1
            then v_step.title_player_1
          else
            v_step.title_player_2
        end,

        v_step.title
      );

    v_prompt :=
      coalesce(
        v_step.prompt_active,

        case
          when v_player_no = 1
            then v_step.prompt_player_1
          else
            v_step.prompt_player_2
        end,

        v_step.prompt
      );

    v_is_private :=
      v_step.prompt_active is not null
      or
      v_step.title_active is not null
      or
      (
        v_player_no = 1
        and
        (
          v_step.prompt_player_1 is not null
          or
          v_step.title_player_1 is not null
        )
      )
      or
      (
        v_player_no = 2
        and
        (
          v_step.prompt_player_2 is not null
          or
          v_step.title_player_2 is not null
        )
      );

  else

    v_title :=
      coalesce(
        v_step.title_partner,

        case
          when v_player_no = 1
            then v_step.title_player_1
          else
            v_step.title_player_2
        end,

        v_step.title
      );

    v_prompt :=
      coalesce(
        v_step.prompt_partner,

        case
          when v_player_no = 1
            then v_step.prompt_player_1
          else
            v_step.prompt_player_2
        end,

        v_step.prompt
      );

    v_is_private :=
      v_step.prompt_partner is not null
      or
      v_step.title_partner is not null
      or
      (
        v_player_no = 1
        and
        (
          v_step.prompt_player_1 is not null
          or
          v_step.title_player_1 is not null
        )
      )
      or
      (
        v_player_no = 2
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


ALTER FUNCTION "public"."get_scene_state"("p_game_code" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."join_protocol_couple"("p_code" "text") RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
declare
  v_user_id uuid;
  v_invite public.protocol_couple_invites%rowtype;
  v_couple_id uuid;
begin
  v_user_id := auth.uid();

  if v_user_id is null then
    raise exception 'Authentication required';
  end if;

  if exists (
    select 1
    from public.protocol_couple_members
    where user_id = v_user_id
  ) then
    raise exception 'User already belongs to a couple';
  end if;

  select *
  into v_invite
  from public.protocol_couple_invites
  where code = upper(trim(p_code))
    and consumed_at is null
    and expires_at > now()
  for update;

  if not found then
    raise exception 'Invalid or expired invitation code';
  end if;

  if v_invite.created_by = v_user_id then
    raise exception 'You cannot join your own invitation';
  end if;

  if exists (
    select 1
    from public.protocol_couple_members
    where user_id = v_invite.created_by
  ) then
    raise exception 'Invitation creator already belongs to a couple';
  end if;

  insert into public.protocol_couples (
    created_by
  )
  values (
    v_invite.created_by
  )
  returning id
  into v_couple_id;

  insert into public.protocol_couple_members (
    couple_id,
    user_id
  )
  values
    (
      v_couple_id,
      v_invite.created_by
    ),
    (
      v_couple_id,
      v_user_id
    );

  update public.protocol_couple_invites
  set consumed_at = now()
  where id = v_invite.id;

  return jsonb_build_object(
    'success', true,
    'couple_id', v_couple_id
  );
end;
$$;


ALTER FUNCTION "public"."join_protocol_couple"("p_code" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."join_protocol_game"("p_game_code" "text") RETURNS TABLE("code" "text", "player_no" integer)
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
declare
  v_user_id uuid;
  v_code text;
  v_game_id uuid;
  v_player_1_user_id uuid;
begin
  v_user_id := auth.uid();

  if v_user_id is null then
    raise exception 'Authentication required';
  end if;

  v_code := upper(trim(p_game_code));

  if length(v_code) <> 6 then
    raise exception 'Invalid game code';
  end if;

  /*
   * Lock the game while the second player joins.
   */
  select g.id
  into v_game_id
  from public.games g
  where g.code = v_code
    and g.player_count = 1
    and g.status = 'waiting'
  for update;

  if v_game_id is null then
    if not exists (
      select 1
      from public.games g
      where g.code = v_code
    ) then
      raise exception 'Game not found';
    end if;

    raise exception 'Game already full or unavailable';
  end if;

  /*
   * Retrieve player 1 from the authenticated game membership.
   */
  select gp.user_id
  into v_player_1_user_id
  from public.game_players gp
  where gp.game_id = v_game_id
    and gp.player_no = 1;

  if v_player_1_user_id is null then
    raise exception 'Game owner not found';
  end if;

  /*
   * The same account cannot occupy both seats.
   */
  if v_player_1_user_id = v_user_id then
    raise exception 'User already belongs to this game';
  end if;

  /*
   * Both players must belong to the same PROTOCOL couple.
   */
  if not exists (
    select 1
    from public.protocol_couple_members m1
    join public.protocol_couple_members m2
      on m2.couple_id = m1.couple_id
    where m1.user_id = v_player_1_user_id
      and m2.user_id = v_user_id
  ) then
    raise exception 'Players must belong to the same couple';
  end if;

  /*
   * Register authenticated player 2.
   */
  insert into public.game_players (
    game_id,
    user_id,
    player_no
  )
  values (
    v_game_id,
    v_user_id,
    2
  );

  update public.games
  set
    player_count = 2,
    status = 'ready'
  where id = v_game_id;

  return query
  select
    v_code,
    2;
end;
$$;


ALTER FUNCTION "public"."join_protocol_game"("p_game_code" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."mark_card_invitation_opened_secure"("p_invitation_id" "uuid") RETURNS timestamp with time zone
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
declare
  v_user_id uuid := auth.uid();
  v_opened_at timestamptz;
begin
  if v_user_id is null then
    raise exception 'Authentication required';
  end if;

  update public.card_invitations
  set opened_at =
    coalesce(
      opened_at,
      now()
    )
  where
    id = p_invitation_id
    and recipient_user_id = v_user_id
  returning opened_at
  into v_opened_at;

  if not found then
    raise exception
      'Invitation introuvable ou non autorisée';
  end if;

  return v_opened_at;
end;
$$;


ALTER FUNCTION "public"."mark_card_invitation_opened_secure"("p_invitation_id" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."mark_scene_step_read"("p_game_code" "text") RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
declare
  v_player_no integer;

  v_game
    public.games%rowtype;

  v_card
    public.protocol_cards%rowtype;

  v_scene_state jsonb;
begin
  v_player_no :=
    public.protocol_current_player_no(
      p_game_code
    );

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
      p_game_code
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

  if v_player_no = 1 then

    update public.games
    set
      scene_step_read_player_1 = true
    where id = v_game.id;

  elsif v_player_no = 2 then

    update public.games
    set
      scene_step_read_player_2 = true
    where id = v_game.id;

  else
    raise exception
      'Invalid player number';
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


ALTER FUNCTION "public"."mark_scene_step_read"("p_game_code" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."mark_scene_step_read_guarded"("p_game_code" "text", "p_expected_card_id" bigint, "p_expected_scene_step_no" integer) RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
declare
  v_game public.games%rowtype;
  v_result jsonb;
begin

  perform public.protocol_current_player_no(
    p_game_code
  );

  if
    p_expected_card_id is null
    or p_expected_scene_step_no is null
  then
    raise exception
      'Expected scene state is required';
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

  if
    v_game.current_card_id is distinct from
      p_expected_card_id
    or
    v_game.scene_step_no is distinct from
      p_expected_scene_step_no
  then
    return jsonb_build_object(
      'stale', true,
      'reason', 'scene_state_changed'
    );
  end if;

  v_result :=
    public.mark_scene_step_read(
      p_game_code
    );

  return
    coalesce(v_result, '{}'::jsonb)
    ||
    jsonb_build_object(
      'stale', false
    );

end;
$$;


ALTER FUNCTION "public"."mark_scene_step_read_guarded"("p_game_code" "text", "p_expected_card_id" bigint, "p_expected_scene_step_no" integer) OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."prevent_custom_card_owner_change"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    SET "search_path" TO ''
    AS $$
begin
  if new.created_by is distinct from old.created_by then
    raise exception 'created_by cannot be changed';
  end if;

  if new.couple_id is distinct from old.couple_id then
    raise exception 'couple_id cannot be changed';
  end if;

  return new;
end;
$$;


ALTER FUNCTION "public"."prevent_custom_card_owner_change"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."protocol_current_player_no"("p_game_code" "text") RETURNS integer
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
declare
  v_user_id uuid;
  v_player_no integer;
begin
  v_user_id := auth.uid();

  if v_user_id is null then
    raise exception 'Authentication required';
  end if;

  select gp.player_no
  into v_player_no
  from public.game_players gp
  join public.games g
    on g.id = gp.game_id
  where g.code = upper(trim(p_game_code))
    and gp.user_id = v_user_id;

  if v_player_no is null then
    raise exception 'Access to game denied';
  end if;

  return v_player_no;
end;
$$;


ALTER FUNCTION "public"."protocol_current_player_no"("p_game_code" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."protocol_director_penalty"("p_mode" "text", "p_profile" "text", "p_card_type" "text", "p_card_intensity" integer, "p_has_persistent_rule" boolean, "p_lovense_mode" "text", "p_lovense_connected" boolean, "p_turn_no" integer, "p_target_turns" integer, "p_max_intensity" integer) RETURNS integer
    LANGUAGE "plpgsql" IMMUTABLE
    SET "search_path" TO ''
    AS $$

declare
  v_penalty integer := 0;
  v_distance_to_max integer := 0;

begin

  /* =======================================================
     CLASSIC
     ======================================================= */

  if coalesce(p_mode, 'classic') <> 'custom' then
    return 0;
  end if;

  if p_profile is null then
    return 0;
  end if;


  /* =======================================================
     DISTANCE TO CURRENT ALLOWED CEILING
     ======================================================= */

  v_distance_to_max :=
    greatest(
      coalesce(p_max_intensity, 1)
      - coalesce(p_card_intensity, 1),
      0
    );


  /* =======================================================
     COMPLICE
     Dialogue, proximité, rythme doux.
     ======================================================= */

  if p_profile = 'complice' then

    v_penalty :=
      case p_card_type
        when 'truth' then -140
        when 'action' then -20
        when 'duel' then 120
        when 'scene' then 60
        else 0
      end;

    v_penalty :=
      v_penalty
      + (
        greatest(
          coalesce(p_card_intensity, 1) - 1,
          0
        ) * 30
      );


  /* =======================================================
     SENSUEL
     Actions physiques et scènes.
     ======================================================= */

  elsif p_profile = 'sensual' then

    v_penalty :=
      case p_card_type
        when 'truth' then 10
        when 'action' then -70
        when 'duel' then 100
        when 'scene' then -110
        else 0
      end;

    v_penalty :=
      v_penalty
      + (
        greatest(
          coalesce(p_card_intensity, 1) - 2,
          0
        ) * 15
      );


  /* =======================================================
     PROVOCATEUR
     Duels, actions et changements de rythme.
     ======================================================= */

  elsif p_profile = 'provocative' then

    v_penalty :=
      case p_card_type
        when 'truth' then 30
        when 'action' then -40
        when 'duel' then -150
        when 'scene' then -20
        else 0
      end;

    v_penalty :=
      v_penalty
      - (
        greatest(
          coalesce(p_card_intensity, 1) - 1,
          0
        ) * 15
      );

    if coalesce(
      p_has_persistent_rule,
      false
    ) then
      v_penalty :=
        v_penalty - 40;
    end if;


  /* =======================================================
     INTENSE
     Cherche le haut de la plage autorisée.
     ======================================================= */

  elsif p_profile = 'intense' then

    v_penalty :=
      case p_card_type
        when 'truth' then 40
        when 'action' then -50
        when 'duel' then -20
        when 'scene' then -90
        else 0
      end;

    v_penalty :=
      v_penalty
      + (
        v_distance_to_max * 55
      );

    if coalesce(
      p_has_persistent_rule,
      false
    ) then
      v_penalty :=
        v_penalty - 90;
    end if;


  /* =======================================================
     DEBRIDE
     Cherche franchement le haut de la plage autorisée.
     ======================================================= */

  elsif p_profile = 'unrestrained' then

    v_penalty :=
      case p_card_type
        when 'truth' then 60
        when 'action' then -60
        when 'duel' then -70
        when 'scene' then -140
        else 0
      end;

    v_penalty :=
      v_penalty
      + (
        v_distance_to_max * 85
      );

    if coalesce(
      p_has_persistent_rule,
      false
    ) then
      v_penalty :=
        v_penalty - 140;
    end if;

    if
      coalesce(
        p_lovense_connected,
        false
      )
      and
      p_lovense_mode is not null
    then

      v_penalty :=
        v_penalty - 130;

    end if;


  else

    return 0;

  end if;


  return v_penalty;

end;

$$;


ALTER FUNCTION "public"."protocol_director_penalty"("p_mode" "text", "p_profile" "text", "p_card_type" "text", "p_card_intensity" integer, "p_has_persistent_rule" boolean, "p_lovense_mode" "text", "p_lovense_connected" boolean, "p_turn_no" integer, "p_target_turns" integer, "p_max_intensity" integer) OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."protocol_duel_spacing_v2"("p_target_turns" integer) RETURNS integer
    LANGUAGE "sql" IMMUTABLE
    SET "search_path" TO ''
    AS $$
    -- 16 tours -> 4 ; 20 tours -> 5 ; 28 tours -> 7
    select greatest(3, round(p_target_turns * 0.25)::integer);
$$;


ALTER FUNCTION "public"."protocol_duel_spacing_v2"("p_target_turns" integer) OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."protocol_effective_profile"("p_mode" "text", "p_profile" "text") RETURNS "text"
    LANGUAGE "sql" IMMUTABLE
    SET "search_path" TO ''
    AS $$
    SELECT
        CASE
            WHEN coalesce(p_mode, 'classic') <> 'custom'
                THEN 'classic'

            WHEN p_profile = 'intense'
                THEN 'classic'

            WHEN p_profile IN (
                'classic',
                'complice',
                'sensual',
                'provocative',
                'unrestrained'
            )
                THEN p_profile

            ELSE 'classic'
        END;
$$;


ALTER FUNCTION "public"."protocol_effective_profile"("p_mode" "text", "p_profile" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."protocol_family_reuse_weight"() RETURNS numeric
    LANGUAGE "sql" IMMUTABLE
    SET "search_path" TO ''
    AS $$
    select 0.25::numeric;
$$;


ALTER FUNCTION "public"."protocol_family_reuse_weight"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."protocol_family_window"("p_target_turns" integer) RETURNS integer
    LANGUAGE "sql" IMMUTABLE
    SET "search_path" TO ''
    AS $$
    -- 16 tours -> 6 ; 20 tours -> 8 ; 28 tours -> 11
    select greatest(6, round(p_target_turns * 0.40)::integer);
$$;


ALTER FUNCTION "public"."protocol_family_window"("p_target_turns" integer) OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."protocol_generate_game_code"() RETURNS "text"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
DECLARE
    v_chars constant text :=
        'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

    v_code text := '';
    i integer;
BEGIN

    FOR i IN 1..6 LOOP
        v_code :=
            v_code ||
            substr(
                v_chars,
                1 + floor(
                    random() * length(v_chars)
                )::integer,
                1
            );
    END LOOP;

    RETURN v_code;

END;
$$;


ALTER FUNCTION "public"."protocol_generate_game_code"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."protocol_last_intensity_v2"("p_game_id" "uuid") RETURNS integer
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$

  select
    coalesce(
      oc.intensity,
      cc.intensity
    )

  from public.game_card_history h

  left join public.protocol_cards oc
    on h.card_source = 'official'
   and oc.id = h.card_id

  left join public.protocol_custom_cards cc
    on h.card_source = 'custom'
   and cc.id = h.custom_card_id

  where h.game_id = p_game_id

    and coalesce(
      h.outcome,
      'pending'
    ) <> 'alternative'

  order by
    h.shown_at desc,
    h.id desc

  limit 1;

$$;


ALTER FUNCTION "public"."protocol_last_intensity_v2"("p_game_id" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."protocol_last_scene_turn"("p_game_id" "uuid") RETURNS integer
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$

    SELECT max(h.turn_no)::integer

    FROM public.game_card_history h

    JOIN public.protocol_cards c
      ON c.id = h.card_id

    WHERE h.game_id = p_game_id

      AND h.card_source = 'official'

      AND c.type = 'scene'

      AND h.outcome = 'done';

$$;


ALTER FUNCTION "public"."protocol_last_scene_turn"("p_game_id" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."protocol_last_type_turn"("p_game_id" "uuid", "p_type" "text") RETURNS integer
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$

  select max(
    h.turn_no
  )::integer

  from public.game_card_history h

  left join public.protocol_cards oc
    on h.card_source = 'official'
   and oc.id = h.card_id

  left join public.protocol_custom_cards cc
    on h.card_source = 'custom'
   and cc.id = h.custom_card_id

  where h.game_id = p_game_id

    and coalesce(
      oc.type,
      cc.type
    ) = p_type

    and coalesce(
      h.outcome,
      'pending'
    ) <> 'alternative';

$$;


ALTER FUNCTION "public"."protocol_last_type_turn"("p_game_id" "uuid", "p_type" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."protocol_lovense_card_allowed"("p_couple_id" "uuid", "p_card_id" bigint) RETURNS boolean
    LANGUAGE "plpgsql" STABLE SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
declare
  v_mode text;
begin

  select c.lovense_mode
  into v_mode
  from public.protocol_cards c
  where c.id = p_card_id;

  if not found then
    return false;
  end if;

  if coalesce(v_mode, 'none') <> 'required' then
    return true;
  end if;

  if p_couple_id is null then
    return false;
  end if;

  return exists (
    select 1
    from public.protocol_lovense_connections lc
    where lc.couple_id = p_couple_id

      and nullif(
        trim(lc.lovense_uid),
        ''
      ) is not null

      and exists (
        select 1
        from jsonb_array_elements(
          coalesce(
            lc.toys,
            '[]'::jsonb
          )
        ) as toy

        where coalesce(
          (toy ->> 'connected')::boolean,
          false
        ) = true
      )
  );

end;
$$;


ALTER FUNCTION "public"."protocol_lovense_card_allowed"("p_couple_id" "uuid", "p_card_id" bigint) OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."protocol_lovense_connected"("p_couple_id" "uuid") RETURNS boolean
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
  select
    coalesce(
      exists (
        select 1
        from public.protocol_lovense_connections lc
        where lc.couple_id = p_couple_id

          and nullif(
            trim(lc.lovense_uid),
            ''
          ) is not null

          and exists (
            select 1

            from jsonb_array_elements(
              case
                when jsonb_typeof(lc.toys) = 'array'
                  then lc.toys

                when jsonb_typeof(lc.toys) = 'object'
                  then (
                    select
                      coalesce(
                        jsonb_agg(value),
                        '[]'::jsonb
                      )
                    from jsonb_each(lc.toys)
                  )

                else
                  '[]'::jsonb
              end
            ) as toy

            where coalesce(
              (toy ->> 'connected')::boolean,
              false
            ) = true
          )
      ),
      false
    );
$$;


ALTER FUNCTION "public"."protocol_lovense_connected"("p_couple_id" "uuid") OWNER TO "postgres";


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


CREATE OR REPLACE FUNCTION "public"."protocol_persistent_count"("p_game_id" "uuid") RETURNS integer
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$

    SELECT count(*)::integer

    FROM public.game_card_history h

    JOIN public.protocol_card_rules r
      ON r.card_id = h.card_id
     AND r.active = true

    WHERE h.game_id = p_game_id

      AND h.card_source = 'official'

      AND h.outcome = 'done';

$$;


ALTER FUNCTION "public"."protocol_persistent_count"("p_game_id" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."protocol_persistent_max_v2"("p_target_turns" integer) RETURNS integer
    LANGUAGE "sql" IMMUTABLE
    SET "search_path" TO ''
    AS $$
    SELECT CASE
        WHEN p_target_turns <= 12 THEN 1
        WHEN p_target_turns <= 20 THEN 2
        ELSE 3
    END;
$$;


ALTER FUNCTION "public"."protocol_persistent_max_v2"("p_target_turns" integer) OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."protocol_phase"("p_turn_no" integer, "p_target_turns" integer) RETURNS "text"
    LANGUAGE "plpgsql" IMMUTABLE
    SET "search_path" TO ''
    AS $$
DECLARE
    v_progress numeric;
BEGIN

    IF p_turn_no > p_target_turns THEN
        RETURN 'finished';
    END IF;

    v_progress :=
        public.protocol_progress(
            p_turn_no,
            p_target_turns
        );

    IF v_progress < 0.20 THEN
        RETURN 'warmup';

    ELSIF v_progress < 0.45 THEN
        RETURN 'rise';

    ELSIF v_progress < 0.75 THEN
        RETURN 'intense';

    ELSE
        RETURN 'finale';
    END IF;

END;
$$;


ALTER FUNCTION "public"."protocol_phase"("p_turn_no" integer, "p_target_turns" integer) OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."protocol_pick_start_card"("p_game_code" "text") RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO ''
    AS $$

DECLARE

    v_player_no integer;
    v_game public.games%rowtype;

    v_first_player integer;
    v_player_sex text;

    v_profile_intensity integer;
    v_max_intensity integer;

    v_effective_profile text;

    v_card record;

BEGIN

    v_player_no :=
        public.protocol_current_player_no(
            p_game_code
        );

    SELECT *
    INTO v_game
    FROM public.games
    WHERE code = upper(trim(p_game_code));

    IF v_game.id IS NULL THEN
        RAISE EXCEPTION 'Game not found';
    END IF;

    IF v_game.shared_profile IS NULL THEN
        RAISE EXCEPTION 'Shared profile not found';
    END IF;


    /* =======================================================
       EFFECTIVE PROFILE
       intense => classic volontairement
       ======================================================= */

    v_effective_profile :=
        public.protocol_effective_profile(
            v_game.director_mode,
            v_game.director_profile
        );


    /* =======================================================
       FIRST PLAYER : 50 / 50
       ======================================================= */

    v_first_player :=
        CASE
            WHEN random() < 0.5 THEN 1
            ELSE 2
        END;


    v_player_sex :=
        CASE
            WHEN v_first_player = 1
                THEN v_game.player_1_sex
            ELSE
                v_game.player_2_sex
        END;


    /* =======================================================
       INTENSITY
       ======================================================= */

    v_profile_intensity :=
        greatest(
            1,
            least(
                5,
                coalesce(
                    (
                        v_game.shared_profile
                        ->> 'intensity'
                    )::integer,
                    1
                )
            )
        );


    v_max_intensity :=
        public.protocol_max_intensity(
            v_profile_intensity,
            1
        );


    /* =======================================================
       CARD PICK
       ======================================================= */

    SELECT c.*
    INTO v_card

    FROM public.protocol_playable_cards c

    WHERE c.active = true

      AND (
          (
              c.card_source = 'official'
              AND c.library_version = 'v1'
          )
          OR
          (
              c.card_source = 'custom'
              AND c.couple_id = v_game.couple_id
          )
      )

      AND (
          c.target_sex IS NULL
          OR c.target_sex = v_player_sex
      )

      AND c.intensity <= v_max_intensity

      -- première carte : jamais une vérité au-delà du niveau 1
      AND (
          c.type <> 'truth'
          OR c.intensity = 1
      )

      AND (
          c.card_source = 'custom'

          OR

          (
              public.protocol_lovense_card_allowed(
                  v_game.couple_id,
                  c.official_card_id
              )

              AND

              public.protocol_scene_allowed(
                  v_game.id,
                  c.official_card_id,
                  1
              )

              AND

              public.protocol_rule_card_allowed(
                  v_game.id,
                  c.official_card_id,
                  v_first_player,
                  1
              )
          )
      )

    ORDER BY

        -ln(
            greatest(
                random(),
                0.000000000001
            )
        )

        /

        exp(
            -
            public.protocol_director_penalty(

                'custom',

                v_effective_profile,

                c.type,

                c.intensity,

                CASE
                    WHEN c.card_source = 'official'
                    THEN EXISTS (
                        SELECT 1
                        FROM public.protocol_card_rules pr
                        WHERE pr.card_id = c.official_card_id
                          AND pr.active = true
                    )
                    ELSE false
                END,

                CASE
                    WHEN c.card_source = 'official'
                        THEN c.lovense_mode
                    ELSE null
                END,

                public.protocol_lovense_connected(
                    v_game.couple_id
                ),

                1,

                v_game.target_turns,

                v_max_intensity

            )::double precision

            / 100.0
        )

    LIMIT 1;


    IF v_card.source_id IS NULL THEN
        RAISE EXCEPTION
            'No compatible card found';
    END IF;


    RETURN jsonb_build_object(

        'card_source',
            v_card.card_source,

        'source_id',
            v_card.source_id,

        'official_card_id',
            v_card.official_card_id,

        'custom_card_id',
            v_card.custom_card_id,

        'type',
            v_card.type,

        'title',
            v_card.title,

        'prompt',
            v_card.prompt,

        'intensity',
            v_card.intensity,

        'target_sex',
            v_card.target_sex,

        'timer_seconds',
            v_card.timer_seconds,

        'library_key',
            v_card.library_key,

        'max_intensity',
            v_max_intensity,

        'first_player',
            v_first_player

    );

END;

$$;


ALTER FUNCTION "public"."protocol_pick_start_card"("p_game_code" "text") OWNER TO "postgres";


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


CREATE OR REPLACE FUNCTION "public"."protocol_profile_intensity_weight"("p_profile" "text", "p_card_type" "text", "p_intensity" integer, "p_turn_no" integer, "p_target_turns" integer) RETURNS numeric
    LANGUAGE "plpgsql" IMMUTABLE
    SET "search_path" TO ''
    AS $$
DECLARE
    p numeric;
    v_profile text;
BEGIN
    -- Vérités : intensité 1 à 3, qui suit l'avancement de la partie
    -- (le plafond protocol_max_intensity s'applique comme pour les autres types)
    IF p_card_type = 'truth' THEN
        p := public.protocol_progress(p_turn_no, p_target_turns);
        IF p < 0.20 THEN
            RETURN CASE p_intensity WHEN 1 THEN 85 WHEN 2 THEN 15 ELSE 0 END;
        ELSIF p < 0.40 THEN
            RETURN CASE p_intensity WHEN 1 THEN 50 WHEN 2 THEN 45 WHEN 3 THEN 5 ELSE 0 END;
        ELSIF p < 0.60 THEN
            RETURN CASE p_intensity WHEN 1 THEN 25 WHEN 2 THEN 50 WHEN 3 THEN 25 ELSE 0 END;
        ELSIF p < 0.80 THEN
            RETURN CASE p_intensity WHEN 1 THEN 10 WHEN 2 THEN 45 WHEN 3 THEN 45 ELSE 0 END;
        ELSE
            RETURN CASE p_intensity WHEN 1 THEN 5 WHEN 2 THEN 35 WHEN 3 THEN 60 ELSE 0 END;
        END IF;
    END IF;

    p := public.protocol_progress(p_turn_no, p_target_turns);

    v_profile :=
        CASE
            WHEN p_profile = 'intense' THEN 'classic'
            ELSE coalesce(p_profile, 'classic')
        END;

    -- Seul le poids de l'intensité 5 change (fin de partie) :
    --   classic      : 5 -> 8 (60-80 %) ; 15 -> 20 (80-100 %)
    --   provocative  : 2 -> 5 ; 10 -> 20 ; 20 -> 30
    --   unrestrained : 10 -> 20 ; 25 -> 40 ; 40 -> 60
    --   complice et sensual : inchangés
    IF v_profile = 'classic' THEN
        IF p < 0.20 THEN
            RETURN CASE p_intensity
                WHEN 1 THEN 55
                WHEN 2 THEN 40
                WHEN 3 THEN 5
                WHEN 4 THEN 0
                WHEN 5 THEN 0
                ELSE 0
            END;
        ELSIF p < 0.40 THEN
            RETURN CASE p_intensity
                WHEN 1 THEN 20
                WHEN 2 THEN 55
                WHEN 3 THEN 23
                WHEN 4 THEN 2
                WHEN 5 THEN 0
                ELSE 0
            END;
        ELSIF p < 0.60 THEN
            RETURN CASE p_intensity
                WHEN 1 THEN 5
                WHEN 2 THEN 30
                WHEN 3 THEN 50
                WHEN 4 THEN 15
                WHEN 5 THEN 0
                ELSE 0
            END;
        ELSIF p < 0.80 THEN
            RETURN CASE p_intensity
                WHEN 1 THEN 0
                WHEN 2 THEN 10
                WHEN 3 THEN 45
                WHEN 4 THEN 40
                WHEN 5 THEN 8
                ELSE 0
            END;
        ELSE
            RETURN CASE p_intensity
                WHEN 1 THEN 0
                WHEN 2 THEN 5
                WHEN 3 THEN 25
                WHEN 4 THEN 55
                WHEN 5 THEN 20
                ELSE 0
            END;
        END IF;
    ELSIF v_profile = 'complice' THEN
        IF p < 0.20 THEN
            RETURN CASE p_intensity
                WHEN 1 THEN 70
                WHEN 2 THEN 28
                WHEN 3 THEN 2
                WHEN 4 THEN 0
                WHEN 5 THEN 0
                ELSE 0
            END;
        ELSIF p < 0.40 THEN
            RETURN CASE p_intensity
                WHEN 1 THEN 40
                WHEN 2 THEN 50
                WHEN 3 THEN 10
                WHEN 4 THEN 0
                WHEN 5 THEN 0
                ELSE 0
            END;
        ELSIF p < 0.60 THEN
            RETURN CASE p_intensity
                WHEN 1 THEN 20
                WHEN 2 THEN 50
                WHEN 3 THEN 25
                WHEN 4 THEN 5
                WHEN 5 THEN 0
                ELSE 0
            END;
        ELSIF p < 0.80 THEN
            RETURN CASE p_intensity
                WHEN 1 THEN 10
                WHEN 2 THEN 35
                WHEN 3 THEN 40
                WHEN 4 THEN 14
                WHEN 5 THEN 1
                ELSE 0
            END;
        ELSE
            RETURN CASE p_intensity
                WHEN 1 THEN 5
                WHEN 2 THEN 20
                WHEN 3 THEN 45
                WHEN 4 THEN 25
                WHEN 5 THEN 5
                ELSE 0
            END;
        END IF;
    ELSIF v_profile = 'sensual' THEN
        IF p < 0.20 THEN
            RETURN CASE p_intensity
                WHEN 1 THEN 55
                WHEN 2 THEN 40
                WHEN 3 THEN 5
                WHEN 4 THEN 0
                WHEN 5 THEN 0
                ELSE 0
            END;
        ELSIF p < 0.40 THEN
            RETURN CASE p_intensity
                WHEN 1 THEN 25
                WHEN 2 THEN 50
                WHEN 3 THEN 23
                WHEN 4 THEN 2
                WHEN 5 THEN 0
                ELSE 0
            END;
        ELSIF p < 0.60 THEN
            RETURN CASE p_intensity
                WHEN 1 THEN 8
                WHEN 2 THEN 35
                WHEN 3 THEN 45
                WHEN 4 THEN 12
                WHEN 5 THEN 0
                ELSE 0
            END;
        ELSIF p < 0.80 THEN
            RETURN CASE p_intensity
                WHEN 1 THEN 2
                WHEN 2 THEN 15
                WHEN 3 THEN 48
                WHEN 4 THEN 30
                WHEN 5 THEN 5
                ELSE 0
            END;
        ELSE
            RETURN CASE p_intensity
                WHEN 1 THEN 0
                WHEN 2 THEN 8
                WHEN 3 THEN 32
                WHEN 4 THEN 48
                WHEN 5 THEN 12
                ELSE 0
            END;
        END IF;
    ELSIF v_profile = 'provocative' THEN
        IF p < 0.20 THEN
            RETURN CASE p_intensity
                WHEN 1 THEN 50
                WHEN 2 THEN 40
                WHEN 3 THEN 10
                WHEN 4 THEN 0
                WHEN 5 THEN 0
                ELSE 0
            END;
        ELSIF p < 0.40 THEN
            RETURN CASE p_intensity
                WHEN 1 THEN 20
                WHEN 2 THEN 45
                WHEN 3 THEN 30
                WHEN 4 THEN 5
                WHEN 5 THEN 0
                ELSE 0
            END;
        ELSIF p < 0.60 THEN
            RETURN CASE p_intensity
                WHEN 1 THEN 5
                WHEN 2 THEN 25
                WHEN 3 THEN 45
                WHEN 4 THEN 23
                WHEN 5 THEN 5
                ELSE 0
            END;
        ELSIF p < 0.80 THEN
            RETURN CASE p_intensity
                WHEN 1 THEN 0
                WHEN 2 THEN 10
                WHEN 3 THEN 35
                WHEN 4 THEN 45
                WHEN 5 THEN 20
                ELSE 0
            END;
        ELSE
            RETURN CASE p_intensity
                WHEN 1 THEN 0
                WHEN 2 THEN 5
                WHEN 3 THEN 25
                WHEN 4 THEN 50
                WHEN 5 THEN 30
                ELSE 0
            END;
        END IF;
    ELSE  -- unrestrained
        IF p < 0.20 THEN
            RETURN CASE p_intensity
                WHEN 1 THEN 35
                WHEN 2 THEN 45
                WHEN 3 THEN 20
                WHEN 4 THEN 0
                WHEN 5 THEN 0
                ELSE 0
            END;
        ELSIF p < 0.40 THEN
            RETURN CASE p_intensity
                WHEN 1 THEN 10
                WHEN 2 THEN 35
                WHEN 3 THEN 40
                WHEN 4 THEN 13
                WHEN 5 THEN 2
                ELSE 0
            END;
        ELSIF p < 0.60 THEN
            RETURN CASE p_intensity
                WHEN 1 THEN 2
                WHEN 2 THEN 15
                WHEN 3 THEN 38
                WHEN 4 THEN 35
                WHEN 5 THEN 20
                ELSE 0
            END;
        ELSIF p < 0.80 THEN
            RETURN CASE p_intensity
                WHEN 1 THEN 0
                WHEN 2 THEN 5
                WHEN 3 THEN 25
                WHEN 4 THEN 45
                WHEN 5 THEN 40
                ELSE 0
            END;
        ELSE
            RETURN CASE p_intensity
                WHEN 1 THEN 0
                WHEN 2 THEN 2
                WHEN 3 THEN 13
                WHEN 4 THEN 45
                WHEN 5 THEN 60
                ELSE 0
            END;
        END IF;
    END IF;
END;
$$;


ALTER FUNCTION "public"."protocol_profile_intensity_weight"("p_profile" "text", "p_card_type" "text", "p_intensity" integer, "p_turn_no" integer, "p_target_turns" integer) OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."protocol_profile_type_weight"("p_profile" "text", "p_card_type" "text", "p_turn_no" integer, "p_target_turns" integer) RETURNS numeric
    LANGUAGE "plpgsql" IMMUTABLE
    SET "search_path" TO ''
    AS $$
DECLARE
    p numeric;
    v_profile text;
BEGIN

    p :=
        public.protocol_progress(
            p_turn_no,
            p_target_turns
        );

    v_profile :=
        CASE
            WHEN p_profile = 'intense'
                THEN 'classic'
            ELSE coalesce(p_profile, 'classic')
        END;


    -- ========================================================
    -- CLASSIC / SPONTANE
    -- ========================================================

    IF v_profile = 'classic' THEN

        IF p < 0.20 THEN
            RETURN CASE p_card_type
                WHEN 'truth'  THEN 30
                WHEN 'action' THEN 55
                WHEN 'duel'   THEN 15
                WHEN 'scene'  THEN 0
                ELSE 0
            END;

        ELSIF p < 0.40 THEN
            RETURN CASE p_card_type
                WHEN 'truth'  THEN 22
                WHEN 'action' THEN 55
                WHEN 'duel'   THEN 15
                WHEN 'scene'  THEN 8
                ELSE 0
            END;

        ELSIF p < 0.60 THEN
            RETURN CASE p_card_type
                WHEN 'truth'  THEN 15
                WHEN 'action' THEN 55
                WHEN 'duel'   THEN 15
                WHEN 'scene'  THEN 15
                ELSE 0
            END;

        ELSIF p < 0.80 THEN
            RETURN CASE p_card_type
                WHEN 'truth'  THEN 10
                WHEN 'action' THEN 50
                WHEN 'duel'   THEN 15
                WHEN 'scene'  THEN 25
                ELSE 0
            END;

        ELSE
            RETURN CASE p_card_type
                WHEN 'truth'  THEN 5
                WHEN 'action' THEN 45
                WHEN 'duel'   THEN 15
                WHEN 'scene'  THEN 35
                ELSE 0
            END;
        END IF;


    -- ========================================================
    -- COMPLICE
    -- ========================================================

    ELSIF v_profile = 'complice' THEN

        IF p < 0.20 THEN
            RETURN CASE p_card_type
                WHEN 'truth'  THEN 45
                WHEN 'action' THEN 50
                WHEN 'duel'   THEN 5
                WHEN 'scene'  THEN 0
                ELSE 0
            END;

        ELSIF p < 0.40 THEN
            RETURN CASE p_card_type
                WHEN 'truth'  THEN 35
                WHEN 'action' THEN 50
                WHEN 'duel'   THEN 8
                WHEN 'scene'  THEN 7
                ELSE 0
            END;

        ELSIF p < 0.60 THEN
            RETURN CASE p_card_type
                WHEN 'truth'  THEN 28
                WHEN 'action' THEN 50
                WHEN 'duel'   THEN 8
                WHEN 'scene'  THEN 14
                ELSE 0
            END;

        ELSIF p < 0.80 THEN
            RETURN CASE p_card_type
                WHEN 'truth'  THEN 22
                WHEN 'action' THEN 48
                WHEN 'duel'   THEN 8
                WHEN 'scene'  THEN 22
                ELSE 0
            END;

        ELSE
            RETURN CASE p_card_type
                WHEN 'truth'  THEN 18
                WHEN 'action' THEN 45
                WHEN 'duel'   THEN 7
                WHEN 'scene'  THEN 30
                ELSE 0
            END;
        END IF;


    -- ========================================================
    -- SENSUEL
    -- ========================================================

    ELSIF v_profile = 'sensual' THEN

        IF p < 0.20 THEN
            RETURN CASE p_card_type
                WHEN 'truth'  THEN 25
                WHEN 'action' THEN 65
                WHEN 'duel'   THEN 10
                WHEN 'scene'  THEN 0
                ELSE 0
            END;

        ELSIF p < 0.40 THEN
            RETURN CASE p_card_type
                WHEN 'truth'  THEN 18
                WHEN 'action' THEN 62
                WHEN 'duel'   THEN 8
                WHEN 'scene'  THEN 12
                ELSE 0
            END;

        ELSIF p < 0.60 THEN
            RETURN CASE p_card_type
                WHEN 'truth'  THEN 12
                WHEN 'action' THEN 58
                WHEN 'duel'   THEN 8
                WHEN 'scene'  THEN 22
                ELSE 0
            END;

        ELSIF p < 0.80 THEN
            RETURN CASE p_card_type
                WHEN 'truth'  THEN 8
                WHEN 'action' THEN 52
                WHEN 'duel'   THEN 7
                WHEN 'scene'  THEN 33
                ELSE 0
            END;

        ELSE
            RETURN CASE p_card_type
                WHEN 'truth'  THEN 5
                WHEN 'action' THEN 45
                WHEN 'duel'   THEN 5
                WHEN 'scene'  THEN 45
                ELSE 0
            END;
        END IF;


    -- ========================================================
    -- PROVOCATEUR
    -- ========================================================

    ELSIF v_profile = 'provocative' THEN

        IF p < 0.20 THEN
            RETURN CASE p_card_type
                WHEN 'truth'  THEN 25
                WHEN 'action' THEN 55
                WHEN 'duel'   THEN 20
                WHEN 'scene'  THEN 0
                ELSE 0
            END;

        ELSIF p < 0.40 THEN
            RETURN CASE p_card_type
                WHEN 'truth'  THEN 18
                WHEN 'action' THEN 50
                WHEN 'duel'   THEN 24
                WHEN 'scene'  THEN 8
                ELSE 0
            END;

        ELSIF p < 0.60 THEN
            RETURN CASE p_card_type
                WHEN 'truth'  THEN 12
                WHEN 'action' THEN 46
                WHEN 'duel'   THEN 26
                WHEN 'scene'  THEN 16
                ELSE 0
            END;

        ELSIF p < 0.80 THEN
            RETURN CASE p_card_type
                WHEN 'truth'  THEN 8
                WHEN 'action' THEN 42
                WHEN 'duel'   THEN 27
                WHEN 'scene'  THEN 23
                ELSE 0
            END;

        ELSE
            RETURN CASE p_card_type
                WHEN 'truth'  THEN 5
                WHEN 'action' THEN 38
                WHEN 'duel'   THEN 27
                WHEN 'scene'  THEN 30
                ELSE 0
            END;
        END IF;


    -- ========================================================
    -- DEBRIDE
    -- ========================================================

    ELSE

        IF p < 0.20 THEN
            RETURN CASE p_card_type
                WHEN 'truth'  THEN 20
                WHEN 'action' THEN 65
                WHEN 'duel'   THEN 15
                WHEN 'scene'  THEN 0
                ELSE 0
            END;

        ELSIF p < 0.40 THEN
            RETURN CASE p_card_type
                WHEN 'truth'  THEN 12
                WHEN 'action' THEN 58
                WHEN 'duel'   THEN 16
                WHEN 'scene'  THEN 14
                ELSE 0
            END;

        ELSIF p < 0.60 THEN
            RETURN CASE p_card_type
                WHEN 'truth'  THEN 8
                WHEN 'action' THEN 50
                WHEN 'duel'   THEN 17
                WHEN 'scene'  THEN 25
                ELSE 0
            END;

        ELSIF p < 0.80 THEN
            RETURN CASE p_card_type
                WHEN 'truth'  THEN 5
                WHEN 'action' THEN 43
                WHEN 'duel'   THEN 17
                WHEN 'scene'  THEN 35
                ELSE 0
            END;

        ELSE
            RETURN CASE p_card_type
                WHEN 'truth'  THEN 3
                WHEN 'action' THEN 37
                WHEN 'duel'   THEN 15
                WHEN 'scene'  THEN 45
                ELSE 0
            END;
        END IF;

    END IF;

END;
$$;


ALTER FUNCTION "public"."protocol_profile_type_weight"("p_profile" "text", "p_card_type" "text", "p_turn_no" integer, "p_target_turns" integer) OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."protocol_progress"("p_turn_no" integer, "p_target_turns" integer) RETURNS numeric
    LANGUAGE "sql" IMMUTABLE
    SET "search_path" TO ''
    AS $$
    SELECT
        CASE
            WHEN coalesce(p_target_turns, 0) <= 1
                THEN 1.0::numeric

            ELSE
                greatest(
                    0.0::numeric,
                    least(
                        1.0::numeric,

                        (
                            (coalesce(p_turn_no, 1) - 1)::numeric
                            /
                            (p_target_turns - 1)::numeric
                        )
                    )
                )
        END;
$$;


ALTER FUNCTION "public"."protocol_progress"("p_turn_no" integer, "p_target_turns" integer) OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."protocol_recent_high_intensity_count_v2"("p_game_id" "uuid", "p_last_n" integer) RETURNS integer
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$

  select count(*)::integer

  from (

    select
      coalesce(
        oc.intensity,
        cc.intensity
      ) as intensity

    from public.game_card_history h

    left join public.protocol_cards oc
      on h.card_source = 'official'
     and oc.id = h.card_id

    left join public.protocol_custom_cards cc
      on h.card_source = 'custom'
     and cc.id = h.custom_card_id

    where h.game_id = p_game_id

      and coalesce(
        h.outcome,
        'pending'
      ) <> 'alternative'

    order by
      h.shown_at desc,
      h.id desc

    limit greatest(
      p_last_n,
      0
    )

  ) q

  where coalesce(
    q.intensity,
    1
  ) >= 4;

$$;


ALTER FUNCTION "public"."protocol_recent_high_intensity_count_v2"("p_game_id" "uuid", "p_last_n" integer) OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."protocol_recent_type_count_v2"("p_game_id" "uuid", "p_type" "text", "p_last_n" integer) RETURNS integer
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$

  select count(*)::integer

  from (

    select
      coalesce(
        oc.type,
        cc.type
      ) as type

    from public.game_card_history h

    left join public.protocol_cards oc
      on h.card_source = 'official'
     and oc.id = h.card_id

    left join public.protocol_custom_cards cc
      on h.card_source = 'custom'
     and cc.id = h.custom_card_id

    where h.game_id = p_game_id

      and coalesce(
        h.outcome,
        'pending'
      ) <> 'alternative'

    order by
      h.shown_at desc,
      h.id desc

    limit greatest(
      p_last_n,
      0
    )

  ) q

  where q.type = p_type;

$$;


ALTER FUNCTION "public"."protocol_recent_type_count_v2"("p_game_id" "uuid", "p_type" "text", "p_last_n" integer) OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."protocol_rule_card_allowed"("p_game_id" "uuid", "p_card_id" bigint, "p_next_player" integer, "p_next_turn" integer) RETURNS boolean
    LANGUAGE "plpgsql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
DECLARE
    v_rule public.protocol_card_rules%rowtype;

    v_partner integer;
    v_target_turns integer;
BEGIN

    SELECT *
    INTO v_rule
    FROM public.protocol_card_rules
    WHERE card_id = p_card_id
      AND active = true
    LIMIT 1;


    -- Carte sans règle persistante

    IF v_rule.id IS NULL THEN
        RETURN true;
    END IF;


    SELECT target_turns
    INTO v_target_turns
    FROM public.games
    WHERE id = p_game_id;

    IF v_target_turns IS NULL THEN
        RETURN false;
    END IF;


    -- Aucun nouveau persistent dans les 20 derniers %

    IF public.protocol_progress(
        p_next_turn,
        v_target_turns
    ) >= 0.80
    THEN
        RETURN false;
    END IF;


    v_partner :=
        CASE
            WHEN p_next_player = 1 THEN 2
            ELSE 1
        END;


    IF v_rule.target_mode = 'active' THEN

        IF public.protocol_player_rule_count(
            p_game_id,
            p_next_player
        ) >= 2
        THEN
            RETURN false;
        END IF;

        IF public.protocol_player_has_active_rule(
            p_game_id,
            p_next_player
        )
        THEN
            RETURN false;
        END IF;

        RETURN true;
    END IF;


    IF v_rule.target_mode = 'partner' THEN

        IF public.protocol_player_rule_count(
            p_game_id,
            v_partner
        ) >= 2
        THEN
            RETURN false;
        END IF;

        IF public.protocol_player_has_active_rule(
            p_game_id,
            v_partner
        )
        THEN
            RETURN false;
        END IF;

        RETURN true;
    END IF;


    IF v_rule.target_mode = 'both' THEN

        IF public.protocol_player_rule_count(
            p_game_id,
            1
        ) >= 2

        OR public.protocol_player_rule_count(
            p_game_id,
            2
        ) >= 2
        THEN
            RETURN false;
        END IF;


        IF public.protocol_player_has_active_rule(
            p_game_id,
            1
        )

        OR public.protocol_player_has_active_rule(
            p_game_id,
            2
        )
        THEN
            RETURN false;
        END IF;

        RETURN true;
    END IF;


    RETURN false;

END;
$$;


ALTER FUNCTION "public"."protocol_rule_card_allowed"("p_game_id" "uuid", "p_card_id" bigint, "p_next_player" integer, "p_next_turn" integer) OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."protocol_scene_allowed"("p_game_id" "uuid", "p_card_id" bigint, "p_next_turn" integer) RETURNS boolean
    LANGUAGE "plpgsql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
DECLARE
    v_type text;
    v_step_count integer;

    v_target_turns integer;

    v_scene_count integer;
    v_last_scene_turn integer;
BEGIN

    SELECT type
    INTO v_type
    FROM public.protocol_cards
    WHERE id = p_card_id;

    IF v_type IS DISTINCT FROM 'scene' THEN
        RETURN true;
    END IF;


    SELECT count(*)::integer
    INTO v_step_count
    FROM public.protocol_scene_steps
    WHERE card_id = p_card_id;

    IF v_step_count < 1 THEN
        RETURN false;
    END IF;


    SELECT target_turns
    INTO v_target_turns
    FROM public.games
    WHERE id = p_game_id;

    IF v_target_turns IS NULL THEN
        RETURN false;
    END IF;


    -- Pas de scène avant 20 % de la partie

    IF public.protocol_progress(
        p_next_turn,
        v_target_turns
    ) < 0.20
    THEN
        RETURN false;
    END IF;


    v_scene_count :=
        public.protocol_scene_count(
            p_game_id
        );

    IF v_scene_count >=
       public.protocol_scene_max_v2(
           v_target_turns
       )
    THEN
        RETURN false;
    END IF;


    v_last_scene_turn :=
        public.protocol_last_scene_turn(
            p_game_id
        );

    IF v_last_scene_turn IS NOT NULL
       AND
       p_next_turn - v_last_scene_turn <
       public.protocol_scene_spacing_v2(
           v_target_turns
       )
    THEN
        RETURN false;
    END IF;


    RETURN true;

END;
$$;


ALTER FUNCTION "public"."protocol_scene_allowed"("p_game_id" "uuid", "p_card_id" bigint, "p_next_turn" integer) OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."protocol_scene_count"("p_game_id" "uuid") RETURNS integer
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$

    SELECT count(*)::integer

    FROM public.game_card_history h

    JOIN public.protocol_cards c
      ON c.id = h.card_id

    WHERE h.game_id = p_game_id

      AND h.card_source = 'official'

      AND c.type = 'scene'

      AND h.outcome = 'done';

$$;


ALTER FUNCTION "public"."protocol_scene_count"("p_game_id" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."protocol_scene_max_v2"("p_target_turns" integer) RETURNS integer
    LANGUAGE "sql" IMMUTABLE
    SET "search_path" TO ''
    AS $$
    SELECT CASE
        WHEN p_target_turns <= 12 THEN 2
        WHEN p_target_turns <= 20 THEN 3
        ELSE 4
    END;
$$;


ALTER FUNCTION "public"."protocol_scene_max_v2"("p_target_turns" integer) OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."protocol_scene_spacing_v2"("p_target_turns" integer) RETURNS integer
    LANGUAGE "sql" IMMUTABLE
    SET "search_path" TO ''
    AS $$
    SELECT greatest(
        2,
        round(p_target_turns * 0.18)::integer
    );
$$;


ALTER FUNCTION "public"."protocol_scene_spacing_v2"("p_target_turns" integer) OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."protocol_scene_target_min_v2"("p_target_turns" integer) RETURNS integer
    LANGUAGE "sql" IMMUTABLE
    SET "search_path" TO ''
    AS $$
    SELECT CASE
        WHEN p_target_turns <= 20 THEN 1
        ELSE 2
    END;
$$;


ALTER FUNCTION "public"."protocol_scene_target_min_v2"("p_target_turns" integer) OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."protocol_select_card_v2_unified"("p_game_id" "uuid", "p_next_player" integer, "p_next_turn" integer, "p_forced_type" "text" DEFAULT NULL::"text") RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$

declare

    v_game public.games%rowtype;

    -- anti-répétition par famille
    v_family_window integer;
    v_recent_families text[];
    v_used_families text[];

    v_profile text;
    v_player_sex text;

    v_profile_intensity integer;
    v_max_intensity integer;

    v_current_type text;

    v_truth_last_2 integer;
    v_truth_last_7 integer;
    v_action_last_3 integer;

    v_last_duel_turn integer;

    v_last_intensity integer;
    v_high_last_2 integer;

    v_scene_count integer;
    v_scene_target_min integer;

    v_persistent_count integer;
    v_persistent_max integer;

    v_progress numeric;

    v_selected_type text;
    v_selected_intensity integer;

    v_selected_source text;
    v_source_id bigint;
    v_official_card_id bigint;
    v_custom_card_id bigint;
    v_timer_seconds integer;

begin

    -- ========================================================
    -- GAME
    -- ========================================================

    select *
    into v_game

    from public.games

    where id =
        p_game_id;


    if v_game.id is null then
        return null;
    end if;


    -- ========================================================
    -- PROFILE
    -- ========================================================

    v_profile :=
        public.protocol_effective_profile(
            v_game.director_mode,
            v_game.director_profile
        );


    v_player_sex :=
        case
            when p_next_player = 1
                then v_game.player_1_sex
            else
                v_game.player_2_sex
        end;


    v_profile_intensity :=
        greatest(
            1,
            least(
                5,
                coalesce(
                    (
                        v_game.shared_profile
                        ->> 'intensity'
                    )::integer,
                    1
                )
            )
        );


    -- ========================================================
    -- DYNAMIC MAX INTENSITY
    -- ========================================================

    v_max_intensity :=
        public.protocol_max_intensity(
            v_profile_intensity,
            p_next_turn
        );


    -- ========================================================
    -- CURRENT TYPE
    -- ========================================================

    if coalesce(
        v_game.current_card_source,
        'official'
    ) = 'custom'
    then

        select c.type
        into v_current_type

        from public.protocol_custom_cards c

        where c.id =
            v_game.current_custom_card_id

          and c.couple_id =
            v_game.couple_id;

    else

        select c.type
        into v_current_type

        from public.protocol_cards c

        where c.id =
            v_game.current_card_id;

    end if;


    -- ========================================================
    -- HISTORY STATS
    -- ========================================================

    v_truth_last_2 :=
        public.protocol_recent_type_count_v2(
            p_game_id,
            'truth',
            2
        );


    v_truth_last_7 :=
        public.protocol_recent_type_count_v2(
            p_game_id,
            'truth',
            7
        );


    v_action_last_3 :=
        public.protocol_recent_type_count_v2(
            p_game_id,
            'action',
            3
        );


    v_last_duel_turn :=
        public.protocol_last_type_turn(
            p_game_id,
            'duel'
        );


    v_last_intensity :=
        public.protocol_last_intensity_v2(
            p_game_id
        );


    v_high_last_2 :=
        public.protocol_recent_high_intensity_count_v2(
            p_game_id,
            2
        );


    v_scene_count :=
        public.protocol_scene_count(
            p_game_id
        );


    v_scene_target_min :=
        public.protocol_scene_target_min_v2(
            v_game.target_turns
        );


    v_persistent_count :=
        public.protocol_persistent_count(
            p_game_id
        );


    v_persistent_max :=
        public.protocol_persistent_max_v2(
            v_game.target_turns
        );


    v_progress :=
        public.protocol_progress(
            p_next_turn,
            v_game.target_turns
        );


    -- ========================================================
    -- FAMILLES DEJA JOUEES (anti-répétition)
    -- ========================================================

    v_family_window :=
        public.protocol_family_window(
            v_game.target_turns
        );

    select
        coalesce(
            array_agg(distinct c.family_key)
                filter (
                    where h.turn_no >
                        p_next_turn - v_family_window
                ),
            array[]::text[]
        ),
        coalesce(
            array_agg(distinct c.family_key),
            array[]::text[]
        )
    into
        v_recent_families,
        v_used_families
    from public.game_card_history h
    join public.protocol_cards c
      on c.id = h.card_id
    where h.game_id =
        p_game_id
      and h.card_source = 'official'
      and c.family_key is not null;


    -- ========================================================
    -- ETAPE 1 : TYPE
    -- ========================================================

    with candidates as (

        select c.*

        from public.protocol_playable_cards c

        where c.active = true

          and (
              (
                  c.card_source = 'official'
                  and c.library_version = 'v1'
              )
              or
              (
                  c.card_source = 'custom'
                  and c.couple_id = v_game.couple_id
              )
          )

          and (
              c.target_sex is null
              or c.target_sex = v_player_sex
          )

          and c.intensity <=
              v_max_intensity

          -- Lovense seulement pour les officielles
          and (
              c.card_source = 'custom'

              or public.protocol_lovense_card_allowed(
                  v_game.couple_id,
                  c.official_card_id
              )
          )

          and (
              p_forced_type is null
              or c.type = p_forced_type
          )

          -- Carte jamais utilisée dans cette partie
          and not exists (

              select 1

              from public.game_card_history h

              where h.game_id =
                  p_game_id

                and (
                    (
                        c.card_source = 'official'
                        and h.card_source = 'official'
                        and h.card_id =
                            c.official_card_id
                    )

                    or

                    (
                        c.card_source = 'custom'
                        and h.card_source = 'custom'
                        and h.custom_card_id =
                            c.custom_card_id
                    )
                )
          )

          -- Jamais 3 Truth consécutives
          -- Max 4 Truth parmi les 8 incluant candidate
          and not (
              c.type = 'truth'
              and (
                  v_truth_last_2 >= 2
                  or v_truth_last_7 >= 4
              )
          )

          -- Max 3 Actions consécutives
          and not (
              c.type = 'action'
              and v_action_last_3 >= 3
          )

          -- Duels
          and (
              c.type <> 'duel'

              or (
                  v_current_type is distinct from 'duel'

                  and (
                      v_last_duel_turn is null

                      or

                      p_next_turn
                      - v_last_duel_turn
                      >=
                      public.protocol_duel_spacing_v2(
                          v_game.target_turns
                      )
                  )
              )
          )

          -- Scènes seulement officielles
          and (
              c.card_source = 'custom'

              or public.protocol_scene_allowed(
                  p_game_id,
                  c.official_card_id,
                  p_next_turn
              )
          )

          -- Jamais deux I5 consécutives
          and not (
              c.intensity = 5
              and v_last_intensity = 5
          )
          -- Pas deux cartes de la même famille dans la fenêtre récente
          and (
              c.family_key is null
              or not (
                  c.family_key =
                      any (v_recent_families)
              )
          )

          -- Règles persistantes seulement officielles
          and (
              c.card_source = 'custom'

              or

              not exists (
                  select 1

                  from public.protocol_card_rules pr

                  where pr.card_id =
                      c.official_card_id

                    and pr.active = true
              )

              or

              (
                  v_persistent_count <
                      v_persistent_max

                  and public.protocol_rule_card_allowed(
                      p_game_id,
                      c.official_card_id,
                      p_next_player,
                      p_next_turn
                  )
              )
          )
    ),

    available_types as (

        select distinct
            c.type

        from candidates c
    ),

    weighted_types as (

        select
            t.type,

            (
                case

                    when p_forced_type is not null
                        then 100::numeric

                    else
                        public.protocol_profile_type_weight(
                            v_profile,
                            t.type,
                            p_next_turn,
                            v_game.target_turns
                        )

                end

                *

                case

                    when p_forced_type is not null
                        then 1.0

                    when t.type =
                        v_current_type
                        then 0.45

                    else 1.0

                end

                *

                power(
                    0.78::numeric,

                    public.protocol_recent_type_count_v2(
                        p_game_id,
                        t.type,
                        4
                    )
                )

                *

                case

                    when t.type <> 'scene'
                        then 1.0

                    when v_scene_count >=
                        v_scene_target_min
                    then

                        case

                            when v_scene_count =
                                v_scene_target_min
                                then 0.30

                            when v_scene_count =
                                v_scene_target_min + 1
                                then 0.10

                            else 0.03

                        end

                    when v_progress < 0.45
                        then 1.0

                    when v_progress < 0.65
                        then 2.0

                    when v_progress < 0.80
                        then 4.0

                    else 10.0

                end

            )::numeric as weight

        from available_types t
    )

    select type
    into v_selected_type

    from weighted_types

    where
        p_forced_type is not null
        or weight > 0

    order by

        case

            when weight > 0
            then
                -ln(
                    greatest(
                        random(),
                        0.000000000001
                    )
                )
                /
                weight::double precision

            else
                1000000000
                + random()

        end

    limit 1;


    if v_selected_type is null then
        return null;
    end if;


    -- ========================================================
    -- ETAPE 2 : INTENSITE
    -- ========================================================

    with candidates as (

        select c.*

        from public.protocol_playable_cards c

        where c.active = true

          and (
              (
                  c.card_source = 'official'
                  and c.library_version = 'v1'
              )
              or
              (
                  c.card_source = 'custom'
                  and c.couple_id =
                      v_game.couple_id
              )
          )

          and c.type =
              v_selected_type

          and (
              c.target_sex is null
              or c.target_sex =
                  v_player_sex
          )

          and c.intensity <=
              v_max_intensity

          and (
              c.card_source = 'custom'

              or public.protocol_lovense_card_allowed(
                  v_game.couple_id,
                  c.official_card_id
              )
          )

          and not exists (

              select 1

              from public.game_card_history h

              where h.game_id =
                  p_game_id

                and (
                    (
                        c.card_source = 'official'
                        and h.card_source = 'official'
                        and h.card_id =
                            c.official_card_id
                    )

                    or

                    (
                        c.card_source = 'custom'
                        and h.card_source = 'custom'
                        and h.custom_card_id =
                            c.custom_card_id
                    )
                )
          )

          and not (
              c.type = 'truth'

              and (
                  v_truth_last_2 >= 2
                  or v_truth_last_7 >= 4
              )
          )

          and not (
              c.type = 'action'
              and v_action_last_3 >= 3
          )

          and (
              c.type <> 'duel'

              or (
                  v_current_type is distinct from 'duel'

                  and (
                      v_last_duel_turn is null

                      or

                      p_next_turn
                      - v_last_duel_turn
                      >=
                      public.protocol_duel_spacing_v2(
                          v_game.target_turns
                      )
                  )
              )
          )

          and (
              c.card_source = 'custom'

              or public.protocol_scene_allowed(
                  p_game_id,
                  c.official_card_id,
                  p_next_turn
              )
          )

          and not (
              c.intensity = 5
              and v_last_intensity = 5
          )
          -- Pas deux cartes de la même famille dans la fenêtre récente
          and (
              c.family_key is null
              or not (
                  c.family_key =
                      any (v_recent_families)
              )
          )

          and (
              c.card_source = 'custom'

              or

              not exists (
                  select 1

                  from public.protocol_card_rules pr

                  where pr.card_id =
                      c.official_card_id

                    and pr.active = true
              )

              or

              (
                  v_persistent_count <
                      v_persistent_max

                  and public.protocol_rule_card_allowed(
                      p_game_id,
                      c.official_card_id,
                      p_next_player,
                      p_next_turn
                  )
              )
          )
    ),

    available_intensities as (

        select distinct
            c.intensity

        from candidates c
    ),

    weighted_intensities as (

        select
            i.intensity,

            (
                public.protocol_profile_intensity_weight(
                    v_profile,
                    v_selected_type,
                    i.intensity,
                    p_next_turn,
                    v_game.target_turns
                )

                *

                case

                    when
                        v_high_last_2 >= 2
                        and i.intensity >= 4
                    then 0.15

                    else 1.0

                end

            )::numeric as weight

        from available_intensities i
    )

    select intensity
    into v_selected_intensity

    from weighted_intensities

    order by

        case

            when weight > 0
            then
                -ln(
                    greatest(
                        random(),
                        0.000000000001
                    )
                )
                /
                weight::double precision

            else
                1000000000
                + random()

        end

    limit 1;


    if v_selected_intensity is null then
        return null;
    end if;


    -- ========================================================
    -- ETAPE 3 : CARTE CONCRETE
    -- ========================================================

    with candidates as (

        select

            c.card_source,
            c.source_id,
            c.official_card_id,
            c.custom_card_id,
            c.timer_seconds,

            case

                -- Custom = poids neutre.
                -- Aucun favoritisme artificiel.
                when c.card_source = 'custom'
                    then 1.0::numeric

                when not exists (
                    select 1

                    from public.protocol_card_rules pr

                    where pr.card_id =
                        c.official_card_id

                      and pr.active = true
                )
                then 1.0::numeric

                when v_profile = 'complice'
                    then 0.55::numeric

                when v_profile = 'unrestrained'
                    then 1.50::numeric

                when v_profile = 'provocative'
                    then 1.15::numeric

                else 1.0::numeric

            end
            *
            case
                when c.family_key is not null
                 and c.family_key = any (v_used_families)
                then public.protocol_family_reuse_weight()
                else 1.0::numeric
            end as card_weight

        from public.protocol_playable_cards c

        where c.active = true

          and (
              (
                  c.card_source = 'official'
                  and c.library_version = 'v1'
              )
              or
              (
                  c.card_source = 'custom'
                  and c.couple_id =
                      v_game.couple_id
              )
          )

          and c.type =
              v_selected_type

          and c.intensity =
              v_selected_intensity

          and (
              c.target_sex is null
              or c.target_sex =
                  v_player_sex
          )

          and c.intensity <=
              v_max_intensity

          and (
              c.card_source = 'custom'

              or public.protocol_lovense_card_allowed(
                  v_game.couple_id,
                  c.official_card_id
              )
          )

          and not exists (

              select 1

              from public.game_card_history h

              where h.game_id =
                  p_game_id

                and (
                    (
                        c.card_source = 'official'
                        and h.card_source = 'official'
                        and h.card_id =
                            c.official_card_id
                    )

                    or

                    (
                        c.card_source = 'custom'
                        and h.card_source = 'custom'
                        and h.custom_card_id =
                            c.custom_card_id
                    )
                )
          )

          and not (
              c.type = 'truth'

              and (
                  v_truth_last_2 >= 2
                  or v_truth_last_7 >= 4
              )
          )

          and not (
              c.type = 'action'
              and v_action_last_3 >= 3
          )

          and (
              c.type <> 'duel'

              or (
                  v_current_type is distinct from 'duel'

                  and (
                      v_last_duel_turn is null

                      or

                      p_next_turn
                      - v_last_duel_turn
                      >=
                      public.protocol_duel_spacing_v2(
                          v_game.target_turns
                      )
                  )
              )
          )

          and (
              c.card_source = 'custom'

              or public.protocol_scene_allowed(
                  p_game_id,
                  c.official_card_id,
                  p_next_turn
              )
          )

          and not (
              c.intensity = 5
              and v_last_intensity = 5
          )
          -- Pas deux cartes de la même famille dans la fenêtre récente
          and (
              c.family_key is null
              or not (
                  c.family_key =
                      any (v_recent_families)
              )
          )

          and (
              c.card_source = 'custom'

              or

              not exists (
                  select 1

                  from public.protocol_card_rules pr

                  where pr.card_id =
                      c.official_card_id

                    and pr.active = true
              )

              or

              (
                  v_persistent_count <
                      v_persistent_max

                  and public.protocol_rule_card_allowed(
                      p_game_id,
                      c.official_card_id,
                      p_next_player,
                      p_next_turn
                  )
              )
          )
    )

    select
        c.card_source,
        c.source_id,
        c.official_card_id,
        c.custom_card_id,
        c.timer_seconds

    into
        v_selected_source,
        v_source_id,
        v_official_card_id,
        v_custom_card_id,
        v_timer_seconds

    from candidates c

    order by

        -ln(
            greatest(
                random(),
                0.000000000001
            )
        )
        /
        c.card_weight::double precision

    limit 1;


    if v_source_id is null then
        return null;
    end if;


    -- ========================================================
    -- RESULT
    -- ========================================================

    return jsonb_build_object(

        'card_source',
            v_selected_source,

        'source_id',
            v_source_id,

        'official_card_id',
            v_official_card_id,

        'custom_card_id',
            v_custom_card_id,

        'type',
            v_selected_type,

        'intensity',
            v_selected_intensity,

        'timer_seconds',
            v_timer_seconds

    );

end;

$$;


ALTER FUNCTION "public"."protocol_select_card_v2_unified"("p_game_id" "uuid", "p_next_player" integer, "p_next_turn" integer, "p_forced_type" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."protocol_simulate_live"("p_profile" "text", "p_target_turns" integer, "p_calibration" integer, "p_first_sex" "text" DEFAULT 'female'::"text", "p_games" integer DEFAULT 100, "p_lovense" boolean DEFAULT false) RETURNS TABLE("profile" "text", "target_turns" integer, "calibration" integer, "first_sex" "text", "lovense" boolean, "games" integer, "avg_turns_played" numeric, "pool_exhausted_pct" numeric, "avg_truth" numeric, "avg_action" numeric, "avg_duel" numeric, "avg_scene" numeric, "duel_share_pct" numeric, "no_scene_pct" numeric, "avg_first_scene_turn" numeric, "with_rule_pct" numeric, "avg_i1" numeric, "avg_i2" numeric, "avg_i3" numeric, "avg_i4" numeric, "avg_i5" numeric, "avg_intensity" numeric, "family_repeats" numeric, "family_repeats_close" numeric)
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
declare
    v_user      uuid;
    v_couple    uuid;
    v_game      uuid;
    v_games     uuid[] := array[]::uuid[];
    v_pick      jsonb;
    v_card      record;
    v_rule      record;
    v_target    integer;
    v_player    integer;
    v_turn      integer;
    v_exhausted integer := 0;
    v_g         integer;
begin
    if p_profile not in ('classic', 'complice', 'sensual', 'provocative', 'unrestrained') then
        raise exception 'Profil invalide : %', p_profile;
    end if;
    if p_target_turns < 4 or p_target_turns > 60 then
        raise exception 'Nombre de tours invalide : %', p_target_turns;
    end if;
    if p_calibration not between 1 and 5 then
        raise exception 'Calibration invalide : %', p_calibration;
    end if;
    if p_first_sex not in ('female', 'male') then
        raise exception 'Sexe invalide : %', p_first_sex;
    end if;

    select id into v_user from auth.users order by created_at nulls last limit 1;
    if v_user is null then
        raise exception 'Aucun utilisateur trouvé pour rattacher le couple fantôme.';
    end if;

    -- couple fantôme : aucune carte custom, Lush connecté seulement si demandé
    insert into public.protocol_couples (created_by) values (v_user) returning id into v_couple;

    if p_lovense then
        insert into public.protocol_lovense_connections (lovense_uid, toys, user_id, couple_id, connected_at)
        values ('simulation', '[{"connected": true}]'::jsonb, v_user, v_couple, now());
    end if;

    for v_g in 1 .. p_games loop

        insert into public.games (
            code, player_count, status, couple_id, director_mode, director_profile,
            target_turns, player_1_sex, player_2_sex, player_1_name, player_2_name,
            shared_profile, turn_no, active_player
        )
        values (
            'SIM' || substr(md5(random()::text), 1, 8), 2, 'playing', v_couple, 'custom', p_profile,
            p_target_turns, p_first_sex,
            case when p_first_sex = 'female' then 'male' else 'female' end,
            'Joueur 1', 'Joueur 2',
            jsonb_build_object('intensity', p_calibration), 0, 1
        )
        returning id into v_game;

        v_games := array_append(v_games, v_game);
        v_player := 1;

        for v_turn in 1 .. p_target_turns loop

            v_pick := public.protocol_select_card_v2_unified(v_game, v_player, v_turn, null);

            if v_pick is null then
                v_exhausted := v_exhausted + 1;
                exit;
            end if;

            select c.id, c.type into v_card
            from public.protocol_cards c
            where c.id = (v_pick ->> 'official_card_id')::bigint;

            update public.games
            set current_card_source = 'official',
                current_card_id     = v_card.id,
                turn_no             = v_turn,
                active_player       = v_player
            where id = v_game;

            insert into public.game_card_history (game_id, card_source, card_id, turn_no, player_no, outcome, resolved_at)
            values (v_game, 'official', v_card.id, v_turn, v_player, 'done', now());

            -- même ordre que advance_protocol : tick, puis éventuelle nouvelle règle
            perform public.tick_game_rules(v_game);

            select * into v_rule
            from public.protocol_card_rules r
            where r.card_id = v_card.id and r.active = true
            limit 1;

            if v_rule.id is not null then
                v_target := case v_rule.target_mode
                                when 'active'  then v_player
                                when 'partner' then 3 - v_player
                                else null
                            end;
                if (v_target is not null
                        and public.protocol_player_rule_count(v_game, v_target) < 2
                        and not public.protocol_player_has_active_rule(v_game, v_target))
                   or
                   (v_target is null
                        and public.protocol_player_rule_count(v_game, 1) < 2
                        and public.protocol_player_rule_count(v_game, 2) < 2
                        and not public.protocol_player_has_active_rule(v_game, 1)
                        and not public.protocol_player_has_active_rule(v_game, 2))
                then
                    insert into public.game_active_rules (
                        game_id, source_card_id, rule_key, title, rule_text, target_player,
                        remaining_turns, active, created_turn, expires_at_turn)
                    values (
                        v_game, v_card.id, v_rule.rule_key, v_rule.title, v_rule.rule_text, v_target,
                        v_rule.duration_turns, true, v_turn, v_turn + v_rule.duration_turns)
                    on conflict do nothing;
                end if;
            end if;

            v_player := 3 - v_player;
        end loop;

        update public.games set status = 'finished', finished_at = now() where id = v_game;
    end loop;

    return query
    with h as (
        select h.game_id, h.turn_no, c.type, c.intensity, c.family_key
        from public.game_card_history h
        join public.protocol_cards c on c.id = h.card_id
        where h.game_id = any (v_games)
    ),
    fam as (
        select h.game_id, h.turn_no,
               lag(h.turn_no) over (partition by h.game_id, h.family_key order by h.turn_no) as prev_turn
        from h
        where h.family_key is not null
    ),
    per_game as (
        select g.gid,
               (select count(*) from h where h.game_id = g.gid)                             as n,
               (select count(*) from h where h.game_id = g.gid and h.type = 'truth')        as n_truth,
               (select count(*) from h where h.game_id = g.gid and h.type = 'action')       as n_action,
               (select count(*) from h where h.game_id = g.gid and h.type = 'duel')         as n_duel,
               (select count(*) from h where h.game_id = g.gid and h.type = 'scene')        as n_scene,
               (select min(h.turn_no) from h where h.game_id = g.gid and h.type = 'scene')  as first_scene,
               (select count(*) from h where h.game_id = g.gid and h.intensity = 1)         as i1,
               (select count(*) from h where h.game_id = g.gid and h.intensity = 2)         as i2,
               (select count(*) from h where h.game_id = g.gid and h.intensity = 3)         as i3,
               (select count(*) from h where h.game_id = g.gid and h.intensity = 4)         as i4,
               (select count(*) from h where h.game_id = g.gid and h.intensity = 5)         as i5,
               (select avg(h.intensity) from h where h.game_id = g.gid)                     as avg_int,
               (select count(*) from fam f where f.game_id = g.gid and f.prev_turn is not null)                   as rep,
               (select count(*) from fam f where f.game_id = g.gid and f.turn_no - f.prev_turn <= 6)              as rep_close,
               exists (select 1 from public.game_active_rules r where r.game_id = g.gid)    as had_rule
        from unnest(v_games) as g(gid)
    )
    select
        p_profile, p_target_turns, p_calibration, p_first_sex, p_lovense,
        p_games,
        round(avg(n), 2),
        round(100.0 * v_exhausted / p_games, 2),
        round(avg(n_truth), 2), round(avg(n_action), 2), round(avg(n_duel), 2), round(avg(n_scene), 2),
        round(100.0 * sum(n_duel) / nullif(sum(n), 0), 1),
        round(100.0 * count(*) filter (where n_scene = 0) / p_games, 2),
        round(avg(first_scene), 2),
        round(100.0 * count(*) filter (where had_rule) / p_games, 2),
        round(avg(i1), 2), round(avg(i2), 2), round(avg(i3), 2), round(avg(i4), 2), round(avg(i5), 2),
        round(avg(avg_int), 3),
        round(avg(rep), 2),
        round(avg(rep_close), 2)
    from per_game;

    -- nettoyage : supprime le couple fantôme et, en cascade, ses parties, historiques et règles
    delete from public.protocol_lovense_connections where couple_id = v_couple;
    delete from public.games where couple_id = v_couple;
    delete from public.protocol_couples where id = v_couple;
end;
$$;


ALTER FUNCTION "public"."protocol_simulate_live"("p_profile" "text", "p_target_turns" integer, "p_calibration" integer, "p_first_sex" "text", "p_games" integer, "p_lovense" boolean) OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."protocol_type_count"("p_game_id" "uuid", "p_type" "text") RETURNS integer
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$

  select count(*)::integer

  from public.game_card_history h

  left join public.protocol_cards oc
    on h.card_source = 'official'
   and oc.id = h.card_id

  left join public.protocol_custom_cards cc
    on h.card_source = 'custom'
   and cc.id = h.custom_card_id

  where h.game_id = p_game_id

    and coalesce(
      oc.type,
      cc.type
    ) = p_type

    and coalesce(
      h.outcome,
      'pending'
    ) <> 'alternative';

$$;


ALTER FUNCTION "public"."protocol_type_count"("p_game_id" "uuid", "p_type" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."register_push_subscription_secure"("p_device_id" "uuid", "p_endpoint" "text", "p_p256dh" "text", "p_auth" "text", "p_user_agent" "text" DEFAULT NULL::"text") RETURNS "void"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO ''
    AS $_$
declare
  v_user_id uuid;
  v_couple_id uuid;

  v_device_row_id bigint;
  v_endpoint_row_id bigint;
begin

  /* =========================================
     AUTH
     ========================================= */

  v_user_id :=
    auth.uid();

  if v_user_id is null then
    raise exception
      'Authentication required';
  end if;


  /* =========================================
     COUPLE
     ========================================= */

  select m.couple_id
  into v_couple_id
  from public.protocol_couple_members m
  where m.user_id =
    v_user_id;


  if v_couple_id is null then
    raise exception
      'User does not belong to a couple';
  end if;


  /* =========================================
     VALIDATION DEVICE
     ========================================= */

  if p_device_id is null then
    raise exception
      'device_id is required';
  end if;


  /* =========================================
     VALIDATION ENDPOINT
     ========================================= */

  p_endpoint :=
    trim(p_endpoint);


  if
    p_endpoint is null
    or p_endpoint = ''
    or length(p_endpoint) > 2048
  then
    raise exception
      'Invalid push endpoint';
  end if;


  /*
   * A20
   *
   * Les abonnements actuellement utilisés
   * par PROTOCOL sont des subscriptions
   * Apple Web Push.
   *
   * On exige :
   * - HTTPS
   * - host exact web.push.apple.com
   * - chemin non vide
   */

  if p_endpoint !~
    '^https://web[.]push[.]apple[.]com/[^[:space:]]+$'
  then
    raise exception
      'Push endpoint is not allowed';
  end if;


  /* =========================================
     VALIDATION KEYS
     ========================================= */

  p_p256dh :=
    trim(p_p256dh);

  p_auth :=
    trim(p_auth);


  if
    p_p256dh is null
    or length(p_p256dh)
      not between 16 and 512
    or p_p256dh !~
      '^[A-Za-z0-9_-]+=*$'
  then
    raise exception
      'Invalid p256dh key';
  end if;


  if
    p_auth is null
    or length(p_auth)
      not between 8 and 256
    or p_auth !~
      '^[A-Za-z0-9_-]+=*$'
  then
    raise exception
      'Invalid auth key';
  end if;


  /* =========================================
     OWNERSHIP CHECK — DEVICE ID
     ========================================= */

  select s.id
  into v_device_row_id
  from public.push_subscriptions s
  where s.device_id =
    p_device_id
  for update;


  if v_device_row_id is not null then

    if exists (
      select 1
      from public.push_subscriptions s
      where s.id =
        v_device_row_id
        and s.user_id
          is distinct from
          v_user_id
    )
    then
      raise exception
        'Push device belongs to another user';
    end if;

  end if;


  /* =========================================
     OWNERSHIP CHECK — ENDPOINT
     ========================================= */

  select s.id
  into v_endpoint_row_id
  from public.push_subscriptions s
  where s.endpoint =
    p_endpoint
  for update;


  if v_endpoint_row_id is not null then

    if exists (
      select 1
      from public.push_subscriptions s
      where s.id =
        v_endpoint_row_id
        and s.user_id
          is distinct from
          v_user_id
    )
    then
      raise exception
        'Push endpoint belongs to another user';
    end if;

  end if;


  /* =========================================
     SAME USER / SAME DEVICE
     ========================================= */

  if v_device_row_id is not null then

    /*
     * Si le même utilisateur possède déjà
     * l'endpoint dans une autre ligne,
     * on supprime ce doublon avant de mettre
     * à jour la ligne du device.
     */

    if
      v_endpoint_row_id is not null
      and
      v_endpoint_row_id <>
        v_device_row_id
    then

      delete
      from public.push_subscriptions
      where id =
        v_endpoint_row_id
        and user_id =
          v_user_id;

    end if;


    update public.push_subscriptions
    set
      user_id =
        v_user_id,

      couple_id =
        v_couple_id,

      endpoint =
        p_endpoint,

      p256dh =
        p_p256dh,

      auth =
        p_auth,

      user_agent =
        p_user_agent,

      active =
        true,

      updated_at =
        now(),

      last_seen_at =
        now()

    where id =
      v_device_row_id;


    return;

  end if;


  /* =========================================
     SAME USER / SAME ENDPOINT
     ========================================= */

  if v_endpoint_row_id is not null then

    update public.push_subscriptions
    set
      device_id =
        p_device_id,

      user_id =
        v_user_id,

      couple_id =
        v_couple_id,

      p256dh =
        p_p256dh,

      auth =
        p_auth,

      user_agent =
        p_user_agent,

      active =
        true,

      updated_at =
        now(),

      last_seen_at =
        now()

    where id =
      v_endpoint_row_id;


    return;

  end if;


  /* =========================================
     NEW SUBSCRIPTION
     ========================================= */

  insert into public.push_subscriptions (
    device_id,
    user_id,
    couple_id,
    endpoint,
    p256dh,
    auth,
    user_agent,
    active,
    updated_at,
    last_seen_at
  )
  values (
    p_device_id,
    v_user_id,
    v_couple_id,
    p_endpoint,
    p_p256dh,
    p_auth,
    p_user_agent,
    true,
    now(),
    now()
  );

end;
$_$;


ALTER FUNCTION "public"."register_push_subscription_secure"("p_device_id" "uuid", "p_endpoint" "text", "p_p256dh" "text", "p_auth" "text", "p_user_agent" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."rematch_protocol"("p_game_code" "text") RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
declare
  v_player_no integer;
  v_game public.games%rowtype;
begin
  v_player_no :=
    public.protocol_current_player_no(
      p_game_code
    );

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

  /*
   * Idempotence :
   * si l'autre téléphone a déjà lancé
   * la revanche, tout est déjà prêt.
   */
  if v_game.status = 'ready' then
    return jsonb_build_object(
      'ok',
      true,

      'code',
      v_game.code,

      'status',
      'ready',

      'already_ready',
      true
    );
  end if;

  if v_game.status <> 'finished' then
    raise exception
      'Game is not finished';
  end if;

  delete from public.game_card_history
  where game_id =
    v_game.id;

  delete from public.game_active_rules
  where game_id =
    v_game.id;

  delete from public.calibration_responses
  where game_id =
    v_game.id;

  update public.games
  set
    status =
      'ready',

    player_1_ready =
      false,

    player_2_ready =
      false,

    score_player_1 =
      0,

    score_player_2 =
      0,

    bonus_player_1 =
      '{}'::jsonb,

    bonus_player_2 =
      '{}'::jsonb,

    turn_no =
      0,

    active_player =
      1,

    current_card_id =
      null,

    shared_profile =
      null,

    phase =
      'warmup',

    finished_at =
      null,

    scene_step_no =
      null,

    scene_step_read_player_1 =
      false,

    scene_step_read_player_2 =
      false

  where id =
    v_game.id;

  return jsonb_build_object(
    'ok',
    true,

    'code',
    v_game.code,

    'status',
    'ready',

    'already_ready',
    false
  );
end;
$$;


ALTER FUNCTION "public"."rematch_protocol"("p_game_code" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."reset_protocol_timer_on_transition"() RETURNS "trigger"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
begin

  /*
   * Une nouvelle carte ne doit jamais hériter
   * du timer de la carte précédente.
   */
  if new.current_card_id is distinct from old.current_card_id then

    new.timer_card_id :=
      null;

    new.timer_started_at :=
      null;

    new.timer_remaining_seconds :=
      null;

    new.timer_running :=
      false;

  end if;


  /*
   * Une partie terminée ne conserve aucun
   * timer résiduel.
   */
  if
    new.status = 'finished'
    and old.status is distinct from 'finished'
  then

    new.timer_card_id :=
      null;

    new.timer_started_at :=
      null;

    new.timer_remaining_seconds :=
      null;

    new.timer_running :=
      false;

  end if;


  return new;

end;
$$;


ALTER FUNCTION "public"."reset_protocol_timer_on_transition"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."resume_protocol_game"("p_game_code" "text") RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
declare
  v_player_no integer;
  v_game public.games%rowtype;
  v_restart_timer boolean;
begin

  /*
   * Vérifie que l'appelant appartient
   * toujours bien à cette partie.
   */
  v_player_no :=
    public.protocol_current_player_no(
      p_game_code
    );

  select *
  into v_game
  from public.games
  where code = upper(trim(p_game_code))
  for update;

  if v_game.id is null then
    raise exception 'Game not found';
  end if;

  if v_game.status = 'playing' then
    return jsonb_build_object(
      'success', true,
      'status', 'playing',
      'already_playing', true
    );
  end if;

  if v_game.status <> 'paused' then
    raise exception 'Game is not paused';
  end if;


  /*
   * On ne relance le timer que s'il existait
   * réellement un timer pour la carte courante
   * et qu'il lui reste du temps.
   */
  v_restart_timer :=
    v_game.timer_card_id is not null
    and
    v_game.timer_card_id =
      v_game.current_card_id
    and
    v_game.timer_remaining_seconds
      is not null
    and
    v_game.timer_remaining_seconds > 0;


  update public.games
  set
    status = 'playing',

    timer_running =
      v_restart_timer,

    timer_started_at =
      case
        when v_restart_timer
          then now()
        else null
      end

  where id = v_game.id;


  return jsonb_build_object(
    'success', true,
    'status', 'playing',
    'resumed_by', v_player_no,
    'timer_running',
      v_restart_timer,
    'timer_remaining_seconds',
      v_game.timer_remaining_seconds
  );

end;
$$;


ALTER FUNCTION "public"."resume_protocol_game"("p_game_code" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."save_protocol_identity"("p_game_code" "text") RETURNS boolean
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
declare
  v_user_id uuid;
  v_player_no integer;
  v_display_name text;
  v_sex text;
begin
  v_user_id := auth.uid();

  if v_user_id is null then
    raise exception 'Authentication required';
  end if;

  v_player_no :=
    public.protocol_current_player_no(p_game_code);

  select
    p.display_name,
    p.sex
  into
    v_display_name,
    v_sex
  from public.protocol_profiles p
  where p.user_id = v_user_id;

  if v_display_name is null
     or trim(v_display_name) = '' then
    raise exception 'Profile name not found';
  end if;

  if v_sex not in ('male', 'female') then
    raise exception 'Invalid profile sex';
  end if;

  if v_player_no = 1 then

    update public.games
    set
      player_1_name = trim(v_display_name),
      player_1_sex = v_sex
    where code = upper(trim(p_game_code));

  elsif v_player_no = 2 then

    update public.games
    set
      player_2_name = trim(v_display_name),
      player_2_sex = v_sex
    where code = upper(trim(p_game_code));

  else
    raise exception 'Invalid player number';
  end if;

  if not found then
    raise exception 'Game not found';
  end if;

  return true;
end;
$$;


ALTER FUNCTION "public"."save_protocol_identity"("p_game_code" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."set_protocol_couple_settings"("p_director_mode" "text", "p_director_profile" "text", "p_director_duration" "text") RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
declare
  v_user_id uuid;
  v_couple_id uuid;

  v_mode text;
  v_profile text;
  v_duration text;
begin

  v_user_id :=
    auth.uid();

  if v_user_id is null then
    raise exception
      'Authentication required';
  end if;


  select m.couple_id
  into v_couple_id
  from public.protocol_couple_members m
  where m.user_id =
    v_user_id
  limit 1;


  if v_couple_id is null then
    raise exception
      'User does not belong to a couple';
  end if;


  /* =========================================
     NORMALISATION
     ========================================= */

  v_mode :=
    lower(
      trim(
        coalesce(
          p_director_mode,
          ''
        )
      )
    );


  v_profile :=
    nullif(
      lower(
        trim(
          coalesce(
            p_director_profile,
            ''
          )
        )
      ),
      ''
    );


  v_duration :=
    lower(
      trim(
        coalesce(
          p_director_duration,
          ''
        )
      )
    );


  /* =========================================
     VALIDATION MODE
     ========================================= */

  if v_mode not in (
    'classic',
    'custom'
  )
  then
    raise exception
      'Invalid director mode';
  end if;


  /* =========================================
     VALIDATION DURATION
     ========================================= */

  if v_duration not in (
    'short',
    'normal',
    'long'
  )
  then
    raise exception
      'Invalid director duration';
  end if;


  /* =========================================
     VALIDATION PROFILE
     ========================================= */

  if v_mode = 'classic' then

    v_profile :=
      null;

  else

    if v_profile not in (
      'classic',
      'complice',
      'sensual',
      'provocative',
      'unrestrained'
    )
    then
      raise exception
        'Invalid director profile';
    end if;

  end if;


  /* =========================================
     UPSERT
     ========================================= */

  insert into public.protocol_couple_settings (
    couple_id,
    director_mode,
    director_profile,
    director_duration,
    updated_by,
    updated_at
  )
  values (
    v_couple_id,
    v_mode,
    v_profile,
    v_duration,
    v_user_id,
    now()
  )

  on conflict (
    couple_id
  )
  do update
  set
    director_mode =
      excluded.director_mode,

    director_profile =
      excluded.director_profile,

    director_duration =
      excluded.director_duration,

    updated_by =
      excluded.updated_by,

    updated_at =
      now();


  return jsonb_build_object(
    'success',
    true,

    'director_mode',
    v_mode,

    'director_profile',
    v_profile,

    'director_duration',
    v_duration
  );

end;
$$;


ALTER FUNCTION "public"."set_protocol_couple_settings"("p_director_mode" "text", "p_director_profile" "text", "p_director_duration" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."set_protocol_custom_card_updated_at"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    AS $$
BEGIN
    NEW.updated_at = now();
    RETURN NEW;
END;
$$;


ALTER FUNCTION "public"."set_protocol_custom_card_updated_at"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."set_protocol_ready"("p_game_code" "text") RETURNS boolean
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
declare
  v_player_no integer;
  v_game_id uuid;
begin
  v_player_no :=
    public.protocol_current_player_no(p_game_code);

  select g.id
  into v_game_id
  from public.games g
  where g.code = upper(trim(p_game_code))
  for update;

  if v_game_id is null then
    raise exception 'Game not found';
  end if;

  if v_player_no = 1 then

    update public.games
    set player_1_ready = true
    where id = v_game_id;

  elsif v_player_no = 2 then

    update public.games
    set player_2_ready = true
    where id = v_game_id;

  else
    raise exception 'Invalid player number';
  end if;

  update public.games
  set status = 'calibrating'
  where id = v_game_id
    and player_1_ready = true
    and player_2_ready = true
    and status in ('ready', 'waiting');

  return true;
end;
$$;


ALTER FUNCTION "public"."set_protocol_ready"("p_game_code" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."start_protocol"("p_game_code" "text") RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO ''
    AS $$

declare

  v_player_no integer;

  v_game
    public.games%rowtype;

  v_pick jsonb;

  v_card_source text;

  v_source_id bigint;

  v_official_card_id bigint;

  v_custom_card_id bigint;

  v_card_type text;

  v_first_player integer;

  v_max_intensity integer;

  v_phase text;

begin

  -- ========================================================
  -- AUTH
  -- ========================================================

  v_player_no :=
    public.protocol_current_player_no(
      p_game_code
    );


  -- ========================================================
  -- GAME LOCK
  -- ========================================================

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


  if v_game.status <>
    'calibration_ready'
  then
    raise exception
      'Game is not ready to start';
  end if;


  if v_game.shared_profile is null then
    raise exception
      'Shared profile not found';
  end if;


  -- ========================================================
  -- NETTOYAGE HISTORIQUE
  --
  -- Important avant la sélection :
  -- les règles de sélection ne doivent pas voir
  -- l'historique d'une éventuelle partie précédente.
  -- ========================================================

  delete from public.game_card_history
  where game_id =
    v_game.id;


  -- ========================================================
  -- PICK FIRST CARD
  -- official + custom
  -- ========================================================

  v_pick :=
    public.protocol_pick_start_card(
      p_game_code
    );


  if v_pick is null then
    raise exception
      'No compatible card found';
  end if;


  v_card_source :=
    v_pick
    ->> 'card_source';


  v_source_id :=
    (
      v_pick
      ->> 'source_id'
    )::bigint;


  v_official_card_id :=
    nullif(
      v_pick
      ->> 'official_card_id',
      ''
    )::bigint;


  v_custom_card_id :=
    nullif(
      v_pick
      ->> 'custom_card_id',
      ''
    )::bigint;


  v_card_type :=
    v_pick
    ->> 'type';


  v_first_player :=
    (
      v_pick
      ->> 'first_player'
    )::integer;


  v_max_intensity :=
    (
      v_pick
      ->> 'max_intensity'
    )::integer;


  v_phase :=
    public.protocol_phase(
      1,
      v_game.target_turns
    );


  -- ========================================================
  -- VALIDATION SOURCE
  -- ========================================================

  if
    v_card_source not in (
      'official',
      'custom'
    )
  then
    raise exception
      'Invalid card source';
  end if;


  if
    v_card_source = 'official'
    and v_official_card_id is null
  then
    raise exception
      'Official card id missing';
  end if;


  if
    v_card_source = 'custom'
    and v_custom_card_id is null
  then
    raise exception
      'Custom card id missing';
  end if;


  -- ========================================================
  -- START GAME
  -- ========================================================

  update public.games

  set
    status =
      'playing',

    turn_no =
      1,

    active_player =
      v_first_player,

    current_card_source =
      v_card_source,

    current_card_id =
      case

        when v_card_source =
          'official'

        then
          v_official_card_id

        else
          null

      end,

    current_custom_card_id =
      case

        when v_card_source =
          'custom'

        then
          v_custom_card_id

        else
          null

      end,

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

        when
          v_card_source =
            'official'

          and v_card_type =
            'scene'

        then
          1

        else
          null

      end,

    scene_step_read_player_1 =
      false,

    scene_step_read_player_2 =
      false

  where id =
    v_game.id;


  -- ========================================================
  -- HISTORY
  -- ========================================================

  insert into public.game_card_history (
    game_id,
    card_source,
    card_id,
    custom_card_id,
    turn_no,
    player_no
  )
  values (
    v_game.id,

    v_card_source,

    case
      when v_card_source =
        'official'
      then
        v_official_card_id
      else
        null
    end,

    case
      when v_card_source =
        'custom'
      then
        v_custom_card_id
      else
        null
    end,

    1,

    v_first_player
  );


  -- ========================================================
  -- RETURN
  -- ========================================================

  return jsonb_build_object(

    'started',
      true,

    'card_source',
      v_card_source,

    'card_id',
      v_source_id,

    'official_card_id',
      v_official_card_id,

    'custom_card_id',
      v_custom_card_id,

    'card_type',
      v_card_type,

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

        when
          v_card_source =
            'official'

          and v_card_type =
            'scene'

        then
          1

        else
          null

      end
  );

end;

$$;


ALTER FUNCTION "public"."start_protocol"("p_game_code" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."stop_protocol_game"("p_game_code" "text") RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
declare
  v_player_no integer;
  v_game public.games%rowtype;
  v_remaining integer;
begin

  /*
   * Vérifie que l'appelant appartient bien
   * à cette partie.
   */
  v_player_no :=
    public.protocol_current_player_no(
      p_game_code
    );

  select *
  into v_game
  from public.games
  where code = upper(trim(p_game_code))
  for update;

  if v_game.id is null then
    raise exception 'Game not found';
  end if;

  if v_game.status = 'paused' then
    return jsonb_build_object(
      'success', true,
      'status', 'paused',
      'already_paused', true
    );
  end if;

  if v_game.status <> 'playing' then
    raise exception 'Game is not playing';
  end if;


  /*
   * Si un timer tourne, on calcule le temps
   * réellement restant AVANT de le figer.
   */
  if
    v_game.timer_running = true
    and
    v_game.timer_started_at is not null
    and
    v_game.timer_remaining_seconds is not null
  then

    v_remaining :=
      greatest(
        0,
        v_game.timer_remaining_seconds
        -
        floor(
          extract(
            epoch from (
              now()
              -
              v_game.timer_started_at
            )
          )
        )::integer
      );

  else

    v_remaining :=
      v_game.timer_remaining_seconds;

  end if;


  /*
   * Pause globale.
   *
   * On conserve :
   * - la carte
   * - le tour
   * - le joueur actif
   * - la scène
   * - les scores
   *
   * Seuls le statut et le timer changent.
   */
  update public.games
  set
    status = 'paused',

    timer_running = false,

    timer_remaining_seconds =
      v_remaining,

    timer_started_at = null

  where id = v_game.id;


  return jsonb_build_object(
    'success', true,
    'status', 'paused',
    'paused_by', v_player_no,
    'timer_remaining_seconds',
      v_remaining
  );

end;
$$;


ALTER FUNCTION "public"."stop_protocol_game"("p_game_code" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."submit_calibration"("p_game_code" "text", "p_intensity" integer, "p_answers" "jsonb") RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO ''
    AS $$

DECLARE

    v_player_no integer;
    v_game_id uuid;
    v_count integer;

    v_p1 record;
    v_p2 record;

    v_shared jsonb;

BEGIN

    -- ========================================================
    -- AUTH
    -- ========================================================

    v_player_no :=
        public.protocol_current_player_no(
            p_game_code
        );


    -- ========================================================
    -- VALIDATION
    -- ========================================================

    IF
        p_intensity IS NULL
        OR p_intensity < 1
        OR p_intensity > 5
    THEN
        RAISE EXCEPTION
            'Invalid intensity';
    END IF;


    /*
     * On conserve p_answers dans la signature
     * pour compatibilité frontend.
     *
     * Le nouveau frontend enverra simplement {}.
     */

    IF
        p_answers IS NULL
        OR jsonb_typeof(p_answers) <> 'object'
    THEN
        RAISE EXCEPTION
            'Invalid calibration answers';
    END IF;


    -- ========================================================
    -- GAME
    -- ========================================================

    SELECT g.id
    INTO v_game_id

    FROM public.games g

    WHERE g.code =
        upper(trim(p_game_code))

    FOR UPDATE;


    IF v_game_id IS NULL THEN
        RAISE EXCEPTION
            'Game not found';
    END IF;


    IF NOT EXISTS (

        SELECT 1

        FROM public.games g

        WHERE g.id = v_game_id

          AND g.status IN (
              'calibrating',
              'calibration_ready'
          )

    )
    THEN
        RAISE EXCEPTION
            'Game is not in calibration';
    END IF;


    -- ========================================================
    -- REPONSE DU JOUEUR
    -- ========================================================

    INSERT INTO public.calibration_responses (
        game_id,
        player_no,
        intensity,
        answers
    )

    VALUES (
        v_game_id,
        v_player_no,
        p_intensity,
        '{}'::jsonb
    )

    ON CONFLICT (
        game_id,
        player_no
    )

    DO UPDATE SET

        intensity =
            excluded.intensity,

        answers =
            '{}'::jsonb,

        submitted_at =
            now();


    -- ========================================================
    -- ATTENDRE LES DEUX JOUEURS
    -- ========================================================

    SELECT count(*)
    INTO v_count

    FROM public.calibration_responses

    WHERE game_id =
        v_game_id;


    IF v_count < 2 THEN

        RETURN jsonb_build_object(
            'ready',
            false
        );

    END IF;


    -- ========================================================
    -- REPONSES
    -- ========================================================

    SELECT *
    INTO v_p1

    FROM public.calibration_responses

    WHERE game_id = v_game_id
      AND player_no = 1;


    SELECT *
    INTO v_p2

    FROM public.calibration_responses

    WHERE game_id = v_game_id
      AND player_no = 2;


    -- ========================================================
    -- PROFIL COMMUN
    --
    -- Seule donnée de calibration conservée :
    -- INTENSITY
    --
    -- Principe de sécurité :
    -- la plus faible intensité choisie des deux.
    -- ========================================================

    v_shared :=
        jsonb_build_object(

            'intensity',

            least(
                v_p1.intensity,
                v_p2.intensity
            )

        );


    -- ========================================================
    -- GAME READY
    -- ========================================================

    UPDATE public.games

    SET
        shared_profile =
            v_shared,

        status =
            'calibration_ready'

    WHERE id =
        v_game_id;


    RETURN jsonb_build_object(

        'ready',
        true,

        'shared_profile',
        v_shared

    );

END;

$$;


ALTER FUNCTION "public"."submit_calibration"("p_game_code" "text", "p_intensity" integer, "p_answers" "jsonb") OWNER TO "postgres";


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


CREATE OR REPLACE FUNCTION "public"."update_protocol_timer"("p_game_code" "text", "p_card_id" bigint, "p_started_at" timestamp with time zone, "p_remaining_seconds" integer, "p_running" boolean) RETURNS boolean
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO ''
    AS $$

declare

  v_game
    public.games%rowtype;

  v_card_source text;

begin

  perform public.protocol_current_player_no(
    p_game_code
  );


  if
    p_remaining_seconds is null
    or p_remaining_seconds < 0
    or p_remaining_seconds > 86400
  then
    raise exception
      'Durée du timer invalide.';
  end if;


  if p_running is null then
    raise exception
      'État du timer invalide.';
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


  v_card_source :=
    coalesce(
      v_game.current_card_source,
      'official'
    );


  -- ========================================================
  -- MATCH CURRENT CARD
  -- ========================================================

  if
    p_card_id is null

    or

    (
      v_card_source = 'official'

      and p_card_id is distinct from
        v_game.current_card_id
    )

    or

    (
      v_card_source = 'custom'

      and p_card_id is distinct from
        v_game.current_custom_card_id
    )

  then
    raise exception
      'Timer card does not match current card';
  end if;


  -- ========================================================
  -- VALID TIMER CARD
  -- ========================================================

  if v_card_source = 'official' then

    if not exists (
      select 1

      from public.protocol_cards c

      where c.id =
        p_card_id

        and c.active =
          true

        and c.library_version =
          'v1'

        and coalesce(
          c.timer_seconds,
          0
        ) > 0
    )
    then
      raise exception
        'Carte timer invalide.';
    end if;


  elsif v_card_source = 'custom' then

    if not exists (
      select 1

      from public.protocol_custom_cards c

      where c.id =
        p_card_id

        and c.couple_id =
          v_game.couple_id

        and c.active =
          true

        and c.deleted_at is null

        and coalesce(
          c.timer_seconds,
          0
        ) > 0
    )
    then
      raise exception
        'Carte timer invalide.';
    end if;


  else

    raise exception
      'Invalid card source';

  end if;


  -- ========================================================
  -- UPDATE TIMER STATE
  -- ========================================================

  update public.games

  set
    timer_card_source =
      v_card_source,

    timer_card_id =
      case
        when v_card_source = 'official'
          then p_card_id
        else null
      end,

    timer_custom_card_id =
      case
        when v_card_source = 'custom'
          then p_card_id
        else null
      end,

    timer_started_at =
      case
        when p_running
          then now()
        else null
      end,

    timer_remaining_seconds =
      p_remaining_seconds,

    timer_running =
      p_running

  where id =
    v_game.id;


  return true;

end;

$$;


ALTER FUNCTION "public"."update_protocol_timer"("p_game_code" "text", "p_card_id" bigint, "p_started_at" timestamp with time zone, "p_remaining_seconds" integer, "p_running" boolean) OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."use_choose_type"("p_game_code" "text", "p_card_type" "text") RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO ''
    AS $$

declare
  v_player_no integer;
  v_game public.games%rowtype;
  v_bonus jsonb;

begin

  v_player_no :=
    public.protocol_current_player_no(
      p_game_code
    );


  /* =======================================================
     TYPE DEMANDÉ

     "auto" = annuler le type imposé et rendre
     le bonus disponible sans rembourser les points.
     ======================================================= */

  if
    p_card_type is null
    or
    p_card_type not in (
      'truth',
      'action',
      'duel',
      'scene',
      'auto'
    )
  then

    raise exception
      'Invalid card type';

  end if;


  /* =======================================================
     GAME
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


  if v_game.active_player <> v_player_no then

    raise exception
      'Only active player can choose next type';

  end if;


  /* =======================================================
     BONUS DU JOUEUR
     ======================================================= */

  v_bonus :=
    case

      when v_player_no = 1
        then coalesce(
          v_game.bonus_player_1,
          '{}'::jsonb
        )

      else coalesce(
        v_game.bonus_player_2,
        '{}'::jsonb
      )

    end;


  /*
   * Autorisé si :
   * - le bonus vient d'être acheté
   * OU
   * - un type est déjà armé.
   *
   * Le second cas permet de changer de type
   * après un choix impossible.
   */
  if not (
    coalesce(
      (
        v_bonus
        ->> 'choose_type'
      )::boolean,
      false
    )

    or

    v_bonus
      ? 'choose_type_armed'
  )
  then

    raise exception
      'Bonus not owned';

  end if;


  /* =======================================================
     ANNULATION DU TYPE IMPOSÉ

     On ne rembourse pas les 2 points.
     On remet simplement le bonus acheté en état "disponible".
     ======================================================= */

  if p_card_type = 'auto' then

    if v_player_no = 1 then

      update public.games
      set
        bonus_player_1 =
          (
            coalesce(
              bonus_player_1,
              '{}'::jsonb
            )
            - 'choose_type_armed'
          )
          ||
          jsonb_build_object(
            'choose_type',
            true
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
            - 'choose_type_armed'
          )
          ||
          jsonb_build_object(
            'choose_type',
            true
          )

      where id =
        v_game.id;

    end if;


    return jsonb_build_object(
      'ok',
      true,

      'type',
      null,

      'cancelled',
      true
    );

  end if;


  /* =======================================================
     ARMEMENT / CHANGEMENT DU TYPE

     Si le bonus était disponible :
       choose_type disparaît.

     Si un type était déjà armé :
       il est simplement remplacé.

     Aucun nouveau coût.
     ======================================================= */

  if v_player_no = 1 then

    update public.games
    set
      bonus_player_1 =
        (
          (
            coalesce(
              bonus_player_1,
              '{}'::jsonb
            )
            - 'choose_type'
          )
          - 'choose_type_armed'
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
          (
            coalesce(
              bonus_player_2,
              '{}'::jsonb
            )
            - 'choose_type'
          )
          - 'choose_type_armed'
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
    p_card_type,

    'cancelled',
    false
  );

end;

$$;


ALTER FUNCTION "public"."use_choose_type"("p_game_code" "text", "p_card_type" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."use_choose_type_guarded"("p_game_code" "text", "p_card_type" "text", "p_expected_turn_no" integer, "p_expected_card_id" bigint, "p_expected_card_source" "text") RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO ''
    AS $$

declare

  v_game
    public.games%rowtype;

  v_result jsonb;

  v_current_card_source text;

  v_current_card_id bigint;

begin

  perform public.protocol_current_player_no(
    p_game_code
  );


  if
    p_expected_turn_no is null
    or p_expected_card_id is null
    or p_expected_card_source is null
    or p_expected_card_source not in (
      'official',
      'custom'
    )
  then

    raise exception
      'Expected game state is required';

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


  v_current_card_source :=
    coalesce(
      v_game.current_card_source,
      'official'
    );


  v_current_card_id :=
    case

      when v_current_card_source =
        'custom'

      then
        v_game.current_custom_card_id

      else
        v_game.current_card_id

    end;


  if
    v_game.turn_no is distinct from
      p_expected_turn_no

    or

    v_current_card_source is distinct from
      p_expected_card_source

    or

    v_current_card_id is distinct from
      p_expected_card_id

  then

    return jsonb_build_object(
      'stale',
      true,

      'reason',
      'game_state_changed'
    );

  end if;


  v_result :=
    public.use_choose_type(
      p_game_code,
      p_card_type
    );


  return
    coalesce(
      v_result,
      '{}'::jsonb
    )
    ||
    jsonb_build_object(
      'stale',
      false
    );

end;

$$;


ALTER FUNCTION "public"."use_choose_type_guarded"("p_game_code" "text", "p_card_type" "text", "p_expected_turn_no" integer, "p_expected_card_id" bigint, "p_expected_card_source" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."use_take_control"("p_game_code" "text") RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
declare
  v_player_no integer;
  v_game public.games%rowtype;
  v_bonus jsonb;
begin
  v_player_no :=
    public.protocol_current_player_no(
      p_game_code
    );

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

  v_bonus :=
    case
      when v_player_no = 1
        then coalesce(
          v_game.bonus_player_1,
          '{}'::jsonb
        )

      else coalesce(
        v_game.bonus_player_2,
        '{}'::jsonb
      )
    end;

  if not coalesce(
    (
      v_bonus
      ->> 'take_control'
    )::boolean,
    false
  ) then
    raise exception
      'Bonus not owned';
  end if;

  if v_player_no = 1 then

    update public.games
    set
      bonus_player_1 =
        (
          coalesce(
            bonus_player_1,
            '{}'::jsonb
          )
          - 'take_control'
        )
        ||
        jsonb_build_object(
          'take_control_armed',
          true
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
          - 'take_control'
        )
        ||
        jsonb_build_object(
          'take_control_armed',
          true
        )

    where id =
      v_game.id;

  end if;

  return jsonb_build_object(
    'ok',
    true
  );
end;
$$;


ALTER FUNCTION "public"."use_take_control"("p_game_code" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."use_take_control_guarded"("p_game_code" "text", "p_expected_turn_no" integer, "p_expected_card_id" bigint, "p_expected_card_source" "text") RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO ''
    AS $$

declare

  v_game
    public.games%rowtype;

  v_result jsonb;

  v_current_card_source text;

  v_current_card_id bigint;

begin

  perform public.protocol_current_player_no(
    p_game_code
  );


  if
    p_expected_turn_no is null
    or p_expected_card_id is null
    or p_expected_card_source is null
    or p_expected_card_source not in (
      'official',
      'custom'
    )
  then

    raise exception
      'Expected game state is required';

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


  v_current_card_source :=
    coalesce(
      v_game.current_card_source,
      'official'
    );


  v_current_card_id :=
    case

      when v_current_card_source =
        'custom'

      then
        v_game.current_custom_card_id

      else
        v_game.current_card_id

    end;


  if
    v_game.turn_no is distinct from
      p_expected_turn_no

    or

    v_current_card_source is distinct from
      p_expected_card_source

    or

    v_current_card_id is distinct from
      p_expected_card_id

  then

    return jsonb_build_object(
      'stale',
      true,

      'reason',
      'game_state_changed'
    );

  end if;


  v_result :=
    public.use_take_control(
      p_game_code
    );


  return
    coalesce(
      v_result,
      '{}'::jsonb
    )
    ||
    jsonb_build_object(
      'stale',
      false
    );

end;

$$;


ALTER FUNCTION "public"."use_take_control_guarded"("p_game_code" "text", "p_expected_turn_no" integer, "p_expected_card_id" bigint, "p_expected_card_source" "text") OWNER TO "postgres";

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


CREATE TABLE IF NOT EXISTS "public"."card_invitations" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "card_id" bigint,
    "sent_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "opened_at" timestamp with time zone,
    "sender_user_id" "uuid",
    "recipient_user_id" "uuid",
    "couple_id" "uuid",
    "request_key" "uuid",
    "card_source" "text" DEFAULT 'official'::"text" NOT NULL,
    "custom_card_id" bigint,
    CONSTRAINT "card_invitations_card_source_check" CHECK (("card_source" = ANY (ARRAY['official'::"text", 'custom'::"text"]))),
    CONSTRAINT "card_invitations_card_source_consistency" CHECK (((("card_source" = 'official'::"text") AND ("card_id" IS NOT NULL) AND ("custom_card_id" IS NULL)) OR (("card_source" = 'custom'::"text") AND ("card_id" IS NULL) AND ("custom_card_id" IS NOT NULL))))
);


ALTER TABLE "public"."card_invitations" OWNER TO "postgres";


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
    "card_id" bigint,
    "turn_no" integer NOT NULL,
    "player_no" smallint NOT NULL,
    "outcome" "text",
    "shown_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "resolved_at" timestamp with time zone,
    "card_source" "text" DEFAULT 'official'::"text" NOT NULL,
    "custom_card_id" bigint,
    CONSTRAINT "game_card_history_card_source_check" CHECK (("card_source" = ANY (ARRAY['official'::"text", 'custom'::"text"]))),
    CONSTRAINT "game_card_history_card_source_consistency" CHECK (((("card_source" = 'official'::"text") AND ("card_id" IS NOT NULL) AND ("custom_card_id" IS NULL)) OR (("card_source" = 'custom'::"text") AND ("card_id" IS NULL) AND ("custom_card_id" IS NOT NULL)))),
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



CREATE TABLE IF NOT EXISTS "public"."game_players" (
    "game_id" "uuid" NOT NULL,
    "user_id" "uuid" NOT NULL,
    "player_no" integer NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "game_players_player_no_check" CHECK (("player_no" = ANY (ARRAY[1, 2])))
);


ALTER TABLE "public"."game_players" OWNER TO "postgres";


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
    "timer_card_id" bigint,
    "timer_started_at" timestamp with time zone,
    "timer_remaining_seconds" integer,
    "timer_running" boolean DEFAULT false NOT NULL,
    "couple_id" "uuid" NOT NULL,
    "director_mode" "text" DEFAULT 'classic'::"text" NOT NULL,
    "director_profile" "text",
    "director_duration" "text" DEFAULT 'normal'::"text" NOT NULL,
    "current_card_source" "text" DEFAULT 'official'::"text" NOT NULL,
    "current_custom_card_id" bigint,
    "timer_card_source" "text" DEFAULT 'official'::"text" NOT NULL,
    "timer_custom_card_id" bigint,
    CONSTRAINT "games_active_player_check" CHECK (("active_player" = ANY (ARRAY[1, 2]))),
    CONSTRAINT "games_current_card_source_check" CHECK (("current_card_source" = ANY (ARRAY['official'::"text", 'custom'::"text"]))),
    CONSTRAINT "games_current_card_source_consistency" CHECK (((("current_card_source" = 'official'::"text") AND ("current_card_id" IS NOT NULL) AND ("current_custom_card_id" IS NULL)) OR (("current_card_source" = 'custom'::"text") AND ("current_card_id" IS NULL) AND ("current_custom_card_id" IS NOT NULL)) OR (("current_card_id" IS NULL) AND ("current_custom_card_id" IS NULL)))),
    CONSTRAINT "games_director_custom_profile_check" CHECK (((("director_mode" = 'classic'::"text") AND ("director_profile" IS NULL)) OR (("director_mode" = 'custom'::"text") AND ("director_profile" = ANY (ARRAY['classic'::"text", 'complice'::"text", 'sensual'::"text", 'provocative'::"text", 'unrestrained'::"text"]))))),
    CONSTRAINT "games_director_duration_check" CHECK (("director_duration" = ANY (ARRAY['short'::"text", 'normal'::"text", 'long'::"text"]))),
    CONSTRAINT "games_director_mode_check" CHECK (("director_mode" = ANY (ARRAY['classic'::"text", 'custom'::"text"]))),
    CONSTRAINT "games_director_profile_check" CHECK ((("director_profile" IS NULL) OR ("director_profile" = ANY (ARRAY['classic'::"text", 'complice'::"text", 'sensual'::"text", 'provocative'::"text", 'unrestrained'::"text", 'intense'::"text"])))),
    CONSTRAINT "games_player_1_sex_check" CHECK ((("player_1_sex" IS NULL) OR ("player_1_sex" = ANY (ARRAY['female'::"text", 'male'::"text"])))),
    CONSTRAINT "games_player_2_sex_check" CHECK ((("player_2_sex" IS NULL) OR ("player_2_sex" = ANY (ARRAY['female'::"text", 'male'::"text"])))),
    CONSTRAINT "games_timer_card_source_check" CHECK (("timer_card_source" = ANY (ARRAY['official'::"text", 'custom'::"text"]))),
    CONSTRAINT "games_timer_remaining_seconds_check" CHECK ((("timer_remaining_seconds" IS NULL) OR ("timer_remaining_seconds" >= 0)))
);


ALTER TABLE "public"."games" OWNER TO "postgres";


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



CREATE TABLE IF NOT EXISTS "public"."protocol_cards" (
    "id" bigint NOT NULL,
    "type" "text" NOT NULL,
    "title" "text",
    "prompt" "text" NOT NULL,
    "intensity" smallint NOT NULL,
    "tension" smallint,
    "sensations" smallint,
    "unexpected" smallint,
    "active" boolean DEFAULT true NOT NULL,
    "target_sex" "text",
    "library_version" "text",
    "library_key" "text",
    "timer_seconds" integer,
    "lovense_mode" "text",
    "lovense_action" "text",
    "lovense_intensity" smallint,
    "lovense_duration_sec" integer,
    "lovense_pattern" "text",
    "lovense_controls_profile" "text",
    "family_key" "text",
    CONSTRAINT "protocol_cards_intensity_check" CHECK ((("intensity" >= 1) AND ("intensity" <= 5))),
    CONSTRAINT "protocol_cards_lovense_controls_profile_check" CHECK ((("lovense_controls_profile" IS NULL) OR ("lovense_controls_profile" = ANY (ARRAY['tease'::"text", 'play'::"text", 'intense'::"text", 'control'::"text"])))),
    CONSTRAINT "protocol_cards_lovense_duration_check" CHECK ((("lovense_duration_sec" IS NULL) OR (("lovense_duration_sec" >= 1) AND ("lovense_duration_sec" <= 600)))),
    CONSTRAINT "protocol_cards_lovense_intensity_check" CHECK ((("lovense_intensity" IS NULL) OR (("lovense_intensity" >= 0) AND ("lovense_intensity" <= 20)))),
    CONSTRAINT "protocol_cards_lovense_mode_check" CHECK ((("lovense_mode" IS NULL) OR ("lovense_mode" = ANY (ARRAY['optional'::"text", 'required'::"text"])))),
    CONSTRAINT "protocol_cards_target_sex_check" CHECK ((("target_sex" IS NULL) OR ("target_sex" = ANY (ARRAY['female'::"text", 'male'::"text"])))),
    CONSTRAINT "protocol_cards_type_check" CHECK (("type" = ANY (ARRAY['truth'::"text", 'action'::"text", 'duel'::"text", 'scene'::"text"])))
);


ALTER TABLE "public"."protocol_cards" OWNER TO "postgres";


ALTER TABLE "public"."protocol_cards" ALTER COLUMN "id" ADD GENERATED ALWAYS AS IDENTITY (
    SEQUENCE NAME "public"."protocol_cards_id_seq"
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);



CREATE TABLE IF NOT EXISTS "public"."protocol_couple_invites" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "created_by" "uuid" NOT NULL,
    "code" "text" NOT NULL,
    "expires_at" timestamp with time zone NOT NULL,
    "consumed_at" timestamp with time zone,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."protocol_couple_invites" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."protocol_couple_members" (
    "couple_id" "uuid" NOT NULL,
    "user_id" "uuid" NOT NULL,
    "joined_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."protocol_couple_members" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."protocol_couple_settings" (
    "couple_id" "uuid" NOT NULL,
    "director_mode" "text" DEFAULT 'classic'::"text" NOT NULL,
    "director_profile" "text",
    "director_duration" "text" DEFAULT 'normal'::"text" NOT NULL,
    "updated_by" "uuid",
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "protocol_couple_settings_custom_profile_check" CHECK (((("director_mode" = 'classic'::"text") AND ("director_profile" IS NULL)) OR (("director_mode" = 'custom'::"text") AND ("director_profile" IS NOT NULL)))),
    CONSTRAINT "protocol_couple_settings_director_custom_profile_check" CHECK (((("director_mode" = 'classic'::"text") AND ("director_profile" IS NULL)) OR (("director_mode" = 'custom'::"text") AND ("director_profile" = ANY (ARRAY['classic'::"text", 'complice'::"text", 'sensual'::"text", 'provocative'::"text", 'unrestrained'::"text"]))))),
    CONSTRAINT "protocol_couple_settings_duration_check" CHECK (("director_duration" = ANY (ARRAY['short'::"text", 'normal'::"text", 'long'::"text"]))),
    CONSTRAINT "protocol_couple_settings_mode_check" CHECK (("director_mode" = ANY (ARRAY['classic'::"text", 'custom'::"text"]))),
    CONSTRAINT "protocol_couple_settings_profile_check" CHECK ((("director_profile" IS NULL) OR ("director_profile" = ANY (ARRAY['classic'::"text", 'complice'::"text", 'sensual'::"text", 'provocative'::"text", 'unrestrained'::"text", 'intense'::"text"]))))
);


ALTER TABLE "public"."protocol_couple_settings" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."protocol_couples" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "created_by" "uuid" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."protocol_couples" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."protocol_custom_cards" (
    "id" bigint NOT NULL,
    "couple_id" "uuid" NOT NULL,
    "created_by" "uuid" NOT NULL,
    "type" "text" NOT NULL,
    "title" "text" NOT NULL,
    "prompt" "text" NOT NULL,
    "intensity" smallint NOT NULL,
    "tension" smallint,
    "sensations" smallint,
    "unexpected" smallint,
    "active" boolean DEFAULT true NOT NULL,
    "target_sex" "text",
    "timer_seconds" integer,
    "library_version" "text" DEFAULT 'custom'::"text" NOT NULL,
    "library_key" "text" DEFAULT ('custom_'::"text" || ("gen_random_uuid"())::"text") NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "deleted_at" timestamp with time zone,
    CONSTRAINT "protocol_custom_cards_intensity_check" CHECK ((("intensity" >= 1) AND ("intensity" <= 5))),
    CONSTRAINT "protocol_custom_cards_target_sex_check" CHECK ((("target_sex" IS NULL) OR ("target_sex" = ANY (ARRAY['female'::"text", 'male'::"text"])))),
    CONSTRAINT "protocol_custom_cards_timer_check" CHECK ((("timer_seconds" IS NULL) OR (("timer_seconds" >= 1) AND ("timer_seconds" <= 3600)))),
    CONSTRAINT "protocol_custom_cards_truth_intensity_check" CHECK ((("type" <> 'truth'::"text") OR ("intensity" = 1))),
    CONSTRAINT "protocol_custom_cards_type_check" CHECK (("type" = ANY (ARRAY['action'::"text", 'truth'::"text", 'duel'::"text"])))
);


ALTER TABLE "public"."protocol_custom_cards" OWNER TO "postgres";


ALTER TABLE "public"."protocol_custom_cards" ALTER COLUMN "id" ADD GENERATED BY DEFAULT AS IDENTITY (
    SEQUENCE NAME "public"."protocol_custom_cards_id_seq"
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);



CREATE TABLE IF NOT EXISTS "public"."protocol_lovense_connections" (
    "id" bigint NOT NULL,
    "lovense_uid" "text" NOT NULL,
    "utoken" "text",
    "domain" "text",
    "http_port" "text",
    "https_port" "text",
    "ws_port" "text",
    "wss_port" "text",
    "platform" "text",
    "app_version" "text",
    "toys" "jsonb" DEFAULT '{}'::"jsonb" NOT NULL,
    "connected_at" timestamp with time zone,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "user_id" "uuid" NOT NULL,
    "couple_id" "uuid" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."protocol_lovense_connections" OWNER TO "postgres";


ALTER TABLE "public"."protocol_lovense_connections" ALTER COLUMN "id" ADD GENERATED BY DEFAULT AS IDENTITY (
    SEQUENCE NAME "public"."protocol_lovense_connections_id_seq"
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);



CREATE TABLE IF NOT EXISTS "public"."protocol_messages" (
    "id" bigint NOT NULL,
    "body" "text" NOT NULL,
    "reply_to_id" bigint,
    "reaction" "text",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "read_at" timestamp with time zone,
    "sender_user_id" "uuid",
    "recipient_user_id" "uuid",
    "couple_id" "uuid"
);


ALTER TABLE "public"."protocol_messages" OWNER TO "postgres";


ALTER TABLE "public"."protocol_messages" ALTER COLUMN "id" ADD GENERATED BY DEFAULT AS IDENTITY (
    SEQUENCE NAME "public"."protocol_messages_id_seq"
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);



CREATE OR REPLACE VIEW "public"."protocol_playable_cards" AS
 SELECT 'official'::"text" AS "card_source",
    "c"."id" AS "source_id",
    "c"."id" AS "official_card_id",
    NULL::bigint AS "custom_card_id",
    NULL::"uuid" AS "couple_id",
    "c"."type",
    "c"."title",
    "c"."prompt",
    "c"."intensity",
    "c"."tension",
    "c"."sensations",
    "c"."unexpected",
    "c"."target_sex",
    "c"."timer_seconds",
    "c"."active",
    "c"."library_version",
    "c"."library_key",
    "c"."lovense_mode",
    "c"."family_key"
   FROM "public"."protocol_cards" "c"
UNION ALL
 SELECT 'custom'::"text" AS "card_source",
    "c"."id" AS "source_id",
    NULL::bigint AS "official_card_id",
    "c"."id" AS "custom_card_id",
    "c"."couple_id",
    "c"."type",
    "c"."title",
    "c"."prompt",
    "c"."intensity",
    "c"."tension",
    "c"."sensations",
    "c"."unexpected",
    "c"."target_sex",
    "c"."timer_seconds",
    "c"."active",
    "c"."library_version",
    "c"."library_key",
    NULL::"text" AS "lovense_mode",
    NULL::"text" AS "family_key"
   FROM "public"."protocol_custom_cards" "c";


ALTER VIEW "public"."protocol_playable_cards" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."protocol_profiles" (
    "user_id" "uuid" NOT NULL,
    "display_name" "text",
    "sex" "text",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "protocol_profiles_sex_check" CHECK ((("sex" IS NULL) OR ("sex" = ANY (ARRAY['male'::"text", 'female'::"text"]))))
);


ALTER TABLE "public"."protocol_profiles" OWNER TO "postgres";


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



CREATE TABLE IF NOT EXISTS "public"."protocol_signals" (
    "id" bigint NOT NULL,
    "type" "text" NOT NULL,
    "status" "text" DEFAULT 'pending'::"text" NOT NULL,
    "card_id" bigint,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "completed_at" timestamp with time zone,
    "sender_user_id" "uuid",
    "recipient_user_id" "uuid",
    "couple_id" "uuid",
    CONSTRAINT "protocol_signals_status_check" CHECK (("status" = ANY (ARRAY['pending'::"text", 'completed'::"text", 'cancelled'::"text"]))),
    CONSTRAINT "protocol_signals_type_check" CHECK (("type" = ANY (ARRAY['secret'::"text", 'challenge'::"text", 'tonight'::"text"])))
);


ALTER TABLE "public"."protocol_signals" OWNER TO "postgres";


ALTER TABLE "public"."protocol_signals" ALTER COLUMN "id" ADD GENERATED BY DEFAULT AS IDENTITY (
    SEQUENCE NAME "public"."protocol_signals_id_seq"
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);



CREATE TABLE IF NOT EXISTS "public"."push_subscriptions" (
    "id" bigint NOT NULL,
    "device_id" "uuid" NOT NULL,
    "endpoint" "text" NOT NULL,
    "p256dh" "text" NOT NULL,
    "auth" "text" NOT NULL,
    "user_agent" "text",
    "active" boolean DEFAULT true NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "last_seen_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "user_id" "uuid",
    "couple_id" "uuid"
);


ALTER TABLE "public"."push_subscriptions" OWNER TO "postgres";


ALTER TABLE "public"."push_subscriptions" ALTER COLUMN "id" ADD GENERATED BY DEFAULT AS IDENTITY (
    SEQUENCE NAME "public"."push_subscriptions_id_seq"
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);



ALTER TABLE ONLY "public"."calibration_responses"
    ADD CONSTRAINT "calibration_responses_pkey" PRIMARY KEY ("game_id", "player_no");



ALTER TABLE ONLY "public"."card_invitations"
    ADD CONSTRAINT "card_invitations_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."game_active_rules"
    ADD CONSTRAINT "game_active_rules_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."game_card_history"
    ADD CONSTRAINT "game_card_history_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."game_players"
    ADD CONSTRAINT "game_players_pkey" PRIMARY KEY ("game_id", "user_id");



ALTER TABLE ONLY "public"."game_players"
    ADD CONSTRAINT "game_players_unique_player_no" UNIQUE ("game_id", "player_no");



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



ALTER TABLE ONLY "public"."protocol_couple_invites"
    ADD CONSTRAINT "protocol_couple_invites_code_key" UNIQUE ("code");



ALTER TABLE ONLY "public"."protocol_couple_invites"
    ADD CONSTRAINT "protocol_couple_invites_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."protocol_couple_members"
    ADD CONSTRAINT "protocol_couple_members_one_couple_per_user" UNIQUE ("user_id");



ALTER TABLE ONLY "public"."protocol_couple_members"
    ADD CONSTRAINT "protocol_couple_members_pkey" PRIMARY KEY ("couple_id", "user_id");



ALTER TABLE ONLY "public"."protocol_couple_settings"
    ADD CONSTRAINT "protocol_couple_settings_pkey" PRIMARY KEY ("couple_id");



ALTER TABLE ONLY "public"."protocol_couples"
    ADD CONSTRAINT "protocol_couples_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."protocol_custom_cards"
    ADD CONSTRAINT "protocol_custom_cards_library_key_unique" UNIQUE ("library_key");



ALTER TABLE ONLY "public"."protocol_custom_cards"
    ADD CONSTRAINT "protocol_custom_cards_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."protocol_lovense_connections"
    ADD CONSTRAINT "protocol_lovense_connections_couple_user_key" UNIQUE ("couple_id", "user_id");



ALTER TABLE ONLY "public"."protocol_lovense_connections"
    ADD CONSTRAINT "protocol_lovense_connections_lovense_uid_key" UNIQUE ("lovense_uid");



ALTER TABLE ONLY "public"."protocol_lovense_connections"
    ADD CONSTRAINT "protocol_lovense_connections_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."protocol_messages"
    ADD CONSTRAINT "protocol_messages_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."protocol_profiles"
    ADD CONSTRAINT "protocol_profiles_pkey" PRIMARY KEY ("user_id");



ALTER TABLE ONLY "public"."protocol_scene_steps"
    ADD CONSTRAINT "protocol_scene_steps_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."protocol_scene_steps"
    ADD CONSTRAINT "protocol_scene_steps_unique" UNIQUE ("card_id", "step_no");



ALTER TABLE ONLY "public"."protocol_signals"
    ADD CONSTRAINT "protocol_signals_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."push_subscriptions"
    ADD CONSTRAINT "push_subscriptions_device_unique" UNIQUE ("device_id");



ALTER TABLE ONLY "public"."push_subscriptions"
    ADD CONSTRAINT "push_subscriptions_endpoint_unique" UNIQUE ("endpoint");



ALTER TABLE ONLY "public"."push_subscriptions"
    ADD CONSTRAINT "push_subscriptions_pkey" PRIMARY KEY ("id");



CREATE INDEX "card_invitations_couple_id_idx" ON "public"."card_invitations" USING "btree" ("couple_id");



CREATE INDEX "card_invitations_recipient_user_id_idx" ON "public"."card_invitations" USING "btree" ("recipient_user_id");



CREATE UNIQUE INDEX "card_invitations_request_key_uidx" ON "public"."card_invitations" USING "btree" ("request_key") WHERE ("request_key" IS NOT NULL);



CREATE INDEX "card_invitations_sender_user_id_idx" ON "public"."card_invitations" USING "btree" ("sender_user_id");



CREATE UNIQUE INDEX "game_active_rules_source_unique" ON "public"."game_active_rules" USING "btree" ("game_id", "source_card_id", "rule_key") WHERE ("source_card_id" IS NOT NULL);



CREATE INDEX "game_card_history_game_idx" ON "public"."game_card_history" USING "btree" ("game_id");



CREATE INDEX "idx_card_invitations_custom_card" ON "public"."card_invitations" USING "btree" ("custom_card_id");



CREATE INDEX "idx_card_invitations_source" ON "public"."card_invitations" USING "btree" ("card_source");



CREATE INDEX "idx_game_active_rules_game_active" ON "public"."game_active_rules" USING "btree" ("game_id", "active");



CREATE INDEX "idx_games_current_custom_card" ON "public"."games" USING "btree" ("current_custom_card_id");



CREATE INDEX "idx_games_timer_custom_card" ON "public"."games" USING "btree" ("timer_custom_card_id");



CREATE INDEX "idx_history_custom_card" ON "public"."game_card_history" USING "btree" ("custom_card_id");



CREATE INDEX "idx_history_source" ON "public"."game_card_history" USING "btree" ("game_id", "card_source");



CREATE INDEX "idx_protocol_custom_cards_couple" ON "public"."protocol_custom_cards" USING "btree" ("couple_id");



CREATE INDEX "idx_protocol_custom_cards_couple_active" ON "public"."protocol_custom_cards" USING "btree" ("couple_id", "active");



CREATE INDEX "idx_protocol_custom_cards_selection" ON "public"."protocol_custom_cards" USING "btree" ("couple_id", "active", "type", "intensity", "tension", "sensations", "unexpected", "target_sex");



CREATE INDEX "protocol_cards_family_key_idx" ON "public"."protocol_cards" USING "btree" ("library_version", "family_key");



CREATE UNIQUE INDEX "protocol_cards_library_key_uidx" ON "public"."protocol_cards" USING "btree" ("library_key") WHERE ("library_key" IS NOT NULL);



CREATE UNIQUE INDEX "protocol_cards_library_key_unique_idx" ON "public"."protocol_cards" USING "btree" ("library_key");



CREATE INDEX "protocol_couple_invites_code_idx" ON "public"."protocol_couple_invites" USING "btree" ("code");



CREATE INDEX "protocol_couple_invites_created_by_idx" ON "public"."protocol_couple_invites" USING "btree" ("created_by");



CREATE INDEX "protocol_messages_couple_id_idx" ON "public"."protocol_messages" USING "btree" ("couple_id");



CREATE INDEX "protocol_messages_created_at_idx" ON "public"."protocol_messages" USING "btree" ("created_at" DESC);



CREATE INDEX "protocol_messages_recipient_user_id_idx" ON "public"."protocol_messages" USING "btree" ("recipient_user_id");



CREATE INDEX "protocol_messages_sender_user_id_idx" ON "public"."protocol_messages" USING "btree" ("sender_user_id");



CREATE INDEX "protocol_scene_steps_card_idx" ON "public"."protocol_scene_steps" USING "btree" ("card_id");



CREATE INDEX "protocol_signals_couple_id_idx" ON "public"."protocol_signals" USING "btree" ("couple_id");



CREATE INDEX "protocol_signals_recipient_user_id_idx" ON "public"."protocol_signals" USING "btree" ("recipient_user_id");



CREATE INDEX "protocol_signals_sender_user_id_idx" ON "public"."protocol_signals" USING "btree" ("sender_user_id");



CREATE INDEX "push_subscriptions_couple_id_idx" ON "public"."push_subscriptions" USING "btree" ("couple_id");



CREATE INDEX "push_subscriptions_user_id_idx" ON "public"."push_subscriptions" USING "btree" ("user_id");



CREATE OR REPLACE TRIGGER "trg_prevent_custom_card_owner_change" BEFORE UPDATE ON "public"."protocol_custom_cards" FOR EACH ROW EXECUTE FUNCTION "public"."prevent_custom_card_owner_change"();



CREATE OR REPLACE TRIGGER "trg_protocol_custom_cards_updated_at" BEFORE UPDATE ON "public"."protocol_custom_cards" FOR EACH ROW EXECUTE FUNCTION "public"."set_protocol_custom_card_updated_at"();



CREATE OR REPLACE TRIGGER "trg_reset_protocol_timer_on_transition" BEFORE UPDATE OF "current_card_id", "status" ON "public"."games" FOR EACH ROW EXECUTE FUNCTION "public"."reset_protocol_timer_on_transition"();



ALTER TABLE ONLY "public"."calibration_responses"
    ADD CONSTRAINT "calibration_responses_game_id_fkey" FOREIGN KEY ("game_id") REFERENCES "public"."games"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."card_invitations"
    ADD CONSTRAINT "card_invitations_card_id_fkey" FOREIGN KEY ("card_id") REFERENCES "public"."protocol_cards"("id");



ALTER TABLE ONLY "public"."card_invitations"
    ADD CONSTRAINT "card_invitations_couple_id_fkey" FOREIGN KEY ("couple_id") REFERENCES "public"."protocol_couples"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."card_invitations"
    ADD CONSTRAINT "card_invitations_custom_card_id_fkey" FOREIGN KEY ("custom_card_id") REFERENCES "public"."protocol_custom_cards"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."card_invitations"
    ADD CONSTRAINT "card_invitations_recipient_user_id_fkey" FOREIGN KEY ("recipient_user_id") REFERENCES "auth"."users"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."card_invitations"
    ADD CONSTRAINT "card_invitations_sender_user_id_fkey" FOREIGN KEY ("sender_user_id") REFERENCES "auth"."users"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."game_active_rules"
    ADD CONSTRAINT "game_active_rules_game_id_fkey" FOREIGN KEY ("game_id") REFERENCES "public"."games"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."game_active_rules"
    ADD CONSTRAINT "game_active_rules_source_card_id_fkey" FOREIGN KEY ("source_card_id") REFERENCES "public"."protocol_cards"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."game_card_history"
    ADD CONSTRAINT "game_card_history_card_id_fkey" FOREIGN KEY ("card_id") REFERENCES "public"."protocol_cards"("id");



ALTER TABLE ONLY "public"."game_card_history"
    ADD CONSTRAINT "game_card_history_custom_card_id_fkey" FOREIGN KEY ("custom_card_id") REFERENCES "public"."protocol_custom_cards"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."game_card_history"
    ADD CONSTRAINT "game_card_history_game_id_fkey" FOREIGN KEY ("game_id") REFERENCES "public"."games"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."game_players"
    ADD CONSTRAINT "game_players_game_id_fkey" FOREIGN KEY ("game_id") REFERENCES "public"."games"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."game_players"
    ADD CONSTRAINT "game_players_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "auth"."users"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."games"
    ADD CONSTRAINT "games_couple_id_fkey" FOREIGN KEY ("couple_id") REFERENCES "public"."protocol_couples"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."games"
    ADD CONSTRAINT "games_current_card_id_fkey" FOREIGN KEY ("current_card_id") REFERENCES "public"."protocol_cards"("id");



ALTER TABLE ONLY "public"."games"
    ADD CONSTRAINT "games_current_custom_card_id_fkey" FOREIGN KEY ("current_custom_card_id") REFERENCES "public"."protocol_custom_cards"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."games"
    ADD CONSTRAINT "games_timer_card_id_fkey" FOREIGN KEY ("timer_card_id") REFERENCES "public"."protocol_cards"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."games"
    ADD CONSTRAINT "games_timer_custom_card_id_fkey" FOREIGN KEY ("timer_custom_card_id") REFERENCES "public"."protocol_custom_cards"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."protocol_card_rules"
    ADD CONSTRAINT "protocol_card_rules_card_id_fkey" FOREIGN KEY ("card_id") REFERENCES "public"."protocol_cards"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."protocol_couple_invites"
    ADD CONSTRAINT "protocol_couple_invites_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "auth"."users"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."protocol_couple_members"
    ADD CONSTRAINT "protocol_couple_members_couple_id_fkey" FOREIGN KEY ("couple_id") REFERENCES "public"."protocol_couples"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."protocol_couple_members"
    ADD CONSTRAINT "protocol_couple_members_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "auth"."users"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."protocol_couple_settings"
    ADD CONSTRAINT "protocol_couple_settings_couple_id_fkey" FOREIGN KEY ("couple_id") REFERENCES "public"."protocol_couples"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."protocol_couple_settings"
    ADD CONSTRAINT "protocol_couple_settings_updated_by_fkey" FOREIGN KEY ("updated_by") REFERENCES "auth"."users"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."protocol_couples"
    ADD CONSTRAINT "protocol_couples_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "auth"."users"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."protocol_custom_cards"
    ADD CONSTRAINT "protocol_custom_cards_couple_id_fkey" FOREIGN KEY ("couple_id") REFERENCES "public"."protocol_couples"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."protocol_custom_cards"
    ADD CONSTRAINT "protocol_custom_cards_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "auth"."users"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."protocol_lovense_connections"
    ADD CONSTRAINT "protocol_lovense_connections_couple_id_fkey" FOREIGN KEY ("couple_id") REFERENCES "public"."protocol_couples"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."protocol_lovense_connections"
    ADD CONSTRAINT "protocol_lovense_connections_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "auth"."users"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."protocol_messages"
    ADD CONSTRAINT "protocol_messages_couple_id_fkey" FOREIGN KEY ("couple_id") REFERENCES "public"."protocol_couples"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."protocol_messages"
    ADD CONSTRAINT "protocol_messages_recipient_user_id_fkey" FOREIGN KEY ("recipient_user_id") REFERENCES "auth"."users"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."protocol_messages"
    ADD CONSTRAINT "protocol_messages_reply_to_id_fkey" FOREIGN KEY ("reply_to_id") REFERENCES "public"."protocol_messages"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."protocol_messages"
    ADD CONSTRAINT "protocol_messages_sender_user_id_fkey" FOREIGN KEY ("sender_user_id") REFERENCES "auth"."users"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."protocol_profiles"
    ADD CONSTRAINT "protocol_profiles_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "auth"."users"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."protocol_scene_steps"
    ADD CONSTRAINT "protocol_scene_steps_card_id_fkey" FOREIGN KEY ("card_id") REFERENCES "public"."protocol_cards"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."protocol_signals"
    ADD CONSTRAINT "protocol_signals_couple_id_fkey" FOREIGN KEY ("couple_id") REFERENCES "public"."protocol_couples"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."protocol_signals"
    ADD CONSTRAINT "protocol_signals_recipient_user_id_fkey" FOREIGN KEY ("recipient_user_id") REFERENCES "auth"."users"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."protocol_signals"
    ADD CONSTRAINT "protocol_signals_sender_user_id_fkey" FOREIGN KEY ("sender_user_id") REFERENCES "auth"."users"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."push_subscriptions"
    ADD CONSTRAINT "push_subscriptions_couple_id_fkey" FOREIGN KEY ("couple_id") REFERENCES "public"."protocol_couples"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."push_subscriptions"
    ADD CONSTRAINT "push_subscriptions_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "auth"."users"("id") ON DELETE CASCADE;



ALTER TABLE "public"."calibration_responses" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."card_invitations" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "card_invitations_select_own" ON "public"."card_invitations" FOR SELECT TO "authenticated" USING ((("sender_user_id" = "auth"."uid"()) OR ("recipient_user_id" = "auth"."uid"())));



CREATE POLICY "custom_cards_delete_own_couple" ON "public"."protocol_custom_cards" FOR DELETE TO "authenticated" USING (("couple_id" = "public"."current_protocol_couple_id"()));



CREATE POLICY "custom_cards_insert_own_couple" ON "public"."protocol_custom_cards" FOR INSERT TO "authenticated" WITH CHECK ((("couple_id" = "public"."current_protocol_couple_id"()) AND ("created_by" = "auth"."uid"())));



CREATE POLICY "custom_cards_select_own_couple" ON "public"."protocol_custom_cards" FOR SELECT TO "authenticated" USING (("couple_id" = "public"."current_protocol_couple_id"()));



CREATE POLICY "custom_cards_update_own_couple" ON "public"."protocol_custom_cards" FOR UPDATE TO "authenticated" USING (("couple_id" = "public"."current_protocol_couple_id"())) WITH CHECK (("couple_id" = "public"."current_protocol_couple_id"()));



ALTER TABLE "public"."game_active_rules" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."game_card_history" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."game_players" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."games" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."protocol_card_rules" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."protocol_cards" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "protocol_cards_select_authenticated" ON "public"."protocol_cards" FOR SELECT TO "authenticated" USING ((("active" = true) AND ("library_version" = 'v1'::"text")));



CREATE POLICY "protocol_cards_select_closing" ON "public"."protocol_cards" FOR SELECT TO "authenticated" USING ((("active" = true) AND ("library_version" = 'closing'::"text")));



ALTER TABLE "public"."protocol_couple_invites" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."protocol_couple_members" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "protocol_couple_members_select_own" ON "public"."protocol_couple_members" FOR SELECT TO "authenticated" USING (("user_id" = "auth"."uid"()));



ALTER TABLE "public"."protocol_couple_settings" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."protocol_couples" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "protocol_couples_select_member" ON "public"."protocol_couples" FOR SELECT TO "authenticated" USING ((EXISTS ( SELECT 1
   FROM "public"."protocol_couple_members" "m"
  WHERE (("m"."couple_id" = "protocol_couples"."id") AND ("m"."user_id" = "auth"."uid"())))));



ALTER TABLE "public"."protocol_custom_cards" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."protocol_lovense_connections" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."protocol_messages" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "protocol_messages_select_own" ON "public"."protocol_messages" FOR SELECT TO "authenticated" USING ((("sender_user_id" = "auth"."uid"()) OR ("recipient_user_id" = "auth"."uid"())));



ALTER TABLE "public"."protocol_profiles" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "protocol_profiles_insert_own" ON "public"."protocol_profiles" FOR INSERT TO "authenticated" WITH CHECK (("user_id" = "auth"."uid"()));



CREATE POLICY "protocol_profiles_select_own" ON "public"."protocol_profiles" FOR SELECT TO "authenticated" USING (("user_id" = "auth"."uid"()));



CREATE POLICY "protocol_profiles_update_own" ON "public"."protocol_profiles" FOR UPDATE TO "authenticated" USING (("user_id" = "auth"."uid"())) WITH CHECK (("user_id" = "auth"."uid"()));



ALTER TABLE "public"."protocol_scene_steps" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."protocol_signals" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."push_subscriptions" ENABLE ROW LEVEL SECURITY;




ALTER PUBLICATION "supabase_realtime" OWNER TO "postgres";






ALTER PUBLICATION "supabase_realtime" ADD TABLE ONLY "public"."games";



GRANT USAGE ON SCHEMA "public" TO "postgres";
GRANT USAGE ON SCHEMA "public" TO "anon";
GRANT USAGE ON SCHEMA "public" TO "authenticated";
GRANT USAGE ON SCHEMA "public" TO "service_role";



GRANT ALL ON FUNCTION "public"."gtrgm_in"("cstring") TO "postgres";
GRANT ALL ON FUNCTION "public"."gtrgm_in"("cstring") TO "anon";
GRANT ALL ON FUNCTION "public"."gtrgm_in"("cstring") TO "authenticated";
GRANT ALL ON FUNCTION "public"."gtrgm_in"("cstring") TO "service_role";



GRANT ALL ON FUNCTION "public"."gtrgm_out"("public"."gtrgm") TO "postgres";
GRANT ALL ON FUNCTION "public"."gtrgm_out"("public"."gtrgm") TO "anon";
GRANT ALL ON FUNCTION "public"."gtrgm_out"("public"."gtrgm") TO "authenticated";
GRANT ALL ON FUNCTION "public"."gtrgm_out"("public"."gtrgm") TO "service_role";






















































































































































REVOKE ALL ON FUNCTION "public"."add_game_rule"("p_game_code" "text", "p_title" "text", "p_rule_text" "text", "p_target_player" integer, "p_duration_turns" integer, "p_rule_key" "text") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."add_game_rule"("p_game_code" "text", "p_title" "text", "p_rule_text" "text", "p_target_player" integer, "p_duration_turns" integer, "p_rule_key" "text") TO "service_role";



REVOKE ALL ON FUNCTION "public"."advance_protocol"("p_game_code" "text", "p_action" "text", "p_duel_winner" integer) FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."advance_protocol"("p_game_code" "text", "p_action" "text", "p_duel_winner" integer) TO "service_role";



GRANT ALL ON FUNCTION "public"."advance_protocol_guarded"("p_game_code" "text", "p_action" "text", "p_duel_winner" integer, "p_expected_turn_no" integer, "p_expected_card_id" bigint, "p_expected_card_source" "text") TO "anon";
GRANT ALL ON FUNCTION "public"."advance_protocol_guarded"("p_game_code" "text", "p_action" "text", "p_duel_winner" integer, "p_expected_turn_no" integer, "p_expected_card_id" bigint, "p_expected_card_source" "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."advance_protocol_guarded"("p_game_code" "text", "p_action" "text", "p_duel_winner" integer, "p_expected_turn_no" integer, "p_expected_card_id" bigint, "p_expected_card_source" "text") TO "service_role";



REVOKE ALL ON FUNCTION "public"."advance_scene_step"("p_game_code" "text") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."advance_scene_step"("p_game_code" "text") TO "service_role";



REVOKE ALL ON FUNCTION "public"."advance_scene_step_guarded"("p_game_code" "text", "p_expected_card_id" bigint, "p_expected_scene_step_no" integer) FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."advance_scene_step_guarded"("p_game_code" "text", "p_expected_card_id" bigint, "p_expected_scene_step_no" integer) TO "authenticated";
GRANT ALL ON FUNCTION "public"."advance_scene_step_guarded"("p_game_code" "text", "p_expected_card_id" bigint, "p_expected_scene_step_no" integer) TO "service_role";



REVOKE ALL ON FUNCTION "public"."buy_protocol_bonus"("p_game_code" "text", "p_bonus" "text") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."buy_protocol_bonus"("p_game_code" "text", "p_bonus" "text") TO "service_role";



GRANT ALL ON FUNCTION "public"."buy_protocol_bonus_guarded"("p_game_code" "text", "p_bonus" "text", "p_expected_turn_no" integer, "p_expected_card_id" bigint, "p_expected_card_source" "text") TO "anon";
GRANT ALL ON FUNCTION "public"."buy_protocol_bonus_guarded"("p_game_code" "text", "p_bonus" "text", "p_expected_turn_no" integer, "p_expected_card_id" bigint, "p_expected_card_source" "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."buy_protocol_bonus_guarded"("p_game_code" "text", "p_bonus" "text", "p_expected_turn_no" integer, "p_expected_card_id" bigint, "p_expected_card_source" "text") TO "service_role";



REVOKE ALL ON FUNCTION "public"."create_protocol_couple_invite"() FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."create_protocol_couple_invite"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."create_protocol_couple_invite"() TO "service_role";



REVOKE ALL ON FUNCTION "public"."create_protocol_game"() FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."create_protocol_game"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."create_protocol_game"() TO "service_role";



REVOKE ALL ON FUNCTION "public"."current_protocol_couple_id"() FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."current_protocol_couple_id"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."current_protocol_couple_id"() TO "service_role";



REVOKE ALL ON FUNCTION "public"."delete_protocol_account_data"() FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."delete_protocol_account_data"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."delete_protocol_account_data"() TO "service_role";



REVOKE ALL ON FUNCTION "public"."get_active_rules"("p_game_code" "text") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."get_active_rules"("p_game_code" "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."get_active_rules"("p_game_code" "text") TO "service_role";



REVOKE ALL ON FUNCTION "public"."get_card_invitation_secure_v2"("p_invitation_id" "text") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."get_card_invitation_secure_v2"("p_invitation_id" "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."get_card_invitation_secure_v2"("p_invitation_id" "text") TO "service_role";



REVOKE ALL ON FUNCTION "public"."get_card_invitation_status_secure"("p_invitation_id" "uuid") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."get_card_invitation_status_secure"("p_invitation_id" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."get_card_invitation_status_secure"("p_invitation_id" "uuid") TO "service_role";



REVOKE ALL ON FUNCTION "public"."get_protocol_couple"() FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."get_protocol_couple"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."get_protocol_couple"() TO "service_role";



REVOKE ALL ON FUNCTION "public"."get_protocol_couple_settings"() FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."get_protocol_couple_settings"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."get_protocol_couple_settings"() TO "service_role";



GRANT ALL ON FUNCTION "public"."get_protocol_current_card"("p_game_code" "text") TO "anon";
GRANT ALL ON FUNCTION "public"."get_protocol_current_card"("p_game_code" "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."get_protocol_current_card"("p_game_code" "text") TO "service_role";



REVOKE ALL ON FUNCTION "public"."get_protocol_final_stats"("p_game_code" "text") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."get_protocol_final_stats"("p_game_code" "text") TO "service_role";
GRANT ALL ON FUNCTION "public"."get_protocol_final_stats"("p_game_code" "text") TO "authenticated";



REVOKE ALL ON FUNCTION "public"."get_protocol_game"("p_game_code" "text") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."get_protocol_game"("p_game_code" "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."get_protocol_game"("p_game_code" "text") TO "service_role";



REVOKE ALL ON FUNCTION "public"."get_protocol_scene_preview"("p_card_id" bigint) FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."get_protocol_scene_preview"("p_card_id" bigint) TO "anon";
GRANT ALL ON FUNCTION "public"."get_protocol_scene_preview"("p_card_id" bigint) TO "authenticated";
GRANT ALL ON FUNCTION "public"."get_protocol_scene_preview"("p_card_id" bigint) TO "service_role";



REVOKE ALL ON FUNCTION "public"."get_scene_state"("p_game_code" "text") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."get_scene_state"("p_game_code" "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."get_scene_state"("p_game_code" "text") TO "service_role";



GRANT ALL ON FUNCTION "public"."gin_extract_query_trgm"("text", "internal", smallint, "internal", "internal", "internal", "internal") TO "postgres";
GRANT ALL ON FUNCTION "public"."gin_extract_query_trgm"("text", "internal", smallint, "internal", "internal", "internal", "internal") TO "anon";
GRANT ALL ON FUNCTION "public"."gin_extract_query_trgm"("text", "internal", smallint, "internal", "internal", "internal", "internal") TO "authenticated";
GRANT ALL ON FUNCTION "public"."gin_extract_query_trgm"("text", "internal", smallint, "internal", "internal", "internal", "internal") TO "service_role";



GRANT ALL ON FUNCTION "public"."gin_extract_value_trgm"("text", "internal") TO "postgres";
GRANT ALL ON FUNCTION "public"."gin_extract_value_trgm"("text", "internal") TO "anon";
GRANT ALL ON FUNCTION "public"."gin_extract_value_trgm"("text", "internal") TO "authenticated";
GRANT ALL ON FUNCTION "public"."gin_extract_value_trgm"("text", "internal") TO "service_role";



GRANT ALL ON FUNCTION "public"."gin_trgm_consistent"("internal", smallint, "text", integer, "internal", "internal", "internal", "internal") TO "postgres";
GRANT ALL ON FUNCTION "public"."gin_trgm_consistent"("internal", smallint, "text", integer, "internal", "internal", "internal", "internal") TO "anon";
GRANT ALL ON FUNCTION "public"."gin_trgm_consistent"("internal", smallint, "text", integer, "internal", "internal", "internal", "internal") TO "authenticated";
GRANT ALL ON FUNCTION "public"."gin_trgm_consistent"("internal", smallint, "text", integer, "internal", "internal", "internal", "internal") TO "service_role";



GRANT ALL ON FUNCTION "public"."gin_trgm_triconsistent"("internal", smallint, "text", integer, "internal", "internal", "internal") TO "postgres";
GRANT ALL ON FUNCTION "public"."gin_trgm_triconsistent"("internal", smallint, "text", integer, "internal", "internal", "internal") TO "anon";
GRANT ALL ON FUNCTION "public"."gin_trgm_triconsistent"("internal", smallint, "text", integer, "internal", "internal", "internal") TO "authenticated";
GRANT ALL ON FUNCTION "public"."gin_trgm_triconsistent"("internal", smallint, "text", integer, "internal", "internal", "internal") TO "service_role";



GRANT ALL ON FUNCTION "public"."gtrgm_compress"("internal") TO "postgres";
GRANT ALL ON FUNCTION "public"."gtrgm_compress"("internal") TO "anon";
GRANT ALL ON FUNCTION "public"."gtrgm_compress"("internal") TO "authenticated";
GRANT ALL ON FUNCTION "public"."gtrgm_compress"("internal") TO "service_role";



GRANT ALL ON FUNCTION "public"."gtrgm_consistent"("internal", "text", smallint, "oid", "internal") TO "postgres";
GRANT ALL ON FUNCTION "public"."gtrgm_consistent"("internal", "text", smallint, "oid", "internal") TO "anon";
GRANT ALL ON FUNCTION "public"."gtrgm_consistent"("internal", "text", smallint, "oid", "internal") TO "authenticated";
GRANT ALL ON FUNCTION "public"."gtrgm_consistent"("internal", "text", smallint, "oid", "internal") TO "service_role";



GRANT ALL ON FUNCTION "public"."gtrgm_decompress"("internal") TO "postgres";
GRANT ALL ON FUNCTION "public"."gtrgm_decompress"("internal") TO "anon";
GRANT ALL ON FUNCTION "public"."gtrgm_decompress"("internal") TO "authenticated";
GRANT ALL ON FUNCTION "public"."gtrgm_decompress"("internal") TO "service_role";



GRANT ALL ON FUNCTION "public"."gtrgm_distance"("internal", "text", smallint, "oid", "internal") TO "postgres";
GRANT ALL ON FUNCTION "public"."gtrgm_distance"("internal", "text", smallint, "oid", "internal") TO "anon";
GRANT ALL ON FUNCTION "public"."gtrgm_distance"("internal", "text", smallint, "oid", "internal") TO "authenticated";
GRANT ALL ON FUNCTION "public"."gtrgm_distance"("internal", "text", smallint, "oid", "internal") TO "service_role";



GRANT ALL ON FUNCTION "public"."gtrgm_options"("internal") TO "postgres";
GRANT ALL ON FUNCTION "public"."gtrgm_options"("internal") TO "anon";
GRANT ALL ON FUNCTION "public"."gtrgm_options"("internal") TO "authenticated";
GRANT ALL ON FUNCTION "public"."gtrgm_options"("internal") TO "service_role";



GRANT ALL ON FUNCTION "public"."gtrgm_penalty"("internal", "internal", "internal") TO "postgres";
GRANT ALL ON FUNCTION "public"."gtrgm_penalty"("internal", "internal", "internal") TO "anon";
GRANT ALL ON FUNCTION "public"."gtrgm_penalty"("internal", "internal", "internal") TO "authenticated";
GRANT ALL ON FUNCTION "public"."gtrgm_penalty"("internal", "internal", "internal") TO "service_role";



GRANT ALL ON FUNCTION "public"."gtrgm_picksplit"("internal", "internal") TO "postgres";
GRANT ALL ON FUNCTION "public"."gtrgm_picksplit"("internal", "internal") TO "anon";
GRANT ALL ON FUNCTION "public"."gtrgm_picksplit"("internal", "internal") TO "authenticated";
GRANT ALL ON FUNCTION "public"."gtrgm_picksplit"("internal", "internal") TO "service_role";



GRANT ALL ON FUNCTION "public"."gtrgm_same"("public"."gtrgm", "public"."gtrgm", "internal") TO "postgres";
GRANT ALL ON FUNCTION "public"."gtrgm_same"("public"."gtrgm", "public"."gtrgm", "internal") TO "anon";
GRANT ALL ON FUNCTION "public"."gtrgm_same"("public"."gtrgm", "public"."gtrgm", "internal") TO "authenticated";
GRANT ALL ON FUNCTION "public"."gtrgm_same"("public"."gtrgm", "public"."gtrgm", "internal") TO "service_role";



GRANT ALL ON FUNCTION "public"."gtrgm_union"("internal", "internal") TO "postgres";
GRANT ALL ON FUNCTION "public"."gtrgm_union"("internal", "internal") TO "anon";
GRANT ALL ON FUNCTION "public"."gtrgm_union"("internal", "internal") TO "authenticated";
GRANT ALL ON FUNCTION "public"."gtrgm_union"("internal", "internal") TO "service_role";



REVOKE ALL ON FUNCTION "public"."join_protocol_couple"("p_code" "text") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."join_protocol_couple"("p_code" "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."join_protocol_couple"("p_code" "text") TO "service_role";



REVOKE ALL ON FUNCTION "public"."join_protocol_game"("p_game_code" "text") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."join_protocol_game"("p_game_code" "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."join_protocol_game"("p_game_code" "text") TO "service_role";



REVOKE ALL ON FUNCTION "public"."mark_card_invitation_opened_secure"("p_invitation_id" "uuid") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."mark_card_invitation_opened_secure"("p_invitation_id" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."mark_card_invitation_opened_secure"("p_invitation_id" "uuid") TO "service_role";



REVOKE ALL ON FUNCTION "public"."mark_scene_step_read"("p_game_code" "text") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."mark_scene_step_read"("p_game_code" "text") TO "service_role";



REVOKE ALL ON FUNCTION "public"."mark_scene_step_read_guarded"("p_game_code" "text", "p_expected_card_id" bigint, "p_expected_scene_step_no" integer) FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."mark_scene_step_read_guarded"("p_game_code" "text", "p_expected_card_id" bigint, "p_expected_scene_step_no" integer) TO "authenticated";
GRANT ALL ON FUNCTION "public"."mark_scene_step_read_guarded"("p_game_code" "text", "p_expected_card_id" bigint, "p_expected_scene_step_no" integer) TO "service_role";



GRANT ALL ON FUNCTION "public"."prevent_custom_card_owner_change"() TO "anon";
GRANT ALL ON FUNCTION "public"."prevent_custom_card_owner_change"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."prevent_custom_card_owner_change"() TO "service_role";



REVOKE ALL ON FUNCTION "public"."protocol_current_player_no"("p_game_code" "text") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."protocol_current_player_no"("p_game_code" "text") TO "service_role";



GRANT ALL ON FUNCTION "public"."protocol_director_penalty"("p_mode" "text", "p_profile" "text", "p_card_type" "text", "p_card_intensity" integer, "p_has_persistent_rule" boolean, "p_lovense_mode" "text", "p_lovense_connected" boolean, "p_turn_no" integer, "p_target_turns" integer, "p_max_intensity" integer) TO "anon";
GRANT ALL ON FUNCTION "public"."protocol_director_penalty"("p_mode" "text", "p_profile" "text", "p_card_type" "text", "p_card_intensity" integer, "p_has_persistent_rule" boolean, "p_lovense_mode" "text", "p_lovense_connected" boolean, "p_turn_no" integer, "p_target_turns" integer, "p_max_intensity" integer) TO "authenticated";
GRANT ALL ON FUNCTION "public"."protocol_director_penalty"("p_mode" "text", "p_profile" "text", "p_card_type" "text", "p_card_intensity" integer, "p_has_persistent_rule" boolean, "p_lovense_mode" "text", "p_lovense_connected" boolean, "p_turn_no" integer, "p_target_turns" integer, "p_max_intensity" integer) TO "service_role";



GRANT ALL ON FUNCTION "public"."protocol_duel_spacing_v2"("p_target_turns" integer) TO "anon";
GRANT ALL ON FUNCTION "public"."protocol_duel_spacing_v2"("p_target_turns" integer) TO "authenticated";
GRANT ALL ON FUNCTION "public"."protocol_duel_spacing_v2"("p_target_turns" integer) TO "service_role";



GRANT ALL ON FUNCTION "public"."protocol_effective_profile"("p_mode" "text", "p_profile" "text") TO "anon";
GRANT ALL ON FUNCTION "public"."protocol_effective_profile"("p_mode" "text", "p_profile" "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."protocol_effective_profile"("p_mode" "text", "p_profile" "text") TO "service_role";



GRANT ALL ON FUNCTION "public"."protocol_family_reuse_weight"() TO "anon";
GRANT ALL ON FUNCTION "public"."protocol_family_reuse_weight"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."protocol_family_reuse_weight"() TO "service_role";



GRANT ALL ON FUNCTION "public"."protocol_family_window"("p_target_turns" integer) TO "anon";
GRANT ALL ON FUNCTION "public"."protocol_family_window"("p_target_turns" integer) TO "authenticated";
GRANT ALL ON FUNCTION "public"."protocol_family_window"("p_target_turns" integer) TO "service_role";



REVOKE ALL ON FUNCTION "public"."protocol_generate_game_code"() FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."protocol_generate_game_code"() TO "service_role";



GRANT ALL ON FUNCTION "public"."protocol_last_intensity_v2"("p_game_id" "uuid") TO "anon";
GRANT ALL ON FUNCTION "public"."protocol_last_intensity_v2"("p_game_id" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."protocol_last_intensity_v2"("p_game_id" "uuid") TO "service_role";



REVOKE ALL ON FUNCTION "public"."protocol_last_scene_turn"("p_game_id" "uuid") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."protocol_last_scene_turn"("p_game_id" "uuid") TO "service_role";



REVOKE ALL ON FUNCTION "public"."protocol_last_type_turn"("p_game_id" "uuid", "p_type" "text") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."protocol_last_type_turn"("p_game_id" "uuid", "p_type" "text") TO "service_role";



GRANT ALL ON FUNCTION "public"."protocol_lovense_card_allowed"("p_couple_id" "uuid", "p_card_id" bigint) TO "anon";
GRANT ALL ON FUNCTION "public"."protocol_lovense_card_allowed"("p_couple_id" "uuid", "p_card_id" bigint) TO "authenticated";
GRANT ALL ON FUNCTION "public"."protocol_lovense_card_allowed"("p_couple_id" "uuid", "p_card_id" bigint) TO "service_role";



GRANT ALL ON FUNCTION "public"."protocol_lovense_connected"("p_couple_id" "uuid") TO "anon";
GRANT ALL ON FUNCTION "public"."protocol_lovense_connected"("p_couple_id" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."protocol_lovense_connected"("p_couple_id" "uuid") TO "service_role";



REVOKE ALL ON FUNCTION "public"."protocol_max_intensity"("p_profile_intensity" integer, "p_turn_no" integer) FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."protocol_max_intensity"("p_profile_intensity" integer, "p_turn_no" integer) TO "service_role";



REVOKE ALL ON FUNCTION "public"."protocol_persistent_count"("p_game_id" "uuid") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."protocol_persistent_count"("p_game_id" "uuid") TO "service_role";



GRANT ALL ON FUNCTION "public"."protocol_persistent_max_v2"("p_target_turns" integer) TO "anon";
GRANT ALL ON FUNCTION "public"."protocol_persistent_max_v2"("p_target_turns" integer) TO "authenticated";
GRANT ALL ON FUNCTION "public"."protocol_persistent_max_v2"("p_target_turns" integer) TO "service_role";



REVOKE ALL ON FUNCTION "public"."protocol_phase"("p_turn_no" integer, "p_target_turns" integer) FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."protocol_phase"("p_turn_no" integer, "p_target_turns" integer) TO "service_role";



GRANT ALL ON FUNCTION "public"."protocol_pick_start_card"("p_game_code" "text") TO "anon";
GRANT ALL ON FUNCTION "public"."protocol_pick_start_card"("p_game_code" "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."protocol_pick_start_card"("p_game_code" "text") TO "service_role";



REVOKE ALL ON FUNCTION "public"."protocol_player_has_active_rule"("p_game_id" "uuid", "p_player_no" integer) FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."protocol_player_has_active_rule"("p_game_id" "uuid", "p_player_no" integer) TO "service_role";



REVOKE ALL ON FUNCTION "public"."protocol_player_rule_count"("p_game_id" "uuid", "p_player_no" integer) FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."protocol_player_rule_count"("p_game_id" "uuid", "p_player_no" integer) TO "service_role";



GRANT ALL ON FUNCTION "public"."protocol_profile_intensity_weight"("p_profile" "text", "p_card_type" "text", "p_intensity" integer, "p_turn_no" integer, "p_target_turns" integer) TO "anon";
GRANT ALL ON FUNCTION "public"."protocol_profile_intensity_weight"("p_profile" "text", "p_card_type" "text", "p_intensity" integer, "p_turn_no" integer, "p_target_turns" integer) TO "authenticated";
GRANT ALL ON FUNCTION "public"."protocol_profile_intensity_weight"("p_profile" "text", "p_card_type" "text", "p_intensity" integer, "p_turn_no" integer, "p_target_turns" integer) TO "service_role";



GRANT ALL ON FUNCTION "public"."protocol_profile_type_weight"("p_profile" "text", "p_card_type" "text", "p_turn_no" integer, "p_target_turns" integer) TO "anon";
GRANT ALL ON FUNCTION "public"."protocol_profile_type_weight"("p_profile" "text", "p_card_type" "text", "p_turn_no" integer, "p_target_turns" integer) TO "authenticated";
GRANT ALL ON FUNCTION "public"."protocol_profile_type_weight"("p_profile" "text", "p_card_type" "text", "p_turn_no" integer, "p_target_turns" integer) TO "service_role";



GRANT ALL ON FUNCTION "public"."protocol_progress"("p_turn_no" integer, "p_target_turns" integer) TO "anon";
GRANT ALL ON FUNCTION "public"."protocol_progress"("p_turn_no" integer, "p_target_turns" integer) TO "authenticated";
GRANT ALL ON FUNCTION "public"."protocol_progress"("p_turn_no" integer, "p_target_turns" integer) TO "service_role";



GRANT ALL ON FUNCTION "public"."protocol_recent_high_intensity_count_v2"("p_game_id" "uuid", "p_last_n" integer) TO "anon";
GRANT ALL ON FUNCTION "public"."protocol_recent_high_intensity_count_v2"("p_game_id" "uuid", "p_last_n" integer) TO "authenticated";
GRANT ALL ON FUNCTION "public"."protocol_recent_high_intensity_count_v2"("p_game_id" "uuid", "p_last_n" integer) TO "service_role";



GRANT ALL ON FUNCTION "public"."protocol_recent_type_count_v2"("p_game_id" "uuid", "p_type" "text", "p_last_n" integer) TO "anon";
GRANT ALL ON FUNCTION "public"."protocol_recent_type_count_v2"("p_game_id" "uuid", "p_type" "text", "p_last_n" integer) TO "authenticated";
GRANT ALL ON FUNCTION "public"."protocol_recent_type_count_v2"("p_game_id" "uuid", "p_type" "text", "p_last_n" integer) TO "service_role";



REVOKE ALL ON FUNCTION "public"."protocol_rule_card_allowed"("p_game_id" "uuid", "p_card_id" bigint, "p_next_player" integer, "p_next_turn" integer) FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."protocol_rule_card_allowed"("p_game_id" "uuid", "p_card_id" bigint, "p_next_player" integer, "p_next_turn" integer) TO "service_role";



REVOKE ALL ON FUNCTION "public"."protocol_scene_allowed"("p_game_id" "uuid", "p_card_id" bigint, "p_next_turn" integer) FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."protocol_scene_allowed"("p_game_id" "uuid", "p_card_id" bigint, "p_next_turn" integer) TO "service_role";



REVOKE ALL ON FUNCTION "public"."protocol_scene_count"("p_game_id" "uuid") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."protocol_scene_count"("p_game_id" "uuid") TO "service_role";



GRANT ALL ON FUNCTION "public"."protocol_scene_max_v2"("p_target_turns" integer) TO "anon";
GRANT ALL ON FUNCTION "public"."protocol_scene_max_v2"("p_target_turns" integer) TO "authenticated";
GRANT ALL ON FUNCTION "public"."protocol_scene_max_v2"("p_target_turns" integer) TO "service_role";



GRANT ALL ON FUNCTION "public"."protocol_scene_spacing_v2"("p_target_turns" integer) TO "anon";
GRANT ALL ON FUNCTION "public"."protocol_scene_spacing_v2"("p_target_turns" integer) TO "authenticated";
GRANT ALL ON FUNCTION "public"."protocol_scene_spacing_v2"("p_target_turns" integer) TO "service_role";



GRANT ALL ON FUNCTION "public"."protocol_scene_target_min_v2"("p_target_turns" integer) TO "anon";
GRANT ALL ON FUNCTION "public"."protocol_scene_target_min_v2"("p_target_turns" integer) TO "authenticated";
GRANT ALL ON FUNCTION "public"."protocol_scene_target_min_v2"("p_target_turns" integer) TO "service_role";



GRANT ALL ON FUNCTION "public"."protocol_select_card_v2_unified"("p_game_id" "uuid", "p_next_player" integer, "p_next_turn" integer, "p_forced_type" "text") TO "anon";
GRANT ALL ON FUNCTION "public"."protocol_select_card_v2_unified"("p_game_id" "uuid", "p_next_player" integer, "p_next_turn" integer, "p_forced_type" "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."protocol_select_card_v2_unified"("p_game_id" "uuid", "p_next_player" integer, "p_next_turn" integer, "p_forced_type" "text") TO "service_role";



REVOKE ALL ON FUNCTION "public"."protocol_simulate_live"("p_profile" "text", "p_target_turns" integer, "p_calibration" integer, "p_first_sex" "text", "p_games" integer, "p_lovense" boolean) FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."protocol_simulate_live"("p_profile" "text", "p_target_turns" integer, "p_calibration" integer, "p_first_sex" "text", "p_games" integer, "p_lovense" boolean) TO "service_role";



REVOKE ALL ON FUNCTION "public"."protocol_type_count"("p_game_id" "uuid", "p_type" "text") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."protocol_type_count"("p_game_id" "uuid", "p_type" "text") TO "service_role";



REVOKE ALL ON FUNCTION "public"."register_push_subscription_secure"("p_device_id" "uuid", "p_endpoint" "text", "p_p256dh" "text", "p_auth" "text", "p_user_agent" "text") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."register_push_subscription_secure"("p_device_id" "uuid", "p_endpoint" "text", "p_p256dh" "text", "p_auth" "text", "p_user_agent" "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."register_push_subscription_secure"("p_device_id" "uuid", "p_endpoint" "text", "p_p256dh" "text", "p_auth" "text", "p_user_agent" "text") TO "service_role";



REVOKE ALL ON FUNCTION "public"."rematch_protocol"("p_game_code" "text") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."rematch_protocol"("p_game_code" "text") TO "service_role";
GRANT ALL ON FUNCTION "public"."rematch_protocol"("p_game_code" "text") TO "authenticated";



GRANT ALL ON FUNCTION "public"."reset_protocol_timer_on_transition"() TO "anon";
GRANT ALL ON FUNCTION "public"."reset_protocol_timer_on_transition"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."reset_protocol_timer_on_transition"() TO "service_role";



GRANT ALL ON FUNCTION "public"."resume_protocol_game"("p_game_code" "text") TO "anon";
GRANT ALL ON FUNCTION "public"."resume_protocol_game"("p_game_code" "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."resume_protocol_game"("p_game_code" "text") TO "service_role";



REVOKE ALL ON FUNCTION "public"."save_protocol_identity"("p_game_code" "text") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."save_protocol_identity"("p_game_code" "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."save_protocol_identity"("p_game_code" "text") TO "service_role";



GRANT ALL ON FUNCTION "public"."set_limit"(real) TO "postgres";
GRANT ALL ON FUNCTION "public"."set_limit"(real) TO "anon";
GRANT ALL ON FUNCTION "public"."set_limit"(real) TO "authenticated";
GRANT ALL ON FUNCTION "public"."set_limit"(real) TO "service_role";



REVOKE ALL ON FUNCTION "public"."set_protocol_couple_settings"("p_director_mode" "text", "p_director_profile" "text", "p_director_duration" "text") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."set_protocol_couple_settings"("p_director_mode" "text", "p_director_profile" "text", "p_director_duration" "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."set_protocol_couple_settings"("p_director_mode" "text", "p_director_profile" "text", "p_director_duration" "text") TO "service_role";



GRANT ALL ON FUNCTION "public"."set_protocol_custom_card_updated_at"() TO "anon";
GRANT ALL ON FUNCTION "public"."set_protocol_custom_card_updated_at"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."set_protocol_custom_card_updated_at"() TO "service_role";



REVOKE ALL ON FUNCTION "public"."set_protocol_ready"("p_game_code" "text") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."set_protocol_ready"("p_game_code" "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."set_protocol_ready"("p_game_code" "text") TO "service_role";



GRANT ALL ON FUNCTION "public"."show_limit"() TO "postgres";
GRANT ALL ON FUNCTION "public"."show_limit"() TO "anon";
GRANT ALL ON FUNCTION "public"."show_limit"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."show_limit"() TO "service_role";



GRANT ALL ON FUNCTION "public"."show_trgm"("text") TO "postgres";
GRANT ALL ON FUNCTION "public"."show_trgm"("text") TO "anon";
GRANT ALL ON FUNCTION "public"."show_trgm"("text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."show_trgm"("text") TO "service_role";



GRANT ALL ON FUNCTION "public"."similarity"("text", "text") TO "postgres";
GRANT ALL ON FUNCTION "public"."similarity"("text", "text") TO "anon";
GRANT ALL ON FUNCTION "public"."similarity"("text", "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."similarity"("text", "text") TO "service_role";



GRANT ALL ON FUNCTION "public"."similarity_dist"("text", "text") TO "postgres";
GRANT ALL ON FUNCTION "public"."similarity_dist"("text", "text") TO "anon";
GRANT ALL ON FUNCTION "public"."similarity_dist"("text", "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."similarity_dist"("text", "text") TO "service_role";



GRANT ALL ON FUNCTION "public"."similarity_op"("text", "text") TO "postgres";
GRANT ALL ON FUNCTION "public"."similarity_op"("text", "text") TO "anon";
GRANT ALL ON FUNCTION "public"."similarity_op"("text", "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."similarity_op"("text", "text") TO "service_role";



REVOKE ALL ON FUNCTION "public"."start_protocol"("p_game_code" "text") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."start_protocol"("p_game_code" "text") TO "service_role";
GRANT ALL ON FUNCTION "public"."start_protocol"("p_game_code" "text") TO "authenticated";



GRANT ALL ON FUNCTION "public"."stop_protocol_game"("p_game_code" "text") TO "anon";
GRANT ALL ON FUNCTION "public"."stop_protocol_game"("p_game_code" "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."stop_protocol_game"("p_game_code" "text") TO "service_role";



GRANT ALL ON FUNCTION "public"."strict_word_similarity"("text", "text") TO "postgres";
GRANT ALL ON FUNCTION "public"."strict_word_similarity"("text", "text") TO "anon";
GRANT ALL ON FUNCTION "public"."strict_word_similarity"("text", "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."strict_word_similarity"("text", "text") TO "service_role";



GRANT ALL ON FUNCTION "public"."strict_word_similarity_commutator_op"("text", "text") TO "postgres";
GRANT ALL ON FUNCTION "public"."strict_word_similarity_commutator_op"("text", "text") TO "anon";
GRANT ALL ON FUNCTION "public"."strict_word_similarity_commutator_op"("text", "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."strict_word_similarity_commutator_op"("text", "text") TO "service_role";



GRANT ALL ON FUNCTION "public"."strict_word_similarity_dist_commutator_op"("text", "text") TO "postgres";
GRANT ALL ON FUNCTION "public"."strict_word_similarity_dist_commutator_op"("text", "text") TO "anon";
GRANT ALL ON FUNCTION "public"."strict_word_similarity_dist_commutator_op"("text", "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."strict_word_similarity_dist_commutator_op"("text", "text") TO "service_role";



GRANT ALL ON FUNCTION "public"."strict_word_similarity_dist_op"("text", "text") TO "postgres";
GRANT ALL ON FUNCTION "public"."strict_word_similarity_dist_op"("text", "text") TO "anon";
GRANT ALL ON FUNCTION "public"."strict_word_similarity_dist_op"("text", "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."strict_word_similarity_dist_op"("text", "text") TO "service_role";



GRANT ALL ON FUNCTION "public"."strict_word_similarity_op"("text", "text") TO "postgres";
GRANT ALL ON FUNCTION "public"."strict_word_similarity_op"("text", "text") TO "anon";
GRANT ALL ON FUNCTION "public"."strict_word_similarity_op"("text", "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."strict_word_similarity_op"("text", "text") TO "service_role";



REVOKE ALL ON FUNCTION "public"."submit_calibration"("p_game_code" "text", "p_intensity" integer, "p_answers" "jsonb") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."submit_calibration"("p_game_code" "text", "p_intensity" integer, "p_answers" "jsonb") TO "authenticated";
GRANT ALL ON FUNCTION "public"."submit_calibration"("p_game_code" "text", "p_intensity" integer, "p_answers" "jsonb") TO "service_role";



REVOKE ALL ON FUNCTION "public"."tick_game_rules"("p_game_id" "uuid") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."tick_game_rules"("p_game_id" "uuid") TO "service_role";



REVOKE ALL ON FUNCTION "public"."update_protocol_timer"("p_game_code" "text", "p_card_id" bigint, "p_started_at" timestamp with time zone, "p_remaining_seconds" integer, "p_running" boolean) FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."update_protocol_timer"("p_game_code" "text", "p_card_id" bigint, "p_started_at" timestamp with time zone, "p_remaining_seconds" integer, "p_running" boolean) TO "authenticated";
GRANT ALL ON FUNCTION "public"."update_protocol_timer"("p_game_code" "text", "p_card_id" bigint, "p_started_at" timestamp with time zone, "p_remaining_seconds" integer, "p_running" boolean) TO "service_role";



REVOKE ALL ON FUNCTION "public"."use_choose_type"("p_game_code" "text", "p_card_type" "text") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."use_choose_type"("p_game_code" "text", "p_card_type" "text") TO "service_role";



GRANT ALL ON FUNCTION "public"."use_choose_type_guarded"("p_game_code" "text", "p_card_type" "text", "p_expected_turn_no" integer, "p_expected_card_id" bigint, "p_expected_card_source" "text") TO "anon";
GRANT ALL ON FUNCTION "public"."use_choose_type_guarded"("p_game_code" "text", "p_card_type" "text", "p_expected_turn_no" integer, "p_expected_card_id" bigint, "p_expected_card_source" "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."use_choose_type_guarded"("p_game_code" "text", "p_card_type" "text", "p_expected_turn_no" integer, "p_expected_card_id" bigint, "p_expected_card_source" "text") TO "service_role";



REVOKE ALL ON FUNCTION "public"."use_take_control"("p_game_code" "text") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."use_take_control"("p_game_code" "text") TO "service_role";



GRANT ALL ON FUNCTION "public"."use_take_control_guarded"("p_game_code" "text", "p_expected_turn_no" integer, "p_expected_card_id" bigint, "p_expected_card_source" "text") TO "anon";
GRANT ALL ON FUNCTION "public"."use_take_control_guarded"("p_game_code" "text", "p_expected_turn_no" integer, "p_expected_card_id" bigint, "p_expected_card_source" "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."use_take_control_guarded"("p_game_code" "text", "p_expected_turn_no" integer, "p_expected_card_id" bigint, "p_expected_card_source" "text") TO "service_role";



GRANT ALL ON FUNCTION "public"."word_similarity"("text", "text") TO "postgres";
GRANT ALL ON FUNCTION "public"."word_similarity"("text", "text") TO "anon";
GRANT ALL ON FUNCTION "public"."word_similarity"("text", "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."word_similarity"("text", "text") TO "service_role";



GRANT ALL ON FUNCTION "public"."word_similarity_commutator_op"("text", "text") TO "postgres";
GRANT ALL ON FUNCTION "public"."word_similarity_commutator_op"("text", "text") TO "anon";
GRANT ALL ON FUNCTION "public"."word_similarity_commutator_op"("text", "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."word_similarity_commutator_op"("text", "text") TO "service_role";



GRANT ALL ON FUNCTION "public"."word_similarity_dist_commutator_op"("text", "text") TO "postgres";
GRANT ALL ON FUNCTION "public"."word_similarity_dist_commutator_op"("text", "text") TO "anon";
GRANT ALL ON FUNCTION "public"."word_similarity_dist_commutator_op"("text", "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."word_similarity_dist_commutator_op"("text", "text") TO "service_role";



GRANT ALL ON FUNCTION "public"."word_similarity_dist_op"("text", "text") TO "postgres";
GRANT ALL ON FUNCTION "public"."word_similarity_dist_op"("text", "text") TO "anon";
GRANT ALL ON FUNCTION "public"."word_similarity_dist_op"("text", "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."word_similarity_dist_op"("text", "text") TO "service_role";



GRANT ALL ON FUNCTION "public"."word_similarity_op"("text", "text") TO "postgres";
GRANT ALL ON FUNCTION "public"."word_similarity_op"("text", "text") TO "anon";
GRANT ALL ON FUNCTION "public"."word_similarity_op"("text", "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."word_similarity_op"("text", "text") TO "service_role";


















GRANT ALL ON TABLE "public"."calibration_responses" TO "authenticated";
GRANT ALL ON TABLE "public"."calibration_responses" TO "service_role";



GRANT ALL ON TABLE "public"."card_invitations" TO "service_role";
GRANT SELECT ON TABLE "public"."card_invitations" TO "authenticated";



GRANT ALL ON TABLE "public"."game_active_rules" TO "service_role";



GRANT ALL ON SEQUENCE "public"."game_active_rules_id_seq" TO "anon";
GRANT ALL ON SEQUENCE "public"."game_active_rules_id_seq" TO "authenticated";
GRANT ALL ON SEQUENCE "public"."game_active_rules_id_seq" TO "service_role";



GRANT ALL ON TABLE "public"."game_card_history" TO "authenticated";
GRANT ALL ON TABLE "public"."game_card_history" TO "service_role";



GRANT ALL ON SEQUENCE "public"."game_card_history_id_seq" TO "anon";
GRANT ALL ON SEQUENCE "public"."game_card_history_id_seq" TO "authenticated";
GRANT ALL ON SEQUENCE "public"."game_card_history_id_seq" TO "service_role";



GRANT ALL ON TABLE "public"."game_players" TO "service_role";



GRANT ALL ON TABLE "public"."games" TO "service_role";



GRANT ALL ON TABLE "public"."protocol_card_rules" TO "service_role";



GRANT ALL ON SEQUENCE "public"."protocol_card_rules_id_seq" TO "anon";
GRANT ALL ON SEQUENCE "public"."protocol_card_rules_id_seq" TO "authenticated";
GRANT ALL ON SEQUENCE "public"."protocol_card_rules_id_seq" TO "service_role";



GRANT MAINTAIN ON TABLE "public"."protocol_cards" TO "anon";
GRANT ALL ON TABLE "public"."protocol_cards" TO "authenticated";
GRANT ALL ON TABLE "public"."protocol_cards" TO "service_role";



GRANT ALL ON SEQUENCE "public"."protocol_cards_id_seq" TO "anon";
GRANT ALL ON SEQUENCE "public"."protocol_cards_id_seq" TO "authenticated";
GRANT ALL ON SEQUENCE "public"."protocol_cards_id_seq" TO "service_role";



GRANT ALL ON TABLE "public"."protocol_couple_invites" TO "service_role";



GRANT ALL ON TABLE "public"."protocol_couple_members" TO "service_role";
GRANT SELECT ON TABLE "public"."protocol_couple_members" TO "authenticated";



GRANT ALL ON TABLE "public"."protocol_couple_settings" TO "service_role";



GRANT ALL ON TABLE "public"."protocol_couples" TO "service_role";
GRANT SELECT ON TABLE "public"."protocol_couples" TO "authenticated";



GRANT ALL ON TABLE "public"."protocol_custom_cards" TO "anon";
GRANT ALL ON TABLE "public"."protocol_custom_cards" TO "authenticated";
GRANT ALL ON TABLE "public"."protocol_custom_cards" TO "service_role";



GRANT ALL ON SEQUENCE "public"."protocol_custom_cards_id_seq" TO "anon";
GRANT ALL ON SEQUENCE "public"."protocol_custom_cards_id_seq" TO "authenticated";
GRANT ALL ON SEQUENCE "public"."protocol_custom_cards_id_seq" TO "service_role";



GRANT ALL ON TABLE "public"."protocol_lovense_connections" TO "service_role";



GRANT ALL ON SEQUENCE "public"."protocol_lovense_connections_id_seq" TO "service_role";



GRANT ALL ON TABLE "public"."protocol_messages" TO "service_role";
GRANT SELECT ON TABLE "public"."protocol_messages" TO "authenticated";



GRANT ALL ON SEQUENCE "public"."protocol_messages_id_seq" TO "anon";
GRANT ALL ON SEQUENCE "public"."protocol_messages_id_seq" TO "authenticated";
GRANT ALL ON SEQUENCE "public"."protocol_messages_id_seq" TO "service_role";



GRANT ALL ON TABLE "public"."protocol_playable_cards" TO "anon";
GRANT ALL ON TABLE "public"."protocol_playable_cards" TO "authenticated";
GRANT ALL ON TABLE "public"."protocol_playable_cards" TO "service_role";



GRANT ALL ON TABLE "public"."protocol_profiles" TO "service_role";
GRANT SELECT,INSERT,UPDATE ON TABLE "public"."protocol_profiles" TO "authenticated";



GRANT ALL ON TABLE "public"."protocol_scene_steps" TO "service_role";



GRANT ALL ON SEQUENCE "public"."protocol_scene_steps_id_seq" TO "anon";
GRANT ALL ON SEQUENCE "public"."protocol_scene_steps_id_seq" TO "authenticated";
GRANT ALL ON SEQUENCE "public"."protocol_scene_steps_id_seq" TO "service_role";



GRANT ALL ON TABLE "public"."protocol_signals" TO "service_role";



GRANT ALL ON SEQUENCE "public"."protocol_signals_id_seq" TO "anon";
GRANT ALL ON SEQUENCE "public"."protocol_signals_id_seq" TO "authenticated";
GRANT ALL ON SEQUENCE "public"."protocol_signals_id_seq" TO "service_role";



GRANT ALL ON TABLE "public"."push_subscriptions" TO "service_role";



GRANT ALL ON SEQUENCE "public"."push_subscriptions_id_seq" TO "anon";
GRANT ALL ON SEQUENCE "public"."push_subscriptions_id_seq" TO "authenticated";
GRANT ALL ON SEQUENCE "public"."push_subscriptions_id_seq" TO "service_role";









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































