-- =========================================================
-- Cartes scellées (25/11/2026)
--
-- Quatre fois par partie (deux par joueur, à partir du 4e tour),
-- la carte arrive retournée. Celui qui a la main :
--   - l'accepte sans la lire : elle se retourne, se joue telle
--     quelle (pas d'autre proposition) et lui recharge un joker ;
--   - ou la refuse : une carte normale la remplace.
-- Une fois retournée, il peut encore passer son tour, mais le
-- joker va alors à l'autre.
-- La carte scellée est un cran plus chaude que le tirage normal :
-- l'action la plus intense permise à ce moment de la partie, jamais
-- au-delà du plafond du tour ni de ce que le couple a choisi.
-- Son texte reste caché par le serveur tant qu'elle n'est pas
-- acceptée.
-- Réglage du couple (mode de jeu), actif par défaut, figé pour
-- chaque partie à sa création (et à la revanche).
--
-- Le tirage existant (protocol_select_card_v2_unified) n'est pas
-- modifié : il est renommé et appelé par un relais du même nom.
-- Idem pour get_protocol_current_card, qui masque la carte.
--
-- Migration rejouable sans risque.
-- =========================================================

-- ---------------------------------------------------------
-- 1. COLONNES
-- ---------------------------------------------------------

alter table public.protocol_couple_settings
  add column if not exists sealed_enabled boolean not null default true;

alter table public.games
  add column if not exists sealed_enabled boolean not null default false,
  add column if not exists sealed_status text,
  add column if not exists sealed_used_p1 smallint not null default 0,
  add column if not exists sealed_used_p2 smallint not null default 0,
  add column if not exists sealed_accepted smallint not null default 0;

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'games_sealed_status_check'
      and conrelid = 'public.games'::regclass
  ) then
    alter table public.games
      add constraint games_sealed_status_check
      check (sealed_status is null or sealed_status in ('pending', 'accepted'));
  end if;
end $$;


-- ---------------------------------------------------------
-- 2. RÉGLAGE DU COUPLE
-- ---------------------------------------------------------

create or replace function public.protocol_sealed_setting(p_couple_id uuid)
returns boolean
language sql
stable
security definer
set search_path to ''
as $$
  select coalesce(
    (select s.sealed_enabled from public.protocol_couple_settings s
     where s.couple_id = p_couple_id),
    true
  )
$$;

create or replace function public.get_protocol_sealed_enabled()
returns boolean
language sql
stable
security definer
set search_path to ''
as $$
  select coalesce(
    (
      select s.sealed_enabled
      from public.protocol_couple_members m
      join public.protocol_couple_settings s on s.couple_id = m.couple_id
      where m.user_id = auth.uid()
      limit 1
    ),
    true
  )
$$;

create or replace function public.set_protocol_sealed_enabled(p_enabled boolean)
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
    (couple_id, sealed_enabled, updated_by, updated_at)
  values
    (v_couple_id, coalesce(p_enabled, true), auth.uid(), now())
  on conflict (couple_id) do update
    set sealed_enabled = excluded.sealed_enabled,
        updated_by = excluded.updated_by,
        updated_at = excluded.updated_at;

  return coalesce(p_enabled, true);
end;
$$;


-- ---------------------------------------------------------
-- 3. DÉCLENCHEUR : état de la carte scellée à chaque changement
-- ---------------------------------------------------------

create or replace function public.protocol_sealed_on_game_change()
returns trigger
language plpgsql
security definer
set search_path to ''
as $$
declare
  v_next text;
  v_refuse text;
begin
  if tg_op = 'INSERT' then
    new.sealed_enabled := public.protocol_sealed_setting(new.couple_id);
    new.sealed_status := null;
    return new;
  end if;

  -- revanche : tout repart de zéro
  if old.status = 'finished' and new.status is distinct from 'finished' then
    new.sealed_enabled := public.protocol_sealed_setting(new.couple_id);
    new.sealed_status := null;
    new.sealed_used_p1 := 0;
    new.sealed_used_p2 := 0;
    new.sealed_accepted := 0;
    return new;
  end if;

  if new.current_card_id is not distinct from old.current_card_id
     and new.current_custom_card_id is not distinct from old.current_custom_card_id
     and new.turn_no is not distinct from old.turn_no then
    return new;
  end if;

  v_next := nullif(current_setting('protocol.sealed_next', true), '');
  v_refuse := nullif(current_setting('protocol.sealed_refuse', true), '');

  if old.sealed_status = 'pending' and v_refuse is null and new.status = 'playing' then
    raise exception 'Sealed card must be accepted or refused first';
  end if;

  if old.sealed_status = 'accepted'
     and new.turn_no is not distinct from old.turn_no
     and new.status = 'playing' then
    raise exception 'Sealed card cannot be changed';
  end if;

  perform set_config('protocol.sealed_refuse', '', true);

  if v_next = '1' and new.status = 'playing' then
    perform set_config('protocol.sealed_next', '', true);
    new.sealed_status := 'pending';
    if new.active_player = 1 then
      new.sealed_used_p1 := new.sealed_used_p1 + 1;
    else
      new.sealed_used_p2 := new.sealed_used_p2 + 1;
    end if;
  else
    new.sealed_status := null;
  end if;

  return new;
