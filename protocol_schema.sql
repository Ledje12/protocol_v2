


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

  v_current_card
    public.protocol_cards%rowtype;

  v_card
    public.protocol_cards%rowtype;

  v_card_rule
    public.protocol_card_rules%rowtype;

  v_next_player integer;
  v_next_turn integer;
  v_next_phase text;
  v_player_sex text;

  v_profile_intensity integer;
  v_max_intensity integer;
  v_desired_min_intensity integer;
  v_min_intensity_primary integer;
  v_min_intensity_fallback integer;

  v_score_p1 integer;
  v_score_p2 integer;
  v_reward integer;

  v_bonus_p1 jsonb;
  v_bonus_p2 jsonb;

  v_forced_type text;
  v_forced_by integer;

  v_rule_target integer;
  v_persistent_count integer;

  v_scene_count integer;

  v_truth_count integer;
  v_truth_early_count integer;
  v_truth_before_11_count integer;
  v_truth_late_count integer;
  v_truth_needed integer;
  v_late_truth_needed integer;
  v_remaining_turns integer;
  v_truth_required boolean := false;

  v_duel_count integer;
  v_last_duel_turn integer;

begin

  v_player_no :=
    public.protocol_current_player_no(
      p_game_code
    );

  if p_action not in (
    'done',
    'pass',
    'alternative',
    'duel'
  ) then
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

  select *
  into v_current_card
  from public.protocol_cards
  where id =
    v_game.current_card_id;

  if v_current_card.id is null then
    raise exception
      'Current card not found';
  end if;

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

        else
          1
      end;

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

      v_reward :=
        v_reward * 2;

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

      v_reward :=
        v_reward * 2;

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

  if p_action = 'duel' then

    if v_current_card.type <> 'duel' then
      raise exception
        'Current card is not a duel';
    end if;

    if p_duel_winner not in (1, 2) then
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

        else
          2
      end;

    if p_duel_winner = 1 then

      v_score_p1 :=
        v_score_p1 + v_reward;

    else

      v_score_p2 :=
        v_score_p2 + v_reward;

    end if;

  end if;

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

  if p_action <> 'alternative' then

    perform public.tick_game_rules(
      v_game.id
    );

  end if;

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

      v_next_player := 1;

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

      v_next_player := 2;

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
      v_game.turn_no + 1;

    v_next_phase :=
      public.protocol_phase(
        v_next_turn,
        v_game.target_turns
      );

  end if;

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

  v_player_sex :=
    case
      when v_next_player = 1
        then v_game.player_1_sex
      else
        v_game.player_2_sex
    end;

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

  v_remaining_turns :=
    v_game.target_turns
    - v_next_turn
    + 1;

  v_truth_needed :=
    greatest(
      5 - v_truth_count,
      0
    );

  v_late_truth_needed :=
    greatest(
      2 - v_truth_late_count,
      0
    );

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

  select *
  into v_card
  from public.protocol_cards c

  where c.active = true

    and c.library_version = 'v1'

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

    and (
      c.type <> 'duel'
      or
      (
        v_duel_count < 4

        and (
          v_last_duel_turn is null
          or
          v_next_turn
          - v_last_duel_turn
          >= 3
        )
      )
    )

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

    and c.intensity >=
      v_min_intensity_primary

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

    and public.protocol_scene_allowed(
      v_game.id,
      c.id,
      v_next_turn
    )

    and public.protocol_rule_card_allowed(
      v_game.id,
      c.id,
      v_next_player,
      v_next_turn
    )

    and not exists (
      select 1
      from public.game_card_history h
      where h.game_id =
        v_game.id
        and h.card_id =
          c.id
    )

  order by

    case
      when v_truth_required
           and c.type = 'truth'
        then -5000

      when v_truth_required
        then 5000

      else 0
    end,

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

  if v_card.id is null then

    select *
    into v_card
    from public.protocol_cards c

    where c.active = true

      and c.library_version =
        'v1'

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

      and (
        c.type <> 'duel'
        or
        (
          v_duel_count < 4

          and (
            v_last_duel_turn is null
            or
            v_next_turn
            - v_last_duel_turn
            >= 3
          )
        )
      )

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

      and c.intensity >=
        v_min_intensity_fallback

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

      and public.protocol_scene_allowed(
        v_game.id,
        c.id,
        v_next_turn
      )

      and public.protocol_rule_card_allowed(
        v_game.id,
        c.id,
        v_next_player,
        v_next_turn
      )

      and not exists (
        select 1
        from public.game_card_history h
        where h.game_id =
          v_game.id
          and h.card_id =
            c.id
      )

    order by

      case
        when v_truth_required
             and c.type = 'truth'
          then -5000

        when v_truth_required
          then 5000

        else 0
      end,

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

  if v_card.id is null then

    if v_forced_type is not null then
      raise exception
        'No unused compatible card of this type';
    else
      raise exception
        'No unused compatible card';
    end if;

  end if;

  if v_forced_by = 1 then

    v_bonus_p1 :=
      v_bonus_p1
      - 'choose_type_armed';

  elsif v_forced_by = 2 then

    v_bonus_p2 :=
      v_bonus_p2
      - 'choose_type_armed';

  end if;

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
  v_code text;
  v_game_id uuid;
  v_attempt integer := 0;
