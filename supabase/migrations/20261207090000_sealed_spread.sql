-- =========================================================
-- Cartes scellées : une par joueur, réparties (26/11/2026)
--
-- Avant : quatre par partie, avec une chance qui grimpait en fin de
-- partie ; en simulation, elles s'enchaînaient souvent (un tour sur
-- trois d'écart à 1) et se tassaient sur les derniers tours.
-- Désormais : deux par partie, une par joueur. Les tours sont fixés
-- par la partie : une dans la première moitié (tours 4 à mi-partie),
-- une dans la seconde ; elle arrive au tour prévu ou au premier tour
-- suivant possible pour le joueur qui n'en a pas encore eu. Jamais le
-- tour d'un vote, d'une envie commune, d'une carte perso ou d'un
-- thème choisi (« L'envie »).
--
-- Le tirage interne perd sa propre décision de carte scellée ; le
-- relais (protocol_select_card_v2_unified) décide. Migration rejouable.
-- =========================================================

-- 1. TIRAGE INTERNE, SANS CARTE SCELLÉE

create or replace function public.protocol_select_card_v2_inner(
  p_game_id uuid,
  p_next_player integer,
  p_next_turn integer,
  p_forced_type text default null
)
returns jsonb
language plpgsql
security definer
set search_path to ''
as $$
declare
  v_game public.games%rowtype;
  v_cat text;
  v_by integer;
  v_pick jsonb;
  v_normal jsonb;
  v_try jsonb;
  v_best jsonb;
  v_best_spice integer;
  v_spice integer;
  v_used integer;
  v_left integer;
  v_new_turn boolean;
  v_custom jsonb;
  v_custom_drawn integer;
  v_custom_target integer;
  v_ceiling integer;
  v_sex text;
  v_current_type text;
  i integer;
begin
  select * into v_game from public.games where id = p_game_id;
  v_new_turn := v_game.id is not null and p_next_turn > coalesce(v_game.turn_no, 0);

  -- L'envie : armée pour le prochain tour, ou thème du tour en cours
  -- quand on demande une autre proposition
  if v_game.id is not null and p_forced_type is null then
    if v_new_turn then
      if coalesce(v_game.bonus_player_1 ->> 'desire_armed', '') <> '' then
        v_cat := v_game.bonus_player_1 ->> 'desire_armed'; v_by := 1;
      elsif coalesce(v_game.bonus_player_2 ->> 'desire_armed', '') <> '' then
        v_cat := v_game.bonus_player_2 ->> 'desire_armed'; v_by := 2;
      end if;
    elsif v_game.desire_category is not null then
      v_cat := v_game.desire_category; v_by := v_game.desire_by;
    end if;
  end if;

  if v_cat is not null then
    perform set_config('protocol.desire_category', v_cat, true);
    v_pick := public.protocol_select_card_v2_base(p_game_id, p_next_player, p_next_turn, null);
    perform set_config('protocol.desire_category', '', true);

    if v_pick is not null then
      perform set_config('protocol.desire_result', v_by || '|ok|' || v_cat, true);
      return v_pick;
    end if;

    -- aucun carte possible dans ce thème : l'envie est rendue
    if v_new_turn then
      perform set_config('protocol.desire_result', v_by || '|refund|', true);
    end if;
  end if;

  -- cartes perso : une à deux par partie quand le couple en a écrit
  -- (au plafond du moment, pour le bon joueur, jamais deux duels de suite)
  if v_game.id is not null and v_new_turn and p_next_turn >= 3
     and p_next_turn < coalesce(v_game.target_turns, 20) then
    select count(*) into v_custom_drawn
    from public.game_card_history h
    where h.game_id = p_game_id and h.card_source = 'custom';

    -- une ou deux selon la partie (fixé par la partie, pas au hasard
    -- à chaque tour), jamais plus que les cartes écrites
    select least(1 + abs(hashtext(p_game_id::text)) % 2, count(*)) into v_custom_target
    from public.protocol_custom_cards c
    where c.couple_id = v_game.couple_id and c.active;

    if v_custom_drawn < v_custom_target
       and random() < (v_custom_target - v_custom_drawn)::numeric
                     / greatest(1, coalesce(v_game.target_turns, 20) - p_next_turn) then
      v_ceiling := public.protocol_max_intensity(
        greatest(1, least(5, coalesce((v_game.shared_profile ->> 'intensity')::integer, 1))),
        p_next_turn,
        v_game.target_turns
      );
      v_sex := case when p_next_player = 1 then v_game.player_1_sex else v_game.player_2_sex end;
      v_current_type := case
        when v_game.current_card_source = 'custom' then
          (select c.type from public.protocol_custom_cards c where c.id = v_game.current_custom_card_id)
        else
          (select c.type from public.protocol_cards c where c.id = v_game.current_card_id)
      end;

      select jsonb_build_object(
        'card_source', 'custom',
        'source_id', c.source_id,
        'official_card_id', null,
        'custom_card_id', c.custom_card_id,
        'type', c.type,
        'intensity', c.intensity,
        'timer_seconds', c.timer_seconds
      )
      into v_custom
      from public.protocol_playable_cards c
      where c.card_source = 'custom'
        and c.active
        and c.couple_id = v_game.couple_id
        and (c.target_sex is null or c.target_sex = v_sex)
        and c.intensity <= v_ceiling
        and (p_forced_type is null or c.type = p_forced_type)
        and not (c.type = 'duel' and v_current_type = 'duel')
        and not exists (
          select 1 from public.game_card_history h
          where h.game_id = p_game_id
            and h.card_source = 'custom'
            and h.custom_card_id = c.custom_card_id
        )
      order by random()
      limit 1;

      if v_custom is not null then
        return v_custom;
      end if;
    end if;
  end if;

  -- (les cartes scellées sont décidées par le relais, réparties sur la partie)
  return public.protocol_select_card_v2_base(p_game_id, p_next_player, p_next_turn, p_forced_type);
end;
$$;

revoke all on function public.protocol_select_card_v2_inner(uuid, integer, integer, text) from public, anon, authenticated;


-- 2. LES DEUX TOURS PRÉVUS POUR LA PARTIE

create or replace function public.protocol_sealed_turns(p_game public.games)
returns integer[]
language sql
immutable
set search_path to ''
as $$
  with w as (
    select coalesce(p_game.target_turns, 20) as t,
           (4 + coalesce(p_game.target_turns, 20) - 1) / 2 as half
  )
  select array[
    4 + abs(hashtext(p_game.id::text || 's1')) % greatest(1, half - 4),
    half + 1 + abs(hashtext(p_game.id::text || 's2')) % greatest(1, (t - 1) - (half + 1))
  ]
  from w
$$;

revoke all on function public.protocol_sealed_turns(public.games) from public, anon, authenticated;


-- 3. LA CARTE SCELLÉE : la famille la plus pimentée parmi plusieurs
--    tirages d'action, au niveau du moment, sans règle de durée

create or replace function public.protocol_sealed_pick(
  p_game public.games,
  p_player integer,
  p_turn integer
)
returns jsonb
language plpgsql
security definer
set search_path to ''
as $$
declare
  v_try jsonb;
  v_best jsonb;
  v_best_spice integer;
  v_spice integer;
  i integer;
begin
  for i in 1..12 loop
    v_try := public.protocol_select_card_v2_base(p_game.id, p_player, p_turn, 'action');
    if v_try is not null
       and v_try ->> 'card_source' = 'official'
       and not exists (
         select 1 from public.protocol_card_rules r
         where r.card_id = (v_try ->> 'official_card_id')::bigint and r.active
       ) then
      select public.protocol_family_spice(c.family_key) into v_spice
      from public.protocol_cards c where c.id = (v_try ->> 'official_card_id')::bigint;

      if v_best is null
         or v_spice > v_best_spice
         or (v_spice = v_best_spice
             and (v_try ->> 'intensity')::integer > (v_best ->> 'intensity')::integer) then
        v_best := v_try;
        v_best_spice := v_spice;
      end if;
    end if;
  end loop;

  return v_best;
end;
$$;

revoke all on function public.protocol_sealed_pick(public.games, integer, integer) from public, anon, authenticated;


-- 4. LE RELAIS DÉCIDE

create or replace function public.protocol_select_card_v2_unified(
  p_game_id uuid,
  p_next_player integer,
  p_next_turn integer,
  p_forced_type text default null
)
returns jsonb
language plpgsql
security definer
set search_path to ''
as $$
declare
  v_game public.games%rowtype;
  v_new_turn boolean;
  v_pick jsonb;
  v_opened boolean := false;
  v_card jsonb;
  v_sealed jsonb;
begin
  select * into v_game from public.games where id = p_game_id;
  v_new_turn := v_game.id is not null and p_next_turn > coalesce(v_game.turn_no, 0);

  if v_new_turn and p_forced_type is null and v_game.status = 'playing' then

    -- l'envie commune, au tour de son joueur
    if v_game.vote_result = 'match'
       and v_game.vote_played_turn is null
       and v_game.vote_for_player = p_next_player
       and p_next_turn >= v_game.vote_play_turn then
      select jsonb_build_object(
        'card_source', 'official',
        'source_id', c.source_id,
        'official_card_id', c.official_card_id,
        'custom_card_id', null,
        'type', c.type,
        'intensity', c.intensity,
        'timer_seconds', c.timer_seconds
      )
      into v_pick
      from public.protocol_playable_cards c
      where c.card_source = 'official'
        and c.official_card_id = v_game.vote_card_id
        and not exists (
          select 1 from public.game_card_history h
          where h.game_id = p_game_id
            and h.card_source = 'official'
            and h.card_id = v_game.vote_card_id
        )
      limit 1;

      if v_pick is not null then
        perform set_config('protocol.vote_pick', '1', true);
        return v_pick;
      end if;
    end if;

    -- un vote s'ouvre (deux par partie, pas avec un thème choisi en
    -- attente ; le second une fois l'envie du premier jouée)
    if v_game.vote_enabled
       and coalesce(v_game.vote_round, 0) < 2
       and (v_game.vote_status is null
            or (v_game.vote_status = 'done'
                and (v_game.vote_result = 'none' or v_game.vote_played_turn is not null)))
       and p_next_turn >= public.protocol_vote_turn_round(v_game, coalesce(v_game.vote_round, 0) + 1)
       and p_next_turn <= coalesce(v_game.target_turns, 20) - 3
       and coalesce(v_game.bonus_player_1 ->> 'desire_armed', '') = ''
       and coalesce(v_game.bonus_player_2 ->> 'desire_armed', '') = '' then
      if public.protocol_vote_prepare(v_game, p_next_player, p_next_turn) > 0 then
        perform set_config('protocol.vote_open', '1', true);
        v_opened := true;
      end if;
    end if;
  end if;

  v_card := public.protocol_select_card_v2_inner(p_game_id, p_next_player, p_next_turn, p_forced_type);

  -- carte scellée : une par joueur, aux tours prévus pour la partie
  -- (une dans chaque moitié), jamais le tour d'un vote ni celui d'une
  -- envie, d'une carte perso ou d'un thème choisi
  if v_new_turn
     and p_forced_type is null
     and v_game.status = 'playing'
     and v_game.sealed_enabled
     and not v_opened
     and v_card is not null
     and v_card ->> 'card_source' = 'official'
     and coalesce(current_setting('protocol.desire_result', true), '') not like '%|ok|%'
     and p_next_turn < coalesce(v_game.target_turns, 20)
     and (case when p_next_player = 1 then v_game.sealed_used_p1 else v_game.sealed_used_p2 end) = 0
     and v_game.sealed_used_p1 + v_game.sealed_used_p2 < 2
     and p_next_turn >= (public.protocol_sealed_turns(v_game))[v_game.sealed_used_p1 + v_game.sealed_used_p2 + 1] then
    v_sealed := public.protocol_sealed_pick(v_game, p_next_player, p_next_turn);
    if v_sealed is not null then
      perform set_config('protocol.sealed_next', '1', true);
      return v_sealed;
    end if;
  end if;

  return v_card;
end;
$$;

revoke all on function public.protocol_select_card_v2_unified(uuid, integer, integer, text) from public, anon, authenticated;