end;
$$;

drop trigger if exists protocol_sealed on public.games;
create trigger protocol_sealed
  before insert or update on public.games
  for each row execute function public.protocol_sealed_on_game_change();

revoke all on function public.protocol_sealed_on_game_change() from public, anon, authenticated;
revoke all on function public.protocol_sealed_setting(uuid) from public, anon, authenticated;


-- ---------------------------------------------------------
-- 4. TIRAGE : relais autour du tirage existant
-- ---------------------------------------------------------

do $$
begin
  if to_regprocedure('public.protocol_select_card_v2_base(uuid, integer, integer, text)') is null then
    alter function public.protocol_select_card_v2_unified(uuid, integer, integer, text)
      rename to protocol_select_card_v2_base;
  end if;
end $$;

revoke all on function public.protocol_select_card_v2_base(uuid, integer, integer, text)
  from public, anon, authenticated;

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
  v_used integer;
  v_left integer;
  v_normal jsonb;
  v_try jsonb;
  v_best jsonb;
  v_hot_turn integer;
  i integer;
begin
  v_normal := public.protocol_select_card_v2_base(p_game_id, p_next_player, p_next_turn, p_forced_type);

  select * into v_game from public.games where id = p_game_id;

  -- scellée seulement sur un vrai nouveau tour, sans type imposé,
  -- du 4e tour à l'avant-dernier, deux fois par joueur au plus
  if v_normal is null
     or v_game.id is null
     or not v_game.sealed_enabled
     or p_forced_type is not null
     or v_game.status <> 'playing'
     or p_next_turn <= coalesce(v_game.turn_no, 0)
     or p_next_turn < 4
     or p_next_turn >= coalesce(v_game.target_turns, 20) then
    return v_normal;
  end if;

  v_used := case when p_next_player = 1 then v_game.sealed_used_p1 else v_game.sealed_used_p2 end;
  if v_used >= 2 then
    return v_normal;
  end if;

  -- tours restants pour ce joueur (un sur deux) : la probabilité monte
  -- pour que chacun ait bien ses deux cartes scellées avant la fin
  v_left := greatest(1, ceil((coalesce(v_game.target_turns, 20) - p_next_turn) / 2.0)::integer);
  if random() >= (2 - v_used)::numeric / v_left then
    return v_normal;
  end if;

  -- un cran plus chaud : plusieurs actions tirées pour ce tour, on
  -- garde la plus intense, sans règle persistante. Le plafond du tour
  -- (la montée progressive et le choix du couple) reste la limite.
  v_hot_turn := p_next_turn;

  for i in 1..10 loop
    v_try := public.protocol_select_card_v2_base(p_game_id, p_next_player, v_hot_turn, 'action');
    if v_try is not null
       and v_try ->> 'card_source' = 'official'
       and not exists (
         select 1 from public.protocol_card_rules r
         where r.card_id = (v_try ->> 'official_card_id')::bigint and r.active
       )
       and (v_best is null
            or (v_try ->> 'intensity')::integer > (v_best ->> 'intensity')::integer) then
      v_best := v_try;
    end if;
  end loop;

  if v_best is null
     or (v_best ->> 'intensity')::integer < coalesce((v_normal ->> 'intensity')::integer, 1) then
    return v_normal;
  end if;

  perform set_config('protocol.sealed_next', '1', true);
  return v_best;
end;
$$;

revoke all on function public.protocol_select_card_v2_unified(uuid, integer, integer, text)
  from public, anon, authenticated;


-- ---------------------------------------------------------
-- 5. CARTE COURANTE : masquée tant qu'elle est scellée
-- ---------------------------------------------------------

do $$
begin
  if to_regprocedure('public.get_protocol_current_card_base(text)') is null then
    alter function public.get_protocol_current_card(text)
      rename to get_protocol_current_card_base;
  end if;
end $$;

revoke all on function public.get_protocol_current_card_base(text)
  from public, anon, authenticated;

create or replace function public.get_protocol_current_card(p_game_code text)
returns jsonb
language plpgsql
security definer
set search_path to ''
as $$
declare
  v_card jsonb;
  v_status text;