begin
  v_user_id := auth.uid();

  if v_user_id is null then
    raise exception 'Authentication required';
  end if;

  loop
    v_attempt := v_attempt + 1;

    if v_attempt > 20 then
      raise exception 'Unable to generate unique game code';
    end if;

    v_code := public.protocol_generate_game_code();

    begin
      insert into public.games (
        code,
        player_count,
        status,
        player_1_ready,
        player_2_ready
      )
      values (
        v_code,
        1,
        'waiting',
        false,
        false
      )
      returning id
      into v_game_id;

      exit;

    exception
      when unique_violation then
        null;
    end;
  end loop;

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

  return query
  select
    v_code,
    1;
end;
$$;


ALTER FUNCTION "public"."create_protocol_game"() OWNER TO "postgres";


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


CREATE OR REPLACE FUNCTION "public"."get_card_invitation_secure"("p_invitation_id" "uuid") RETURNS TABLE("id" "uuid", "card_id" bigint, "sender_user_id" "uuid", "recipient_user_id" "uuid", "couple_id" "uuid", "sent_at" timestamp with time zone, "opened_at" timestamp with time zone)
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
declare
  v_user_id uuid := auth.uid();
begin
  if v_user_id is null then
    raise exception 'Authentication required';
  end if;

  return query
  select
    ci.id,
    ci.card_id,
    ci.sender_user_id,
    ci.recipient_user_id,
    ci.couple_id,
    ci.sent_at,
    ci.opened_at
  from public.card_invitations ci
  where
    ci.id = p_invitation_id
    and (
      ci.sender_user_id = v_user_id
      or ci.recipient_user_id = v_user_id
    );
end;
$$;


ALTER FUNCTION "public"."get_card_invitation_secure"("p_invitation_id" "uuid") OWNER TO "postgres";


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
    SET "search_path" TO 'public'
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


CREATE OR REPLACE FUNCTION "public"."register_push_subscription_secure"("p_device_id" "uuid", "p_endpoint" "text", "p_p256dh" "text", "p_auth" "text", "p_user_agent" "text" DEFAULT NULL::"text") RETURNS "void"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
declare
  v_user_id uuid;
  v_couple_id uuid;
begin

  /*
   * L'identité vient exclusivement du JWT Supabase.
   */
  v_user_id := auth.uid();

  if v_user_id is null then
    raise exception 'Authentication required';
  end if;


  /*
   * Couple du compte connecté.
   */
  select m.couple_id
  into v_couple_id
  from public.protocol_couple_members m
  where m.user_id = v_user_id;

  if v_couple_id is null then
    raise exception 'User does not belong to a couple';
  end if;


  /*
   * Validation des données Push.
   */
  if p_device_id is null then
    raise exception 'device_id is required';
  end if;

  if coalesce(trim(p_endpoint), '') = '' then
    raise exception 'endpoint is required';
  end if;

  if coalesce(trim(p_p256dh), '') = '' then
    raise exception 'p256dh is required';
  end if;

  if coalesce(trim(p_auth), '') = '' then
    raise exception 'auth is required';
  end if;


  /*
   * Enregistrement / mise à jour.
   */
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
  )

  on conflict (endpoint)
  do update
  set
    device_id =
      excluded.device_id,

    user_id =
      excluded.user_id,

    couple_id =
      excluded.couple_id,

    p256dh =
      excluded.p256dh,

    auth =
      excluded.auth,

    user_agent =
      excluded.user_agent,

    active =
      true,

    updated_at =
      now(),

    last_seen_at =
      now();

