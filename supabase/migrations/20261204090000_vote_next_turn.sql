-- =========================================================
-- Carte « Oui / Non » : l'envie commune sort au tour suivant,
-- et le vote se joue aussi sur un seul téléphone (26/11/2026)
--
-- - L'envie commune est la carte du tour suivant. Si elle est pour
--   celui qui vient de jouer, il garde la main pour ce tour-là (comme
--   l'ancien « prendre la main »), puis l'alternance reprend.
-- - Un seul téléphone : chacun vote à son tour, en se passant le
--   téléphone (cast_protocol_vote_as). La carte courante dit où en est
--   chaque joueur, sans jamais ses réponses.
-- - Pas de carte scellée le tour où le vote s'ouvre.
--
-- Migration rejouable.
-- =========================================================

create or replace function public.cast_protocol_vote(
  p_game_code text,
  p_position integer,
  p_yes boolean
)
returns jsonb
language plpgsql
security definer
set search_path to ''
as $$
declare
  v_player integer;
  v_game public.games%rowtype;
  v_row public.protocol_game_votes%rowtype;
  v_total integer;
  v_done integer;
  v_pick public.protocol_game_votes%rowtype;
begin
  v_player := public.protocol_current_player_no(p_game_code);

  select * into v_game from public.games
  where code = upper(trim(p_game_code))
  for update;

  if v_game.id is null then
    raise exception 'Game not found';
  end if;
  if v_game.vote_status is distinct from 'open' then
    raise exception 'No vote in progress';
  end if;
  if p_yes is null then
    raise exception 'Vote required';
  end if;

  select * into v_row from public.protocol_game_votes
  where game_id = v_game.id and position = p_position;

  if v_row.game_id is null then
    raise exception 'Unknown vote card';
  end if;

  if (v_player = 1 and v_row.vote_p1 is not null) or (v_player = 2 and v_row.vote_p2 is not null) then
    raise exception 'Vote already cast';
  end if;

  if v_player = 1 then
    update public.protocol_game_votes set vote_p1 = p_yes
    where game_id = v_game.id and position = p_position;
  else
    update public.protocol_game_votes set vote_p2 = p_yes
    where game_id = v_game.id and position = p_position;
  end if;

  select count(*), count(*) filter (where vote_p1 is not null and vote_p2 is not null)
  into v_total, v_done
  from public.protocol_game_votes where game_id = v_game.id;

  -- le compteur fait réagir l'autre téléphone (« Théo trie encore… 3 / 5 »)
  if v_done < v_total then
    update public.games
    set vote_count_p1 = (select count(*) from public.protocol_game_votes where game_id = v_game.id and vote_p1 is not null),
        vote_count_p2 = (select count(*) from public.protocol_game_votes where game_id = v_game.id and vote_p2 is not null)
    where id = v_game.id;

    return jsonb_build_object('status', 'open');
  end if;

  -- tout le monde a voté : une seule envie commune, tirée au hasard
  select * into v_pick from public.protocol_game_votes
  where game_id = v_game.id and vote_p1 and vote_p2
  order by random()
  limit 1;

  if v_pick.game_id is null then
    update public.games
    set vote_status = 'done', vote_result = 'none',
        vote_count_p1 = v_total, vote_count_p2 = v_total
    where id = v_game.id;

    return jsonb_build_object('status', 'done', 'result', 'none');
  end if;

  -- elle sort au tour suivant ; si elle est pour celui qui vient de
  -- jouer, il garde la main pour ce tour
  update public.games
  set vote_status = 'done',
      vote_result = 'match',
      vote_card_id = v_pick.card_id,
      vote_for_player = v_pick.for_player,
      vote_play_turn = v_game.turn_no + 1,
      vote_count_p1 = v_total,
      vote_count_p2 = v_total,
      bonus_player_1 = case
        when v_pick.for_player = 1 and v_game.active_player = 1
          then coalesce(bonus_player_1, '{}'::jsonb) || '{"take_control_armed": true}'::jsonb
        else bonus_player_1 end,
      bonus_player_2 = case
        when v_pick.for_player = 2 and v_game.active_player = 2
          then coalesce(bonus_player_2, '{}'::jsonb) || '{"take_control_armed": true}'::jsonb
        else bonus_player_2 end
  where id = v_game.id;

  return jsonb_build_object('status', 'done', 'result', 'match');
end;
$$;

revoke all on function public.cast_protocol_vote(text, integer, boolean) from public, anon;
grant execute on function public.cast_protocol_vote(text, integer, boolean) to authenticated;

-- un seul téléphone : on vote au nom de celui qui tient le téléphone
create or replace function public.cast_protocol_vote_as(
  p_game_code text,
  p_player_no integer,
  p_position integer,
  p_yes boolean
)
returns jsonb
language plpgsql
security definer
set search_path to ''
as $$
begin
  perform public.protocol_act_as(p_game_code, p_player_no);
  return public.cast_protocol_vote(p_game_code, p_position, p_yes);
end;
$$;

revoke all on function public.cast_protocol_vote_as(text, integer, integer, boolean) from public, anon;
grant execute on function public.cast_protocol_vote_as(text, integer, integer, boolean) to authenticated;


-- le vote s'ouvre aussi sur un seul téléphone
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

    -- le vote s'ouvre (une fois, pas avec un thème choisi en attente)
    if v_game.vote_enabled
       and v_game.vote_status is null
       and p_next_turn >= public.protocol_vote_turn(v_game)
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


-- carte courante : l'avancée de chacun (jamais ses réponses), pour
-- savoir sur un seul téléphone à qui le passer
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
