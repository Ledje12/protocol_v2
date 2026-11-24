-- =========================================================
-- Cartes perso : toujours une ou deux par partie (29/11/2026)
--
-- La version précédente tirait les cartes perso avec une marge de
-- hasard (x 0,8) : une partie pouvait finir sans aucune. La chance
-- monte maintenant jusqu'à 1 au dernier tour possible : chaque
-- partie a sa ou ses cartes perso, tant qu'une carte écrite convient
-- au joueur et au niveau du moment.
--
-- Migration rejouable sans risque.
-- =========================================================

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

  v_normal := public.protocol_select_card_v2_base(p_game_id, p_next_player, p_next_turn, p_forced_type);

  -- carte scellée : un vrai nouveau tour, sans type imposé, du 4e tour
  -- à l'avant-dernier, deux fois par joueur au plus
  if v_normal is null
     or v_game.id is null
     or not v_game.sealed_enabled
     or p_forced_type is not null
     or v_game.status <> 'playing'
     or not v_new_turn
     or p_next_turn < 4
     or p_next_turn >= coalesce(v_game.target_turns, 20) then
    return v_normal;
  end if;

  v_used := case when p_next_player = 1 then v_game.sealed_used_p1 else v_game.sealed_used_p2 end;
  if v_used >= 2 then
    return v_normal;
  end if;

  v_left := greatest(1, ceil((coalesce(v_game.target_turns, 20) - p_next_turn) / 2.0)::integer);
  if random() >= (2 - v_used)::numeric / v_left then
    return v_normal;
  end if;

  -- au niveau de la montée du moment : c'est la famille la plus
  -- pimentée, parmi plusieurs tirages, qui rend la carte plus chaude
  for i in 1..12 loop
    v_try := public.protocol_select_card_v2_base(p_game_id, p_next_player, p_next_turn, 'action');
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

  if v_best is null then
    return v_normal;
  end if;

  perform set_config('protocol.sealed_next', '1', true);
  return v_best;
end;
$$;

revoke all on function public.protocol_select_card_v2_unified(uuid, integer, integer, text)
  from public, anon, authenticated;