end;
$$;


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

  v_card
    public.protocol_cards%rowtype;

  v_first_player integer;
  v_player_sex text;
  v_profile_intensity integer;
  v_max_intensity integer;
  v_phase text;
begin
  /*
   * AUTHORIZATION
   */
  v_player_no :=
    public.protocol_current_player_no(p_game_code);

  /*
   * GAME LOCK
   */
  select *
  into v_game
  from public.games
  where code = upper(trim(p_game_code))
  for update;

  if v_game.id is null then
    raise exception 'Game not found';
  end if;

  if v_game.status <> 'calibration_ready' then
    raise exception 'Game is not ready to start';
  end if;

  if v_game.shared_profile is null then
    raise exception 'Shared profile not found';
  end if;

  /*
   * FIRST PLAYER
   */
  v_first_player :=
    case
      when
        v_game.shared_profile
        ->> 'control_mode'
        = 'p2_leads'
      then 2
      else 1
    end;

  /*
   * PLAYER SEX
   */
  v_player_sex :=
    case
      when v_first_player = 1
        then v_game.player_1_sex
      else
        v_game.player_2_sex
    end;

  /*
   * PROFILE / INTENSITY
   */
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

  /*
   * FIRST CARD
   */
  select *
  into v_card
  from public.protocol_cards c
  where c.active = true
    and c.library_version = 'v1'
    and (
      c.target_sex is null
      or c.target_sex = v_player_sex
    )
    and c.intensity <= v_max_intensity
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
  order by random()
  limit 1;

  /*
   * FALLBACK
   */
  if v_card.id is null then
    select *
    into v_card
    from public.protocol_cards c
    where c.active = true
      and c.library_version = 'v1'
      and (
        c.target_sex is null
        or c.target_sex = v_player_sex
      )
      and c.intensity <= v_profile_intensity
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
    order by random()
    limit 1;
  end if;

  if v_card.id is null then
    raise exception 'No compatible card found';
  end if;

  /*
   * CLEAN HISTORY
   */
  delete from public.game_card_history
  where game_id = v_game.id;

  /*
   * START GAME
   */
  update public.games
  set
    status = 'playing',
    turn_no = 1,
    active_player = v_first_player,
    current_card_id = v_card.id,
    phase = v_phase,
    finished_at = null,
    score_player_1 = 0,
    score_player_2 = 0,
    bonus_player_1 = '{}'::jsonb,
    bonus_player_2 = '{}'::jsonb,
    scene_step_no =
      case
        when v_card.type = 'scene'
          then 1
        else null
      end,
    scene_step_read_player_1 = false,
    scene_step_read_player_2 = false
  where id = v_game.id;

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

  return jsonb_build_object(
    'started', true,
    'card_id', v_card.id,
    'card_type', v_card.type,
    'turn_no', 1,
    'active_player', v_first_player,
    'phase', v_phase,
    'target_turns', v_game.target_turns,
    'max_intensity', v_max_intensity,
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


CREATE OR REPLACE FUNCTION "public"."submit_calibration"("p_game_code" "text", "p_intensity" integer, "p_answers" "jsonb") RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
declare
  v_player_no integer;
  v_game_id uuid;
  v_count integer;

  v_p1 record;
  v_p2 record;

  v_control_1 text;
  v_control_2 text;
  v_control_mode text;

  v_shared jsonb;
begin
  v_player_no :=
    public.protocol_current_player_no(p_game_code);

  if p_intensity < 1 or p_intensity > 5 then
    raise exception 'Invalid intensity';
  end if;

  select g.id
  into v_game_id
  from public.games g
  where g.code = upper(trim(p_game_code))
  for update;

  if v_game_id is null then
    raise exception 'Game not found';
  end if;

  if not exists (
    select 1
    from public.games g
    where g.id = v_game_id
      and g.status in (
        'calibrating',
        'calibration_ready'
      )
  ) then
    raise exception 'Game is not in calibration';
  end if;

  insert into public.calibration_responses (
    game_id,
    player_no,
    intensity,
    answers
  )
  values (
    v_game_id,
    v_player_no,
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
  v_game_id uuid;
begin
  /*
   * Vérifie via auth.uid() que l'utilisateur
   * appartient bien à cette partie.
   */
  perform public.protocol_current_player_no(
    p_game_code
  );

  if p_remaining_seconds is null
     or p_remaining_seconds < 0
     or p_remaining_seconds > 86400
  then
    raise exception
      'Durée du timer invalide.';
  end if;

  select g.id
  into v_game_id
  from public.games g
  where g.code =
    upper(trim(p_game_code));

  if v_game_id is null then
    raise exception
      'Game not found';
  end if;

  if not exists (
    select 1
    from public.protocol_cards c
    where c.id = p_card_id
      and c.active = true
      and c.library_version = 'v1'
  ) then
    raise exception
      'Carte invalide.';
  end if;

  update public.games
  set
    timer_card_id =
      p_card_id,

    timer_started_at =
      case
        when p_running
          then coalesce(
            p_started_at,
            now()
          )
        else
          null
      end,

    timer_remaining_seconds =
      p_remaining_seconds,

    timer_running =
      p_running

  where id =
    v_game_id;

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

  if p_card_type not in (
    'truth',
    'action',
    'duel',
    'scene'
  ) then
    raise exception
      'Invalid card type';
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
      'Only active player can choose next type';
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
      ->> 'choose_type'
    )::boolean,
    false
  )
  then
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


