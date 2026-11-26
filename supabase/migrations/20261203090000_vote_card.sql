-- =========================================================
-- Carte « Oui / Non » et cartes déjà aimées (26/11/2026)
--
-- Une fois par partie, en phase Montée ou Intensité, cinq cartes
-- défilent sur les deux téléphones : trois pour celui qui a la main,
-- deux pour l'autre, chacune telle qu'elle sortira. Chacun dit oui
-- ou non, en secret. Parmi les oui communs, une seule carte est
-- tirée : elle arrive dans les tours suivants, au tour de son joueur
-- (pas forcément le suivant). On ne sait ni combien de oui communs il
-- y avait, ni ce que l'autre a refusé.
--
-- La carte du tour reste tirée normalement, masquée le temps du vote.
-- Réglage du couple (règles de la partie), actif par défaut, figé
-- pour chaque partie à sa création (et à la revanche). Pas en mode
-- un seul téléphone.
--
-- Carte courante : en plus, les avis déjà donnés sur cette carte
-- (« Audrey l'avait adorée »).
--
-- Le tirage existant est renommé protocol_select_card_v2_inner et
-- appelé par un relais du même nom qu'avant. Migration rejouable.
-- =========================================================

-- ---------------------------------------------------------
-- 1. COLONNES ET TABLE
-- ---------------------------------------------------------

alter table public.protocol_couple_settings
  add column if not exists vote_enabled boolean not null default true;

alter table public.games
  add column if not exists vote_enabled boolean not null default false,
  add column if not exists vote_status text,
  add column if not exists vote_turn smallint,
  add column if not exists vote_result text,
  add column if not exists vote_card_id bigint,
  add column if not exists vote_for_player smallint,
  add column if not exists vote_play_turn smallint,
  add column if not exists vote_played_turn smallint,
  add column if not exists vote_count_p1 smallint not null default 0,
  add column if not exists vote_count_p2 smallint not null default 0;

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'games_vote_status_check' and conrelid = 'public.games'::regclass
  ) then
    alter table public.games
      add constraint games_vote_status_check
      check (vote_status is null or vote_status in ('open', 'done'));
  end if;

  if not exists (
    select 1 from pg_constraint
    where conname = 'games_vote_result_check' and conrelid = 'public.games'::regclass
  ) then
    alter table public.games
      add constraint games_vote_result_check
      check (vote_result is null or vote_result in ('match', 'none'));
  end if;
end $$;

-- les cinq cartes d'un vote et les réponses (lues seulement par fonctions)
create table if not exists public.protocol_game_votes (
  game_id uuid not null references public.games (id) on delete cascade,
  position smallint not null check (position between 1 and 5),
  card_id bigint not null references public.protocol_cards (id) on delete cascade,
  for_player smallint not null check (for_player in (1, 2)),
  vote_p1 boolean,
  vote_p2 boolean,
  primary key (game_id, position)
);

alter table public.protocol_game_votes enable row level security;


-- ---------------------------------------------------------
-- 2. RÉGLAGE DU COUPLE
-- ---------------------------------------------------------

create or replace function public.protocol_vote_setting(p_couple_id uuid)
returns boolean
language sql
stable
security definer
set search_path to ''
as $$
  select coalesce(
    (select s.vote_enabled from public.protocol_couple_settings s
     where s.couple_id = p_couple_id),
    true
  )
$$;

create or replace function public.get_protocol_vote_enabled()
returns boolean
language sql
stable
security definer
set search_path to ''
as $$
  select coalesce(
    (
      select s.vote_enabled
      from public.protocol_couple_members m
      join public.protocol_couple_settings s on s.couple_id = m.couple_id
      where m.user_id = auth.uid()
      limit 1
    ),
    true
  )
$$;

create or replace function public.set_protocol_vote_enabled(p_enabled boolean)
returns boolean
language plpgsql
security definer
set search_path to ''
as $$
declare
  v_couple_id uuid;
begin
  if auth.uid() is null then
    raise exception 'Authentication required';
  end if;

  select m.couple_id into v_couple_id
  from public.protocol_couple_members m
  where m.user_id = auth.uid()
  limit 1;

  if v_couple_id is null then
    raise exception 'User does not belong to a couple';
  end if;

  insert into public.protocol_couple_settings
    (couple_id, vote_enabled, updated_by, updated_at)
  values
    (v_couple_id, coalesce(p_enabled, true), auth.uid(), now())
  on conflict (couple_id) do update
    set vote_enabled = excluded.vote_enabled,
        updated_by = excluded.updated_by,
        updated_at = excluded.updated_at;

  return coalesce(p_enabled, true);
end;
$$;


-- ---------------------------------------------------------
-- 3. DÉCLENCHEUR : ouverture, blocage pendant le vote, revanche
-- ---------------------------------------------------------

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
    return new;
  end if;

  -- revanche : tout repart de zéro
  if old.status = 'finished' and new.status is distinct from 'finished' then
    new.vote_enabled := public.protocol_vote_setting(new.couple_id);
    new.vote_status := null;
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

  if nullif(current_setting('protocol.vote_open', true), '') = '1' and new.status = 'playing' then
    perform set_config('protocol.vote_open', '', true);
    new.vote_status := 'open';
    new.vote_turn := new.turn_no;
  end if;

  if nullif(current_setting('protocol.vote_pick', true), '') = '1' and new.status = 'playing' then
    perform set_config('protocol.vote_pick', '', true);
    new.vote_played_turn := new.turn_no;
  end if;

  return new;