begin
  v_card := public.get_protocol_current_card_base(p_game_code);

  select g.sealed_status into v_status
  from public.games g
  where g.code = upper(trim(p_game_code));

  if v_status = 'pending' then
    return jsonb_build_object(
      'id', v_card -> 'id',
      'card_source', v_card -> 'card_source',
      'source_id', v_card -> 'source_id',
      'official_card_id', v_card -> 'official_card_id',
      'custom_card_id', v_card -> 'custom_card_id',
      'type', v_card -> 'type',
      'intensity', v_card -> 'intensity',
      'title', 'Carte scellée',
      'prompt', '',
      'sealed', 'pending'
    );
  end if;

  if v_status = 'accepted' then
    return v_card || '{"sealed": "accepted"}'::jsonb;
  end if;

  return v_card;
end;
$$;

revoke all on function public.get_protocol_current_card(text) from public, anon;
grant execute on function public.get_protocol_current_card(text) to authenticated;


-- ---------------------------------------------------------
-- 6. ACCEPTER, REFUSER, PASSER
-- ---------------------------------------------------------

-- vérifie la partie, la main et la carte attendue ; renvoie la partie
create or replace function public.protocol_sealed_game(
  p_game_code text,
  p_expected_card_id bigint,
  p_status text
)
returns public.games
language plpgsql
security definer
set search_path to ''
as $$
declare
  v_player integer;
  v_game public.games%rowtype;
begin
  v_player := public.protocol_current_player_no(p_game_code);

  select * into v_game
  from public.games
  where code = upper(trim(p_game_code))
  for update;

  if v_game.id is null then
    raise exception 'Game not found';
  end if;
  if v_game.status <> 'playing' then
    raise exception 'Game is not playing';
  end if;
  if v_game.active_player <> v_player then
    raise exception 'Not active player';
  end if;
  if v_game.sealed_status is distinct from p_status then
    raise exception 'No sealed card in this state';
  end if;
  if p_expected_card_id is not null and v_game.current_card_id is distinct from p_expected_card_id then
    raise exception 'Stale sealed card';
  end if;

  return v_game;
end;
$$;

revoke all on function public.protocol_sealed_game(text, bigint, text) from public, anon, authenticated;

create or replace function public.accept_sealed_card(
  p_game_code text,
  p_expected_card_id bigint default null
)
returns jsonb
language plpgsql
security definer
set search_path to ''
as $$
declare
  v_game public.games%rowtype;
begin
  v_game := public.protocol_sealed_game(p_game_code, p_expected_card_id, 'pending');

  -- même recharge qu'un duel gagné (déclencheur des jokers)
  perform set_config('protocol.duel_winner', v_game.active_player::text, true);

  update public.games
  set sealed_status = 'accepted',
      sealed_accepted = sealed_accepted + 1
  where id = v_game.id;

  return jsonb_build_object('accepted', true);
end;
$$;

create or replace function public.refuse_sealed_card(
  p_game_code text,
  p_expected_card_id bigint default null
)
returns jsonb
language plpgsql
security definer
set search_path to ''
as $$
begin
  perform public.protocol_sealed_game(p_game_code, p_expected_card_id, 'pending');

  -- une carte normale remplace la carte scellée, même tour
  perform set_config('protocol.sealed_refuse', '1', true);
  return public.advance_protocol(p_game_code, 'alternative');
end;
$$;

create or replace function public.pass_sealed_card(
  p_game_code text,
  p_expected_card_id bigint default null
)
returns jsonb
language plpgsql
security definer
set search_path to ''
as $$
declare
  v_game public.games%rowtype;
begin
  v_game := public.protocol_sealed_game(p_game_code, p_expected_card_id, 'accepted');

  -- le joker va à l'autre (déclencheur des jokers)
  perform set_config('protocol.duel_winner', (3 - v_game.active_player)::text, true);
  return public.advance_protocol(p_game_code, 'pass');
end;
$$;

create or replace function public.get_protocol_sealed_summary(p_game_code text)
returns jsonb
language plpgsql
stable
security definer
set search_path to ''
as $$
declare
  v_game public.games%rowtype;
begin
  perform public.protocol_current_player_no(p_game_code);

  select * into v_game from public.games where code = upper(trim(p_game_code));

  if v_game.id is null then
    raise exception 'Game not found';
  end if;

  return jsonb_build_object(
    'enabled', v_game.sealed_enabled,
    'status', v_game.sealed_status,
    'offered', v_game.sealed_used_p1 + v_game.sealed_used_p2,
    'accepted', v_game.sealed_accepted
  );
end;
$$;

do $$
declare
  v_fn text;
begin
  foreach v_fn in array array[
    'public.get_protocol_sealed_enabled()',
    'public.set_protocol_sealed_enabled(boolean)',
    'public.accept_sealed_card(text, bigint)',
    'public.refuse_sealed_card(text, bigint)',
    'public.pass_sealed_card(text, bigint)',
    'public.get_protocol_sealed_summary(text)'
  ]
  loop
    execute format('revoke all on function %s from public, anon', v_fn);
    execute format('grant execute on function %s to authenticated', v_fn);
  end loop;
end $$;