ALTER FUNCTION "public"."use_choose_type"("p_game_code" "text", "p_card_type" "text") OWNER TO "postgres";


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
    "card_id" bigint NOT NULL,
    "sent_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "opened_at" timestamp with time zone,
    "sender_user_id" "uuid",
    "recipient_user_id" "uuid",
    "couple_id" "uuid"
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
    CONSTRAINT "games_active_player_check" CHECK (("active_player" = ANY (ARRAY[1, 2]))),
    CONSTRAINT "games_player_1_sex_check" CHECK ((("player_1_sex" IS NULL) OR ("player_1_sex" = ANY (ARRAY['female'::"text", 'male'::"text"])))),
    CONSTRAINT "games_player_2_sex_check" CHECK ((("player_2_sex" IS NULL) OR ("player_2_sex" = ANY (ARRAY['female'::"text", 'male'::"text"])))),
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
    "tension" smallint DEFAULT 1 NOT NULL,
    "sensations" smallint DEFAULT 1 NOT NULL,
    "unexpected" smallint DEFAULT 1 NOT NULL,
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
    CONSTRAINT "protocol_cards_intensity_check" CHECK ((("intensity" >= 1) AND ("intensity" <= 5))),
    CONSTRAINT "protocol_cards_lovense_duration_check" CHECK ((("lovense_duration_sec" IS NULL) OR (("lovense_duration_sec" >= 1) AND ("lovense_duration_sec" <= 600)))),
    CONSTRAINT "protocol_cards_lovense_intensity_check" CHECK ((("lovense_intensity" IS NULL) OR (("lovense_intensity" >= 0) AND ("lovense_intensity" <= 20)))),
    CONSTRAINT "protocol_cards_lovense_mode_check" CHECK ((("lovense_mode" IS NULL) OR ("lovense_mode" = ANY (ARRAY['optional'::"text", 'required'::"text"])))),
    CONSTRAINT "protocol_cards_sensations_check" CHECK ((("sensations" >= 1) AND ("sensations" <= 3))),
    CONSTRAINT "protocol_cards_target_sex_check" CHECK ((("target_sex" IS NULL) OR ("target_sex" = ANY (ARRAY['female'::"text", 'male'::"text"])))),
    CONSTRAINT "protocol_cards_tension_check" CHECK ((("tension" >= 1) AND ("tension" <= 3))),
    CONSTRAINT "protocol_cards_type_check" CHECK (("type" = ANY (ARRAY['truth'::"text", 'action'::"text", 'duel'::"text", 'scene'::"text"]))),
    CONSTRAINT "protocol_cards_unexpected_check" CHECK ((("unexpected" >= 1) AND ("unexpected" <= 3)))
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


