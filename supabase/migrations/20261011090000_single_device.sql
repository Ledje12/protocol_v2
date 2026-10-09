-- =========================================================
-- Partie sur un seul téléphone
--   Le téléphone qui crée la partie joue pour les deux membres
--   du couple : pour le joueur dont c'est le tour pendant la
--   partie, et pour un joueur désigné pendant la calibration et
--   la lecture des étapes privées (fonctions « _as »).
--   Réservé aux parties marquées single_device, et aux membres
--   de la partie.
-- Migration rejouable sans risque.
-- =========================================================

alter table public.games
  add column if not exists single_device boolean not null default false;


-- ---------------------------------------------------------
-- 1. QUI JOUE
--    Toutes les actions de jeu passent par cette fonction.
--    Partie classique : inchangé (le joueur du compte connecté).
--    Un seul téléphone : le joueur désigné par l'appel en cours
--    (calibration, étape privée), sinon celui dont c'est le tour.
-- ---------------------------------------------------------

create or replace function public.protocol_current_player_no(p_game_code text)
returns integer
language plpgsql
security definer
set search_path to ''
as $$
declare
  v_user_id uuid;
  v_player_no integer;
  v_single boolean;
  v_active integer;
  v_acting integer;
begin
  v_user_id := auth.uid();

  if v_user_id is null then
    raise exception 'Authentication required';
  end if;

  select gp.player_no, g.single_device, g.active_player
  into v_player_no, v_single, v_active
  from public.game_players gp
  join public.games g
    on g.id = gp.game_id
  where g.code = upper(trim(p_game_code))
    and gp.user_id = v_user_id;

  if v_player_no is null then
    raise exception 'Access to game denied';
  end if;

  if coalesce(v_single, false) then
    v_acting := nullif(current_setting('protocol.acting_player', true), '')::integer;

    if v_acting in (1, 2) then
      return v_acting;
    end if;

    if v_active in (1, 2) then
      return v_active;
    end if;
  end if;

  return v_player_no;
end;
$$;


-- ---------------------------------------------------------
-- 2. CRÉER UNE PARTIE SUR UN SEUL TÉLÉPHONE
--    Les deux membres du couple sont joueurs d'emblée, prénoms
--    et sexes repris des profils : pas de code, pas d'attente.
-- ---------------------------------------------------------

create or replace function public.create_single_device_game()
returns text
language plpgsql
security definer
set search_path to ''
as $$
declare
  v_user_id uuid := auth.uid();
  v_partner_id uuid;
  v_code text;
  v_game_id uuid;
  v_name_1 text;
  v_sex_1 text;
  v_name_2 text;
  v_sex_2 text;
begin
  if v_user_id is null then
    raise exception 'Authentication required';
  end if;

  select m2.user_id
  into v_partner_id
  from public.protocol_couple_members m1
  join public.protocol_couple_members m2
    on m2.couple_id = m1.couple_id
   and m2.user_id <> m1.user_id
  where m1.user_id = v_user_id
  limit 1;

  if v_partner_id is null then
    raise exception 'Partner not found';
  end if;

  select p.display_name, p.sex into v_name_1, v_sex_1
  from public.protocol_profiles p where p.user_id = v_user_id;

  select p.display_name, p.sex into v_name_2, v_sex_2
  from public.protocol_profiles p where p.user_id = v_partner_id;

  if coalesce(trim(v_name_1), '') = '' or coalesce(trim(v_name_2), '') = '' then
    raise exception 'Profile name not found';
  end if;

  -- même création qu'une partie classique (code, réglages du couple)
  select g.code into v_code from public.create_protocol_game() g;

  select id into v_game_id from public.games where code = v_code;

  insert into public.game_players (game_id, user_id, player_no)
  values (v_game_id, v_partner_id, 2);

  update public.games
  set
    single_device = true,
    player_count = 2,
    player_1_name = trim(v_name_1),
    player_1_sex = v_sex_1,
    player_2_name = trim(v_name_2),
    player_2_sex = v_sex_2,
    player_1_ready = true,
    player_2_ready = true,
    status = 'calibrating'
  where id = v_game_id;

  return v_code;
end;
$$;


-- ---------------------------------------------------------
-- 3. REVANCHE : pas de salle d'attente sur un seul téléphone
-- ---------------------------------------------------------

create or replace function public.protocol_single_device_on_game_update()
returns trigger
language plpgsql
security definer
set search_path to ''
as $$
begin
  if new.single_device
     and new.status = 'ready'
     and old.status is distinct from 'ready' then
    new.player_1_ready := true;
    new.player_2_ready := true;
    new.status := 'calibrating';
  end if;

  return new;
end;
$$;

drop trigger if exists protocol_single_device on public.games;
create trigger protocol_single_device
  before update on public.games
  for each row
  execute function public.protocol_single_device_on_game_update();


-- ---------------------------------------------------------
-- 4. AGIR POUR UN JOUEUR DÉSIGNÉ (un seul téléphone)
-- ---------------------------------------------------------

create or replace function public.protocol_act_as(p_game_code text, p_player_no integer)
returns void
language plpgsql
security definer
set search_path to ''
as $$
begin
  if p_player_no not in (1, 2) then
    raise exception 'Invalid player number';
  end if;

  if not exists (
    select 1
    from public.games g
    join public.game_players gp on gp.game_id = g.id
    where g.code = upper(trim(p_game_code))
      and g.single_device
      and gp.user_id = auth.uid()
  ) then
    raise exception 'Not a single-device game';
  end if;

  perform set_config('protocol.acting_player', p_player_no::text, true);
end;
$$;

create or replace function public.submit_calibration_as(
  p_game_code text,
  p_player_no integer,
  p_intensity integer,
  p_answers jsonb
)
returns jsonb
language plpgsql
security definer
set search_path to ''
as $$
begin
  perform public.protocol_act_as(p_game_code, p_player_no);
  return public.submit_calibration(p_game_code, p_intensity, p_answers);
end;
$$;

create or replace function public.get_scene_state_as(
  p_game_code text,
  p_player_no integer
)
returns jsonb
language plpgsql
security definer
set search_path to ''
as $$
begin
  perform public.protocol_act_as(p_game_code, p_player_no);
  return public.get_scene_state(p_game_code);
end;
$$;

create or replace function public.mark_scene_step_read_guarded_as(
  p_game_code text,
  p_expected_card_id bigint,
  p_expected_scene_step_no integer,
  p_player_no integer
)
returns jsonb
language plpgsql
security definer
set search_path to ''
as $$
begin
  perform public.protocol_act_as(p_game_code, p_player_no);
  return public.mark_scene_step_read_guarded(
    p_game_code,
    p_expected_card_id,
    p_expected_scene_step_no
  );
end;
$$;


-- ---------------------------------------------------------
-- DROITS
-- ---------------------------------------------------------

revoke all on function public.create_single_device_game() from public, anon;
revoke all on function public.protocol_act_as(text, integer) from public, anon, authenticated;
revoke all on function public.submit_calibration_as(text, integer, integer, jsonb) from public, anon;
revoke all on function public.get_scene_state_as(text, integer) from public, anon;
revoke all on function public.mark_scene_step_read_guarded_as(text, bigint, integer, integer) from public, anon;

grant execute on function public.create_single_device_game() to authenticated;
grant execute on function public.submit_calibration_as(text, integer, integer, jsonb) to authenticated;
grant execute on function public.get_scene_state_as(text, integer) to authenticated;
grant execute on function public.mark_scene_step_read_guarded_as(text, bigint, integer, integer) to authenticated;
