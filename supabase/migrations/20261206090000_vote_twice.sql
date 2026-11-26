-- =========================================================
-- Carte « Oui / Non » : deux votes par partie (26/11/2026)
--
-- Le premier vers 30-45 % de la partie, le second vers 60-75 %, une
-- fois l'envie commune du premier jouée. Chacun a ses cinq cartes et
-- sa propre envie commune, qui sort au tour suivant.
-- Migration rejouable.
-- =========================================================

alter table public.games
  add column if not exists vote_round smallint not null default 0;

-- tour du vote n° p_round (1 ou 2), fixé par la partie
create or replace function public.protocol_vote_turn_round(p_game public.games, p_round integer)
returns integer
language sql
immutable
set search_path to ''
as $$
  select case
    when p_round <= 1 then
      greatest(4, round(coalesce(p_game.target_turns, 20) * 0.3)::integer)
        + abs(hashtext(p_game.id::text)) % greatest(1, round(coalesce(p_game.target_turns, 20) * 0.15)::integer)
    else
      greatest(6, round(coalesce(p_game.target_turns, 20) * 0.6)::integer)
        + abs(hashtext(p_game.id::text || '2')) % greatest(1, round(coalesce(p_game.target_turns, 20) * 0.15)::integer)
  end
$$;

revoke all on function public.protocol_vote_turn_round(public.games, integer) from public, anon, authenticated;

create or replace function public.protocol_vote_on_game_change()
returns trigger
language plpgsql
security definer
set search_path to ''
as $$
begin
  if tg_op = 'INSERT' then
    new.vote_enabled := public.protocol_vote_setting(new.couple_id);
    new.vote_status := null;
    new.vote_round := 0;
    return new;
  end if;

  -- revanche : tout repart de zéro
  if old.status = 'finished' and new.status is distinct from 'finished' then
    new.vote_enabled := public.protocol_vote_setting(new.couple_id);
    new.vote_status := null;
    new.vote_round := 0;
    new.vote_turn := null;
    new.vote_result := null;
    new.vote_card_id := null;
    new.vote_for_player := null;
    new.vote_play_turn := null;
    new.vote_played_turn := null;
    new.vote_count_p1 := 0;
    new.vote_count_p2 := 0;
    delete from public.protocol_game_votes where game_id = new.id;
    return new;
  end if;

  if new.current_card_id is not distinct from old.current_card_id
     and new.current_custom_card_id is not distinct from old.current_custom_card_id
     and new.turn_no is not distinct from old.turn_no then
    return new;
  end if;

  -- pendant le vote, la partie attend
  if old.vote_status = 'open' and new.status = 'playing' then
    raise exception 'Vote in progress';
  end if;

  -- un nouveau vote : l'état du précédent repart à zéro
  if nullif(current_setting('protocol.vote_open', true), '') = '1' and new.status = 'playing' then
    perform set_config('protocol.vote_open', '', true);
    new.vote_status := 'open';
    new.vote_turn := new.turn_no;
    new.vote_round := coalesce(old.vote_round, 0) + 1;
    new.vote_result := null;
    new.vote_card_id := null;
    new.vote_for_player := null;
    new.vote_play_turn := null;
    new.vote_played_turn := null;
    new.vote_count_p1 := 0;
    new.vote_count_p2 := 0;
  end if;

  if nullif(current_setting('protocol.vote_pick', true), '') = '1' and new.status = 'playing' then
    perform set_config('protocol.vote_pick', '', true);
    new.vote_played_turn := new.turn_no;
  end if;

  return new;
end;
$$;

revoke all on function public.protocol_vote_on_game_change() from public, anon, authenticated;

-- les cinq cartes : jamais celles du vote précédent
create or replace function public.protocol_vote_prepare(
  p_game public.games,
  p_next_player integer,
  p_next_turn integer
)
returns integer
language plpgsql
security definer
set search_path to ''
as $$
declare
  v_player integer;
  v_try jsonb;
  v_best jsonb;
  v_best_spice integer;
  v_spice integer;
  v_card bigint;
  v_cards bigint[] := array[]::bigint[];
  v_players integer[] := array[]::integer[];
  v_order integer[];
  i integer;
  j integer;
begin
  for i in 1..5 loop
    v_player := case when i <= 3 then p_next_player else 3 - p_next_player end;
    v_best := null;

    for j in 1..6 loop
      v_try := public.protocol_select_card_v2_base(p_game.id, v_player, p_next_turn, 'action');
      if v_try is not null
         and v_try ->> 'card_source' = 'official'
         and not ((v_try ->> 'official_card_id')::bigint = any (v_cards))
         -- jamais une carte déjà proposée au vote précédent
         and not exists (
           select 1 from public.protocol_game_votes pv
           where pv.game_id = p_game.id
             and pv.card_id = (v_try ->> 'official_card_id')::bigint
         )
         and not exists (
           select 1 from public.protocol_card_rules r
           where r.card_id = (v_try ->> 'official_card_id')::bigint and r.active
         ) then
        select public.protocol_family_spice(c.family_key) into v_spice
        from public.protocol_cards c where c.id = (v_try ->> 'official_card_id')::bigint;

        if v_best is null or v_spice > v_best_spice then
          v_best := v_try;
          v_best_spice := v_spice;
        end if;
      end if;
    end loop;

    if v_best is not null then
      v_cards := v_cards || (v_best ->> 'official_card_id')::bigint;
      v_players := v_players || v_player;
    end if;
  end loop;

  -- moins de trois cartes : pas de vote dans cette partie
  if coalesce(array_length(v_cards, 1), 0) < 3 then
    return 0;
  end if;

  -- ordre mélangé : on ne devine pas pour qui vient la suivante
  select array_agg(k order by random()) into v_order
  from generate_series(1, array_length(v_cards, 1)) k;

  delete from public.protocol_game_votes where game_id = p_game.id;

  for i in 1..array_length(v_cards, 1) loop
    insert into public.protocol_game_votes (game_id, position, card_id, for_player)
    values (p_game.id, i, v_cards[v_order[i]], v_players[v_order[i]]);
  end loop;

  return array_length(v_cards, 1);