CREATE TABLE IF NOT EXISTS "public"."protocol_couples" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "created_by" "uuid" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."protocol_couples" OWNER TO "postgres";


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



ALTER TABLE ONLY "public"."protocol_couples"
    ADD CONSTRAINT "protocol_couples_pkey" PRIMARY KEY ("id");



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



CREATE INDEX "card_invitations_sender_user_id_idx" ON "public"."card_invitations" USING "btree" ("sender_user_id");



CREATE UNIQUE INDEX "game_active_rules_source_unique" ON "public"."game_active_rules" USING "btree" ("game_id", "source_card_id", "rule_key") WHERE ("source_card_id" IS NOT NULL);



CREATE INDEX "game_card_history_game_idx" ON "public"."game_card_history" USING "btree" ("game_id");



CREATE INDEX "idx_game_active_rules_game_active" ON "public"."game_active_rules" USING "btree" ("game_id", "active");



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



ALTER TABLE ONLY "public"."calibration_responses"
    ADD CONSTRAINT "calibration_responses_game_id_fkey" FOREIGN KEY ("game_id") REFERENCES "public"."games"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."card_invitations"
    ADD CONSTRAINT "card_invitations_card_id_fkey" FOREIGN KEY ("card_id") REFERENCES "public"."protocol_cards"("id");



ALTER TABLE ONLY "public"."card_invitations"
    ADD CONSTRAINT "card_invitations_couple_id_fkey" FOREIGN KEY ("couple_id") REFERENCES "public"."protocol_couples"("id") ON DELETE SET NULL;



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
    ADD CONSTRAINT "game_card_history_game_id_fkey" FOREIGN KEY ("game_id") REFERENCES "public"."games"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."game_players"
    ADD CONSTRAINT "game_players_game_id_fkey" FOREIGN KEY ("game_id") REFERENCES "public"."games"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."game_players"
    ADD CONSTRAINT "game_players_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "auth"."users"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."games"
    ADD CONSTRAINT "games_current_card_id_fkey" FOREIGN KEY ("current_card_id") REFERENCES "public"."protocol_cards"("id");



ALTER TABLE ONLY "public"."games"
    ADD CONSTRAINT "games_timer_card_id_fkey" FOREIGN KEY ("timer_card_id") REFERENCES "public"."protocol_cards"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."protocol_card_rules"
    ADD CONSTRAINT "protocol_card_rules_card_id_fkey" FOREIGN KEY ("card_id") REFERENCES "public"."protocol_cards"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."protocol_couple_invites"
    ADD CONSTRAINT "protocol_couple_invites_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "auth"."users"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."protocol_couple_members"
    ADD CONSTRAINT "protocol_couple_members_couple_id_fkey" FOREIGN KEY ("couple_id") REFERENCES "public"."protocol_couples"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."protocol_couple_members"
    ADD CONSTRAINT "protocol_couple_members_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "auth"."users"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."protocol_couples"
    ADD CONSTRAINT "protocol_couples_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "auth"."users"("id") ON DELETE CASCADE;



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



ALTER TABLE "public"."game_active_rules" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."game_card_history" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."game_players" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."games" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."protocol_card_rules" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."protocol_cards" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "protocol_cards_select_authenticated" ON "public"."protocol_cards" FOR SELECT TO "authenticated" USING ((("active" = true) AND ("library_version" = 'v1'::"text")));



