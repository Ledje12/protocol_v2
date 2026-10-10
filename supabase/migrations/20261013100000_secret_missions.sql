-- =========================================================
-- Missions secrètes
--   Au lancement de la partie, chacun reçoit en privé une mission
--   discrète à réussir pendant la soirée (obtenir, provoquer,
--   glisser… jamais une contrainte imposée à l'autre). Une seule
--   « Une autre » possible, en début de partie. Pendant la partie,
--   on la relit et on la marque « réussie » soi-même, en secret.
--   À la fin normale de la partie, on révèle les missions.
--   Les missions respectent, comme les cartes, la calibration la
--   plus prudente, le style (Vanilla / Kinky) et le sexe de chacun.
--   Réglage du couple (Mode de soirée), désactivé par défaut ;
--   figé à la création de la partie (et à la revanche).
--   Le catalogue (protocol_missions) se remplit par SQL, comme
--   les cartes ; personne ne le lit depuis l'app.
-- Migration rejouable sans risque.
-- =========================================================

create table if not exists public.protocol_missions (
  id bigint generated always as identity primary key,
  title text not null,
  prompt text not null,
  intensity smallint not null check (intensity between 1 and 5),
  style text not null default 'vanilla' check (style in ('vanilla', 'kinky')),
  target_sex text check (target_sex is null or target_sex in ('male', 'female')),
  active boolean not null default true,
  created_at timestamptz not null default now()
);

create table if not exists public.protocol_game_missions (
  game_id uuid not null references public.games (id) on delete cascade,
  player_no smallint not null check (player_no in (1, 2)),
  mission_id bigint not null references public.protocol_missions (id),
  redrawn boolean not null default false,
  done boolean not null default false,
  assigned_at timestamptz not null default now(),
  primary key (game_id, player_no)
);

-- aucune politique : accès uniquement par les fonctions ci-dessous
alter table public.protocol_missions enable row level security;
alter table public.protocol_game_missions enable row level security;
revoke all on public.protocol_missions from anon, authenticated;
revoke all on public.protocol_game_missions from anon, authenticated;

alter table public.protocol_couple_settings
  add column if not exists missions_enabled boolean not null default false;

alter table public.games
  add column if not exists missions_enabled boolean not null default false;


-- ---------------------------------------------------------
-- 1. RÉGLAGE DU COUPLE
-- ---------------------------------------------------------

create or replace function public.get_protocol_missions_enabled()
returns boolean
language sql
stable
security definer
set search_path to ''
as $$
  select coalesce(
    (
      select s.missions_enabled
      from public.protocol_couple_members m
      join public.protocol_couple_settings s on s.couple_id = m.couple_id
      where m.user_id = auth.uid()
      limit 1
    ),
    false
  )
$$;

create or replace function public.set_protocol_missions_enabled(p_enabled boolean)
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
    (couple_id, missions_enabled, updated_by, updated_at)
  values
    (v_couple_id, coalesce(p_enabled, false), auth.uid(), now())
  on conflict (couple_id) do update
    set missions_enabled = excluded.missions_enabled,
        updated_by = excluded.updated_by,
        updated_at = excluded.updated_at;

  return coalesce(p_enabled, false);
end;
$$;


-- ---------------------------------------------------------
-- 2. TIRAGE D'UNE MISSION
--    Compatible avec la calibration, le style du couple et le
--    sexe du joueur ; différente de celle de l'autre ; on évite
--    les missions déjà reçues récemment par le couple.
-- ---------------------------------------------------------

create or replace function public.protocol_pick_mission(
  p_game_id uuid,
  p_player_no integer,
  p_exclude bigint default null
)
returns bigint
language sql
volatile
security definer
set search_path to ''
as $$
  with g as (
    select
      g.id,
      g.couple_id,
      greatest(1, least(5, coalesce((g.shared_profile ->> 'intensity')::integer, 1))) as max_intensity,
      case p_player_no when 1 then g.player_1_sex else g.player_2_sex end as sex,
      coalesce(
        (select s.card_style from public.protocol_couple_settings s
         where s.couple_id = g.couple_id and s.director_mode = 'custom'),
        'both'
      ) as card_style
    from public.games g
    where g.id = p_game_id
  ),
  recent as (
    select gm.mission_id
    from public.protocol_game_missions gm
    join public.games og on og.id = gm.game_id
    join g on og.couple_id = g.couple_id
    where og.id <> g.id
    order by gm.assigned_at desc
    limit 20
  )
  select m.id
  from public.protocol_missions m, g
  where m.active
    and m.intensity <= g.max_intensity
    and (m.target_sex is null or m.target_sex = g.sex)
    and (g.card_style <> 'vanilla' or m.style = 'vanilla')
    and m.id is distinct from p_exclude
    and m.id not in (
      select gm.mission_id from public.protocol_game_missions gm
      where gm.game_id = g.id
    )
  order by
    (m.id in (select mission_id from recent)),
    random()
  limit 1
$$;


-- ---------------------------------------------------------
-- 3. RÉGLAGE FIGÉ PAR PARTIE, ATTRIBUTION AU LANCEMENT
-- ---------------------------------------------------------

create or replace function public.protocol_missions_setting(p_couple_id uuid)
returns boolean
language sql
stable
security definer
set search_path to ''
as $$
  select coalesce(
    (select s.missions_enabled from public.protocol_couple_settings s
     where s.couple_id = p_couple_id),
    false
  )
$$;

create or replace function public.protocol_missions_on_game_change()
returns trigger
language plpgsql
security definer
set search_path to ''
as $$
begin
  if tg_op = 'INSERT' then
    new.missions_enabled := public.protocol_missions_setting(new.couple_id);
    return new;
  end if;

  -- revanche : nouvelles missions à la prochaine partie
  if old.status = 'finished' and new.status is distinct from 'finished' then
    delete from public.protocol_game_missions where game_id = new.id;
    new.missions_enabled := public.protocol_missions_setting(new.couple_id);
  end if;

  return new;
end;
$$;

drop trigger if exists protocol_missions on public.games;
create trigger protocol_missions
  before insert or update on public.games
  for each row
  execute function public.protocol_missions_on_game_change();

-- après le lancement (pas une reprise après STOP) : une mission
-- chacun, si le catalogue en propose une compatible
create or replace function public.protocol_missions_on_game_start()
returns trigger
language plpgsql
security definer
set search_path to ''
as $$
declare
  v_player integer;
  v_mission bigint;
begin
  if new.missions_enabled
     and new.status = 'playing'
     and old.status is distinct from 'playing'
     and old.status is distinct from 'paused' then
    foreach v_player in array array[1, 2] loop
      v_mission := public.protocol_pick_mission(new.id, v_player);

      if v_mission is not null then
        insert into public.protocol_game_missions (game_id, player_no, mission_id)
        values (new.id, v_player, v_mission)
        on conflict (game_id, player_no) do nothing;
      end if;
    end loop;
  end if;

  return null;
end;
$$;

drop trigger if exists protocol_missions_start on public.games;
create trigger protocol_missions_start
  after update on public.games
  for each row
  execute function public.protocol_missions_on_game_start();


-- ---------------------------------------------------------
-- 4. SA MISSION : la lire, en changer une fois, la marquer réussie
-- ---------------------------------------------------------

-- « Une autre » : possible une fois, pendant les 3 premiers tours
create or replace function public.protocol_mission_redraw_turns()
returns integer
language sql
immutable
set search_path to ''
as $$ select 3 $$;

create or replace function public.get_my_mission(p_game_code text)
returns jsonb
language plpgsql
security definer
set search_path to ''
as $$
declare
  v_player_no integer;
  v_game public.games%rowtype;
  v_row record;
begin
  v_player_no := public.protocol_current_player_no(p_game_code);

  select * into v_game from public.games where code = upper(trim(p_game_code));

  select gm.*, m.title, m.prompt
  into v_row
  from public.protocol_game_missions gm
  join public.protocol_missions m on m.id = gm.mission_id
  where gm.game_id = v_game.id and gm.player_no = v_player_no;

  if v_row.mission_id is null then
    return jsonb_build_object(
      'enabled', v_game.missions_enabled,
      'player_no', v_player_no,
      'mission', null
    );
  end if;

  return jsonb_build_object(
    'enabled', v_game.missions_enabled,
    'player_no', v_player_no,
    'mission', jsonb_build_object('title', v_row.title, 'prompt', v_row.prompt),
    'done', v_row.done,
    'can_redraw',
      not v_row.redrawn
      and not v_row.done
      and v_game.status = 'playing'
      and v_game.turn_no <= public.protocol_mission_redraw_turns()
  );
end;
$$;

create or replace function public.redraw_my_mission(p_game_code text)
returns jsonb
language plpgsql
security definer
set search_path to ''
as $$
declare
  v_player_no integer;
  v_game public.games%rowtype;
  v_current public.protocol_game_missions%rowtype;
  v_next bigint;
begin
  v_player_no := public.protocol_current_player_no(p_game_code);

  select * into v_game from public.games where code = upper(trim(p_game_code));

  select * into v_current
  from public.protocol_game_missions
  where game_id = v_game.id and player_no = v_player_no
  for update;

  if v_current.mission_id is null then
    raise exception 'No mission';
  end if;

  if v_current.redrawn or v_current.done
     or v_game.status <> 'playing'
     or v_game.turn_no > public.protocol_mission_redraw_turns() then
    raise exception 'Mission redraw not available';
  end if;

  v_next := public.protocol_pick_mission(v_game.id, v_player_no, v_current.mission_id);

  if v_next is null then
    raise exception 'No other mission available';
  end if;

  update public.protocol_game_missions
  set mission_id = v_next, redrawn = true, assigned_at = now()
  where game_id = v_game.id and player_no = v_player_no;

  return public.get_my_mission(p_game_code);
end;
$$;

create or replace function public.set_my_mission_done(p_game_code text, p_done boolean)
returns boolean
language plpgsql
security definer
set search_path to ''
as $$
declare
  v_player_no integer;
  v_game_id uuid;
begin
  v_player_no := public.protocol_current_player_no(p_game_code);

  select id into v_game_id from public.games
  where code = upper(trim(p_game_code)) and status in ('playing', 'paused');

  if v_game_id is null then
    raise exception 'Game is not playing';
  end if;

  update public.protocol_game_missions
  set done = coalesce(p_done, false)
  where game_id = v_game_id and player_no = v_player_no;

  if not found then
    raise exception 'No mission';
  end if;

  return coalesce(p_done, false);
end;
$$;


-- ---------------------------------------------------------
-- 5. RÉVÉLATION (fin normale de la partie)
-- ---------------------------------------------------------

create or replace function public.reveal_protocol_missions(p_game_code text)
returns jsonb
language plpgsql
security definer
set search_path to ''
as $$
declare
  v_game public.games%rowtype;
begin
  perform public.protocol_current_player_no(p_game_code);

  select * into v_game from public.games where code = upper(trim(p_game_code));

  if v_game.status <> 'finished' then
    raise exception 'Game is not finished';
  end if;

  return coalesce(
    (
      select jsonb_agg(
        jsonb_build_object(
          'player_no', gm.player_no,
          'name', case gm.player_no
            when 1 then v_game.player_1_name
            else v_game.player_2_name
          end,
          'title', m.title,
          'prompt', m.prompt,
          'done', gm.done
        )
        order by gm.player_no
      )
      from public.protocol_game_missions gm
      join public.protocol_missions m on m.id = gm.mission_id
      where gm.game_id = v_game.id
    ),
    '[]'::jsonb
  );
end;
$$;


-- ---------------------------------------------------------
-- 6. UN SEUL TÉLÉPHONE : pour le joueur désigné
-- ---------------------------------------------------------

create or replace function public.get_my_mission_as(p_game_code text, p_player_no integer)
returns jsonb
language plpgsql
security definer
set search_path to ''
as $$
begin
  perform public.protocol_act_as(p_game_code, p_player_no);
  return public.get_my_mission(p_game_code);
end;
$$;

create or replace function public.redraw_my_mission_as(p_game_code text, p_player_no integer)
returns jsonb
language plpgsql
security definer
set search_path to ''
as $$
begin
  perform public.protocol_act_as(p_game_code, p_player_no);
  return public.redraw_my_mission(p_game_code);
end;
$$;

create or replace function public.set_my_mission_done_as(
  p_game_code text,
  p_player_no integer,
  p_done boolean
)
returns boolean
language plpgsql
security definer
set search_path to ''
as $$
begin
  perform public.protocol_act_as(p_game_code, p_player_no);
  return public.set_my_mission_done(p_game_code, p_done);
end;
$$;


-- ---------------------------------------------------------
-- DROITS
-- ---------------------------------------------------------

revoke all on function public.get_protocol_missions_enabled() from public, anon;
revoke all on function public.set_protocol_missions_enabled(boolean) from public, anon;
revoke all on function public.protocol_pick_mission(uuid, integer, bigint) from public, anon, authenticated;
revoke all on function public.protocol_missions_setting(uuid) from public, anon, authenticated;
revoke all on function public.get_my_mission(text) from public, anon;
revoke all on function public.redraw_my_mission(text) from public, anon;
revoke all on function public.set_my_mission_done(text, boolean) from public, anon;
revoke all on function public.reveal_protocol_missions(text) from public, anon;
revoke all on function public.get_my_mission_as(text, integer) from public, anon;
revoke all on function public.redraw_my_mission_as(text, integer) from public, anon;
revoke all on function public.set_my_mission_done_as(text, integer, boolean) from public, anon;

grant execute on function public.get_protocol_missions_enabled() to authenticated;
grant execute on function public.set_protocol_missions_enabled(boolean) to authenticated;
grant execute on function public.get_my_mission(text) to authenticated;
grant execute on function public.redraw_my_mission(text) to authenticated;
grant execute on function public.set_my_mission_done(text, boolean) to authenticated;
grant execute on function public.reveal_protocol_missions(text) to authenticated;
grant execute on function public.get_my_mission_as(text, integer) to authenticated;
grant execute on function public.redraw_my_mission_as(text, integer) to authenticated;
grant execute on function public.set_my_mission_done_as(text, integer, boolean) to authenticated;