end;
$$;

revoke all on function public.protocol_vote_prepare(public.games, integer, integer) from public, anon, authenticated;

-- parties en cours : un vote déjà tenu compte pour le premier
update public.games set vote_round = 1
where vote_round = 0 and vote_status is not null;


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

  -- pas de carte scellée le tour du vote : une seule surprise à la fois
  if v_opened then
    perform set_config('protocol.sealed_next', '', true);
  end if;

  return v_card;
end;
$$;

revoke all on function public.protocol_select_card_v2_unified(uuid, integer, integer, text) from public, anon, authenticated;


create or replace function public.get_protocol_current_card(p_game_code text)
returns jsonb
language plpgsql
security definer
set search_path to ''
as $$
declare
  v_card jsonb;
  v_game public.games%rowtype;
  v_extra jsonb;
  v_player integer;
  v_vote jsonb;
  v_source text;
  v_card_id bigint;
  v_partner uuid;
begin
  v_card := public.get_protocol_current_card_base(p_game_code);
  v_player := public.protocol_current_player_no(p_game_code);

  select * into v_game from public.games g where g.code = upper(trim(p_game_code));

  v_source := v_card ->> 'card_source';
  v_card_id := case when v_source = 'custom' then (v_card ->> 'custom_card_id')::bigint
                    else (v_card ->> 'official_card_id')::bigint end;

  select m.user_id into v_partner
  from public.protocol_couple_members m
  where m.couple_id = v_game.couple_id and m.user_id <> auth.uid()
  limit 1;

  if v_game.vote_status = 'open' then
    select jsonb_build_object(
      'status', 'open',
      'round', v_game.vote_round,
      'mine', case when v_player = 1 then v_game.vote_count_p1 else v_game.vote_count_p2 end,
      'partner', case when v_player = 1 then v_game.vote_count_p2 else v_game.vote_count_p1 end,
      'count_p1', v_game.vote_count_p1,
      'count_p2', v_game.vote_count_p2,
      'cards', coalesce(jsonb_agg(jsonb_build_object(
        'position', v.position,
        'for_player', v.for_player,
        'type', c.type,
        'intensity', c.intensity,
        'title', c.title,
        'prompt', c.prompt,
        'voted', case when v_player = 1 then v.vote_p1 is not null else v.vote_p2 is not null end,
        'voted_p1', v.vote_p1 is not null,
        'voted_p2', v.vote_p2 is not null
      ) order by v.position), '[]'::jsonb)
    )
    into v_vote
    from public.protocol_game_votes v
    join public.protocol_cards c on c.id = v.card_id
    where v.game_id = v_game.id;
  elsif v_game.vote_status = 'done' and v_game.vote_turn = v_game.turn_no then
    select jsonb_build_object(
      'status', 'done',
      'round', v_game.vote_round,
      'result', v_game.vote_result,
      'card', case when v_game.vote_result = 'match' then jsonb_build_object(
        'for_player', v_game.vote_for_player,
        'type', c.type,
        'intensity', c.intensity,
        'title', c.title,
        'prompt', c.prompt,
        'next', true
      ) end
    )
    into v_vote
    from (select 1) one
    left join public.protocol_cards c on c.id = v_game.vote_card_id;
  end if;

  v_extra := jsonb_build_object(
    'alternative_used', coalesce(v_game.alternative_used, false),
    'desire', case when v_game.desire_category is null then null
                   else jsonb_build_object('category', v_game.desire_category, 'by', v_game.desire_by) end,
    'vote', v_vote,
    'vote_pick', v_game.vote_played_turn is not null
                 and v_game.vote_played_turn = v_game.turn_no
                 and v_source = 'official'
                 and v_card_id = v_game.vote_card_id,
    'liked', jsonb_build_object(
      'me', (select r.rating from public.protocol_card_ratings r
             where r.user_id = auth.uid() and r.card_source = v_source and r.card_id = v_card_id
               and r.rating in ('fire', 'like')),
      'partner', (select r.rating from public.protocol_card_ratings r
                  where r.user_id = v_partner and r.card_source = v_source and r.card_id = v_card_id
                    and r.rating in ('fire', 'like'))
    )
  );

  if v_game.vote_status = 'open' or v_game.sealed_status = 'pending' then
    return jsonb_build_object(
      'id', v_card -> 'id',
      'card_source', v_card -> 'card_source',
      'source_id', v_card -> 'source_id',
      'official_card_id', v_card -> 'official_card_id',
      'custom_card_id', v_card -> 'custom_card_id',
      'type', v_card -> 'type',
      'intensity', v_card -> 'intensity',
      'title', case when v_game.sealed_status = 'pending' then 'Carte scellée' else '' end,
      'prompt', '',
      'sealed', case when v_game.sealed_status = 'pending' then 'pending' end
    ) || v_extra - 'liked';
  end if;

  if v_game.sealed_status = 'accepted' then
    return v_card || '{"sealed": "accepted"}'::jsonb || v_extra;
  end if;

  return v_card || v_extra;
end;
$$;

revoke all on function public.get_protocol_current_card(text) from public, anon;
grant execute on function public.get_protocol_current_card(text) to authenticated;