end;
$$;

revoke all on function public.protocol_vote_on_game_change() from public, anon, authenticated;

drop trigger if exists protocol_vote on public.games;
create trigger protocol_vote
  before insert or update on public.games
  for each row execute function public.protocol_vote_on_game_change();


-- ---------------------------------------------------------
-- 4. TIRAGE : le vote s'ouvre, l'envie commune est jouée
-- ---------------------------------------------------------

do $$
begin
  if not exists (
    select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname = 'protocol_select_card_v2_inner'
  ) then
    alter function public.protocol_select_card_v2_unified(uuid, integer, integer, text)
      rename to protocol_select_card_v2_inner;
  end if;
end $$;

revoke all on function public.protocol_select_card_v2_inner(uuid, integer, integer, text) from public, anon, authenticated;

-- tour du vote : entre 40 % et 70 % de la partie, fixé par la partie
create or replace function public.protocol_vote_turn(p_game public.games)
returns integer
language sql
immutable
set search_path to ''
as $$
  select greatest(4, round(coalesce(p_game.target_turns, 20) * 0.4)::integer)
    + abs(hashtext(p_game.id::text)) % greatest(1, round(coalesce(p_game.target_turns, 20) * 0.3)::integer)
$$;

-- les cinq cartes : trois pour celui qui aura la main, deux pour
-- l'autre, des actions officielles plutôt pimentées, toutes différentes
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
       and not coalesce(v_game.single_device, false)
       and p_next_turn >= public.protocol_vote_turn(v_game)
       and p_next_turn <= coalesce(v_game.target_turns, 20) - 3
       and coalesce(v_game.bonus_player_1 ->> 'desire_armed', '') = ''
       and coalesce(v_game.bonus_player_2 ->> 'desire_armed', '') = '' then
      if public.protocol_vote_prepare(v_game, p_next_player, p_next_turn) > 0 then
        perform set_config('protocol.vote_open', '1', true);
      end if;
    end if;
  end if;

  return public.protocol_select_card_v2_inner(p_game_id, p_next_player, p_next_turn, p_forced_type);
end;
$$;

revoke all on function public.protocol_select_card_v2_unified(uuid, integer, integer, text) from public, anon, authenticated;


-- ---------------------------------------------------------
-- 5. VOTER : une carte à la fois, sans retour possible
-- ---------------------------------------------------------

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
  v_turns integer[];
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

  -- elle arrive au tour de son joueur : le suivant, ou un peu plus tard
  select array_agg(t) into v_turns
  from generate_series(v_game.turn_no + 1, v_game.turn_no + 4) t
  where t < coalesce(v_game.target_turns, 20)
    and (case when (t - v_game.turn_no) % 2 = 0 then v_game.active_player
              else 3 - v_game.active_player end) = v_pick.for_player;

  update public.games
  set vote_status = 'done',
      vote_result = 'match',
      vote_card_id = v_pick.card_id,
      vote_for_player = v_pick.for_player,
      vote_play_turn = coalesce(v_turns[1 + floor(random() * array_length(v_turns, 1))::integer], v_game.turn_no + 1),
      vote_count_p1 = v_total,
      vote_count_p2 = v_total
  where id = v_game.id;

  return jsonb_build_object('status', 'done', 'result', 'match');
end;
$$;

revoke all on function public.cast_protocol_vote(text, integer, boolean) from public, anon;
grant execute on function public.cast_protocol_vote(text, integer, boolean) to authenticated;


-- ---------------------------------------------------------
-- 6. CARTE COURANTE : vote, envie commune, avis déjà donnés
-- ---------------------------------------------------------

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

  -- avis déjà donnés sur cette carte, par soi et par l'autre
  v_source := v_card ->> 'card_source';
  v_card_id := case when v_source = 'custom' then (v_card ->> 'custom_card_id')::bigint
                    else (v_card ->> 'official_card_id')::bigint end;

  select m.user_id into v_partner
  from public.protocol_couple_members m
  where m.couple_id = v_game.couple_id and m.user_id <> auth.uid()
  limit 1;

  -- le vote : les cinq cartes et ses propres réponses, jamais celles
  -- de l'autre ; le résultat le temps du tour où il a eu lieu
  if v_game.vote_status = 'open' then
    select jsonb_build_object(
      'status', 'open',
      'mine', case when v_player = 1 then v_game.vote_count_p1 else v_game.vote_count_p2 end,
      'partner', case when v_player = 1 then v_game.vote_count_p2 else v_game.vote_count_p1 end,
      'cards', coalesce(jsonb_agg(jsonb_build_object(
        'position', v.position,
        'for_player', v.for_player,
        'type', c.type,
        'intensity', c.intensity,
        'title', c.title,
        'prompt', c.prompt,
        'voted', case when v_player = 1 then v.vote_p1 is not null else v.vote_p2 is not null end
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
        'next', v_game.vote_play_turn = v_game.turn_no + 1
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

  -- pendant le vote, la carte du tour attend, cachée
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

do $$
declare
  v_fn text;
begin
  foreach v_fn in array array[
    'public.get_protocol_vote_enabled()',
    'public.set_protocol_vote_enabled(boolean)'
  ]
  loop
    execute format('revoke all on function %s from public, anon', v_fn);
    execute format('grant execute on function %s to authenticated', v_fn);
  end loop;
end $$;

revoke all on function public.protocol_vote_setting(uuid) from public, anon, authenticated;
revoke all on function public.protocol_vote_turn(public.games) from public, anon, authenticated;