ALTER TABLE "public"."protocol_couple_invites" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."protocol_couple_members" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "protocol_couple_members_select_own" ON "public"."protocol_couple_members" FOR SELECT TO "authenticated" USING (("user_id" = "auth"."uid"()));



ALTER TABLE "public"."protocol_couples" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "protocol_couples_select_member" ON "public"."protocol_couples" FOR SELECT TO "authenticated" USING ((EXISTS ( SELECT 1
   FROM "public"."protocol_couple_members" "m"
  WHERE (("m"."couple_id" = "protocol_couples"."id") AND ("m"."user_id" = "auth"."uid"())))));



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


GRANT USAGE ON SCHEMA "public" TO "postgres";
GRANT USAGE ON SCHEMA "public" TO "anon";
GRANT USAGE ON SCHEMA "public" TO "authenticated";
GRANT USAGE ON SCHEMA "public" TO "service_role";



REVOKE ALL ON FUNCTION "public"."add_game_rule"("p_game_code" "text", "p_title" "text", "p_rule_text" "text", "p_target_player" integer, "p_duration_turns" integer, "p_rule_key" "text") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."add_game_rule"("p_game_code" "text", "p_title" "text", "p_rule_text" "text", "p_target_player" integer, "p_duration_turns" integer, "p_rule_key" "text") TO "service_role";
GRANT ALL ON FUNCTION "public"."add_game_rule"("p_game_code" "text", "p_title" "text", "p_rule_text" "text", "p_target_player" integer, "p_duration_turns" integer, "p_rule_key" "text") TO "authenticated";



REVOKE ALL ON FUNCTION "public"."advance_protocol"("p_game_code" "text", "p_action" "text", "p_duel_winner" integer) FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."advance_protocol"("p_game_code" "text", "p_action" "text", "p_duel_winner" integer) TO "service_role";
GRANT ALL ON FUNCTION "public"."advance_protocol"("p_game_code" "text", "p_action" "text", "p_duel_winner" integer) TO "authenticated";



REVOKE ALL ON FUNCTION "public"."advance_scene_step"("p_game_code" "text") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."advance_scene_step"("p_game_code" "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."advance_scene_step"("p_game_code" "text") TO "service_role";



REVOKE ALL ON FUNCTION "public"."buy_protocol_bonus"("p_game_code" "text", "p_bonus" "text") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."buy_protocol_bonus"("p_game_code" "text", "p_bonus" "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."buy_protocol_bonus"("p_game_code" "text", "p_bonus" "text") TO "service_role";



REVOKE ALL ON FUNCTION "public"."create_protocol_couple_invite"() FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."create_protocol_couple_invite"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."create_protocol_couple_invite"() TO "service_role";



REVOKE ALL ON FUNCTION "public"."create_protocol_game"() FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."create_protocol_game"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."create_protocol_game"() TO "service_role";



REVOKE ALL ON FUNCTION "public"."get_active_rules"("p_game_code" "text") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."get_active_rules"("p_game_code" "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."get_active_rules"("p_game_code" "text") TO "service_role";



REVOKE ALL ON FUNCTION "public"."get_card_invitation_secure"("p_invitation_id" "uuid") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."get_card_invitation_secure"("p_invitation_id" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."get_card_invitation_secure"("p_invitation_id" "uuid") TO "service_role";



REVOKE ALL ON FUNCTION "public"."get_card_invitation_status_secure"("p_invitation_id" "uuid") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."get_card_invitation_status_secure"("p_invitation_id" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."get_card_invitation_status_secure"("p_invitation_id" "uuid") TO "service_role";



REVOKE ALL ON FUNCTION "public"."get_protocol_couple"() FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."get_protocol_couple"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."get_protocol_couple"() TO "service_role";



REVOKE ALL ON FUNCTION "public"."get_protocol_final_stats"("p_game_code" "text") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."get_protocol_final_stats"("p_game_code" "text") TO "service_role";
GRANT ALL ON FUNCTION "public"."get_protocol_final_stats"("p_game_code" "text") TO "authenticated";



REVOKE ALL ON FUNCTION "public"."get_protocol_game"("p_game_code" "text") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."get_protocol_game"("p_game_code" "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."get_protocol_game"("p_game_code" "text") TO "service_role";



REVOKE ALL ON FUNCTION "public"."get_scene_state"("p_game_code" "text") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."get_scene_state"("p_game_code" "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."get_scene_state"("p_game_code" "text") TO "service_role";



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
GRANT ALL ON FUNCTION "public"."mark_scene_step_read"("p_game_code" "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."mark_scene_step_read"("p_game_code" "text") TO "service_role";



REVOKE ALL ON FUNCTION "public"."protocol_current_player_no"("p_game_code" "text") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."protocol_current_player_no"("p_game_code" "text") TO "service_role";



REVOKE ALL ON FUNCTION "public"."protocol_generate_game_code"() FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."protocol_generate_game_code"() TO "service_role";



REVOKE ALL ON FUNCTION "public"."protocol_last_scene_turn"("p_game_id" "uuid") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."protocol_last_scene_turn"("p_game_id" "uuid") TO "service_role";



REVOKE ALL ON FUNCTION "public"."protocol_last_type_turn"("p_game_id" "uuid", "p_type" "text") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."protocol_last_type_turn"("p_game_id" "uuid", "p_type" "text") TO "service_role";



REVOKE ALL ON FUNCTION "public"."protocol_max_intensity"("p_profile_intensity" integer, "p_turn_no" integer) FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."protocol_max_intensity"("p_profile_intensity" integer, "p_turn_no" integer) TO "service_role";



REVOKE ALL ON FUNCTION "public"."protocol_persistent_count"("p_game_id" "uuid") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."protocol_persistent_count"("p_game_id" "uuid") TO "service_role";



REVOKE ALL ON FUNCTION "public"."protocol_phase"("p_turn_no" integer, "p_target_turns" integer) FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."protocol_phase"("p_turn_no" integer, "p_target_turns" integer) TO "service_role";



REVOKE ALL ON FUNCTION "public"."protocol_player_has_active_rule"("p_game_id" "uuid", "p_player_no" integer) FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."protocol_player_has_active_rule"("p_game_id" "uuid", "p_player_no" integer) TO "service_role";



REVOKE ALL ON FUNCTION "public"."protocol_player_rule_count"("p_game_id" "uuid", "p_player_no" integer) FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."protocol_player_rule_count"("p_game_id" "uuid", "p_player_no" integer) TO "service_role";



REVOKE ALL ON FUNCTION "public"."protocol_rule_card_allowed"("p_game_id" "uuid", "p_card_id" bigint, "p_next_player" integer, "p_next_turn" integer) FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."protocol_rule_card_allowed"("p_game_id" "uuid", "p_card_id" bigint, "p_next_player" integer, "p_next_turn" integer) TO "service_role";



REVOKE ALL ON FUNCTION "public"."protocol_scene_allowed"("p_game_id" "uuid", "p_card_id" bigint, "p_next_turn" integer) FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."protocol_scene_allowed"("p_game_id" "uuid", "p_card_id" bigint, "p_next_turn" integer) TO "service_role";



REVOKE ALL ON FUNCTION "public"."protocol_scene_count"("p_game_id" "uuid") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."protocol_scene_count"("p_game_id" "uuid") TO "service_role";



REVOKE ALL ON FUNCTION "public"."protocol_type_count"("p_game_id" "uuid", "p_type" "text") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."protocol_type_count"("p_game_id" "uuid", "p_type" "text") TO "service_role";



REVOKE ALL ON FUNCTION "public"."protocol_type_count_window"("p_game_id" "uuid", "p_type" "text", "p_from_turn" integer, "p_to_turn" integer) FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."protocol_type_count_window"("p_game_id" "uuid", "p_type" "text", "p_from_turn" integer, "p_to_turn" integer) TO "service_role";



REVOKE ALL ON FUNCTION "public"."protocol_type_penalty"("p_game_id" "uuid", "p_candidate_type" "text", "p_current_type" "text") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."protocol_type_penalty"("p_game_id" "uuid", "p_candidate_type" "text", "p_current_type" "text") TO "service_role";



REVOKE ALL ON FUNCTION "public"."register_push_subscription_secure"("p_device_id" "uuid", "p_endpoint" "text", "p_p256dh" "text", "p_auth" "text", "p_user_agent" "text") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."register_push_subscription_secure"("p_device_id" "uuid", "p_endpoint" "text", "p_p256dh" "text", "p_auth" "text", "p_user_agent" "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."register_push_subscription_secure"("p_device_id" "uuid", "p_endpoint" "text", "p_p256dh" "text", "p_auth" "text", "p_user_agent" "text") TO "service_role";



REVOKE ALL ON FUNCTION "public"."rematch_protocol"("p_game_code" "text") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."rematch_protocol"("p_game_code" "text") TO "service_role";
GRANT ALL ON FUNCTION "public"."rematch_protocol"("p_game_code" "text") TO "authenticated";



REVOKE ALL ON FUNCTION "public"."save_protocol_identity"("p_game_code" "text") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."save_protocol_identity"("p_game_code" "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."save_protocol_identity"("p_game_code" "text") TO "service_role";



REVOKE ALL ON FUNCTION "public"."set_protocol_ready"("p_game_code" "text") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."set_protocol_ready"("p_game_code" "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."set_protocol_ready"("p_game_code" "text") TO "service_role";



REVOKE ALL ON FUNCTION "public"."start_protocol"("p_game_code" "text") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."start_protocol"("p_game_code" "text") TO "service_role";
GRANT ALL ON FUNCTION "public"."start_protocol"("p_game_code" "text") TO "authenticated";



REVOKE ALL ON FUNCTION "public"."submit_calibration"("p_game_code" "text", "p_intensity" integer, "p_answers" "jsonb") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."submit_calibration"("p_game_code" "text", "p_intensity" integer, "p_answers" "jsonb") TO "authenticated";
GRANT ALL ON FUNCTION "public"."submit_calibration"("p_game_code" "text", "p_intensity" integer, "p_answers" "jsonb") TO "service_role";



REVOKE ALL ON FUNCTION "public"."tick_game_rules"("p_game_id" "uuid") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."tick_game_rules"("p_game_id" "uuid") TO "service_role";



REVOKE ALL ON FUNCTION "public"."update_protocol_timer"("p_game_code" "text", "p_card_id" bigint, "p_started_at" timestamp with time zone, "p_remaining_seconds" integer, "p_running" boolean) FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."update_protocol_timer"("p_game_code" "text", "p_card_id" bigint, "p_started_at" timestamp with time zone, "p_remaining_seconds" integer, "p_running" boolean) TO "authenticated";
GRANT ALL ON FUNCTION "public"."update_protocol_timer"("p_game_code" "text", "p_card_id" bigint, "p_started_at" timestamp with time zone, "p_remaining_seconds" integer, "p_running" boolean) TO "service_role";



REVOKE ALL ON FUNCTION "public"."use_choose_type"("p_game_code" "text", "p_card_type" "text") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."use_choose_type"("p_game_code" "text", "p_card_type" "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."use_choose_type"("p_game_code" "text", "p_card_type" "text") TO "service_role";



REVOKE ALL ON FUNCTION "public"."use_take_control"("p_game_code" "text") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."use_take_control"("p_game_code" "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."use_take_control"("p_game_code" "text") TO "service_role";



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



GRANT ALL ON TABLE "public"."protocol_couples" TO "service_role";
GRANT SELECT ON TABLE "public"."protocol_couples" TO "authenticated";



GRANT ALL ON TABLE "public"."protocol_lovense_connections" TO "service_role";



GRANT ALL ON SEQUENCE "public"."protocol_lovense_connections_id_seq" TO "service_role";



GRANT ALL ON TABLE "public"."protocol_messages" TO "service_role";
GRANT SELECT ON TABLE "public"."protocol_messages" TO "authenticated";



GRANT ALL ON SEQUENCE "public"."protocol_messages_id_seq" TO "anon";
GRANT ALL ON SEQUENCE "public"."protocol_messages_id_seq" TO "authenticated";
GRANT ALL ON SEQUENCE "public"."protocol_messages_id_seq" TO "service_role";



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







