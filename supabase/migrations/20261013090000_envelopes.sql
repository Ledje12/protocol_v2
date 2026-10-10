-- =========================================================
-- L'enveloppe
--   Vers 60 % de la partie, chacun écrit en secret une phrase
--   pour la fin de soirée (ou passe). L'enveloppe est scellée :
--   impossible de la modifier, et personne ne peut la lire avant
--   la fin normale de la partie, où on les ouvre ensemble.
--   L'autre ne sait pas si on a écrit ou passé.
--   Partie abandonnée : enveloppes détruites sans être lues.
--   Rien n'est gardé : effacement 24 h après la fin.
--   Réglage du couple (Mode de soirée), actif par défaut ; il est
--   figé pour chaque partie à sa création (et à la revanche).
-- Migration rejouable sans risque.
-- =========================================================

alter table public.protocol_couple_settings
  add column if not exists envelope_enabled boolean not null default true;

alter table public.games
  add column if not exists envelope_enabled boolean not null default true;

create table if not exists public.protocol_game_envelopes (
  game_id uuid not null references public.games (id) on delete cascade,
  player_no smallint not null check (player_no in (1, 2)),
  message text, -- null : le joueur a passé
  sealed_at timestamptz not null default now(),
  primary key (game_id, player_no)
);

-- aucune politique : on n'y accède que par les fonctions ci-dessous
alter table public.protocol_game_envelopes enable row level security;
revoke all on public.protocol_game_envelopes from anon, authenticated;


-- ---------------------------------------------------------
-- 1. RÉGLAGE DU COUPLE
-- ---------------------------------------------------------

create or replace function public.get_protocol_envelope_enabled()
returns boolean
language sql
stable
security definer
set search_path to ''
as $$
  select coalesce(
    (
      select s.envelope_enabled
      from public.protocol_couple_members m
      join public.protocol_couple_settings s on s.couple_id = m.couple_id
      where m.user_id = auth.uid()
      limit 1
    ),
    true
  )
$$;

create or replace function public.set_protocol_envelope_enabled(p_enabled boolean)
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
    (couple_id, envelope_enabled, updated_by, updated_at)
  values
    (v_couple_id, coalesce(p_enabled, true), auth.uid(), now())
  on conflict (couple_id) do update
    set envelope_enabled = excluded.envelope_enabled,
        updated_by = excluded.updated_by,
        updated_at = excluded.updated_at;

  return coalesce(p_enabled, true);
end;
$$;


-- ---------------------------------------------------------
-- 2. RÉGLAGE FIGÉ PAR PARTIE, REVANCHE = ENVELOPPES NEUVES
-- ---------------------------------------------------------

create or replace function public.protocol_envelope_setting(p_couple_id uuid)
returns boolean
language sql
stable
security definer
set search_path to ''
as $$
  select coalesce(
    (select s.envelope_enabled from public.protocol_couple_settings s
     where s.couple_id = p_couple_id),
    true
  )
$$;

create or replace function public.protocol_envelopes_on_game_change()
returns trigger
language plpgsql
security definer
set search_path to ''
as $$
begin
  if tg_op = 'INSERT' then
    new.envelope_enabled := public.protocol_envelope_setting(new.couple_id);
    return new;
  end if;

  -- revanche : la partie repart, les anciennes enveloppes disparaissent
  if old.status = 'finished' and new.status is distinct from 'finished' then
    delete from public.protocol_game_envelopes where game_id = new.id;
    new.envelope_enabled := public.protocol_envelope_setting(new.couple_id);
  end if;

  return new;
end;
$$;

drop trigger if exists protocol_envelopes on public.games;
create trigger protocol_envelopes
  before insert or update on public.games
  for each row
  execute function public.protocol_envelopes_on_game_change();


-- ---------------------------------------------------------
-- 3. ÉCRIRE SON ENVELOPPE
-- ---------------------------------------------------------

-- ménage : rien au-delà de 24 h après la fin, ni pour une
-- partie abandonnée depuis plus de deux jours
create or replace function public.protocol_envelopes_cleanup()
returns void
language sql
security definer
set search_path to ''
as $$
  delete from public.protocol_game_envelopes e
  using public.games g
  where g.id = e.game_id
    and (
      (g.status = 'finished' and g.finished_at < now() - interval '24 hours')
      or (g.status <> 'finished' and e.sealed_at < now() - interval '2 days')
    );
$$;

-- tour à partir duquel l'enveloppe se propose (après 60 % des cartes)
create or replace function public.protocol_envelope_turn(p_target_turns integer)
returns integer
language sql
immutable
set search_path to ''
as $$
  select floor(coalesce(p_target_turns, 20) * 0.6)::integer + 1
$$;

create or replace function public.get_protocol_envelope(p_game_code text)
returns jsonb
language plpgsql
security definer
set search_path to ''
as $$
declare
  v_player_no integer;
  v_game public.games%rowtype;
begin
  v_player_no := public.protocol_current_player_no(p_game_code);

  select * into v_game
  from public.games
  where code = upper(trim(p_game_code));

  return jsonb_build_object(
    'enabled', v_game.envelope_enabled,
    'player_no', v_player_no,
    'due',
      v_game.envelope_enabled
      and v_game.status in ('playing', 'paused')
      and v_game.turn_no >= public.protocol_envelope_turn(v_game.target_turns),
    'sealed', exists (
      select 1 from public.protocol_game_envelopes e
      where e.game_id = v_game.id and e.player_no = v_player_no
    )
  );
end;
$$;

create or replace function public.seal_protocol_envelope(
  p_game_code text,
  p_message text
)
returns boolean
language plpgsql
security definer
set search_path to ''
as $$
declare
  v_player_no integer;
  v_game public.games%rowtype;
  v_message text := nullif(trim(coalesce(p_message, '')), '');
begin
  v_player_no := public.protocol_current_player_no(p_game_code);

  select * into v_game
  from public.games
  where code = upper(trim(p_game_code));

  if not v_game.envelope_enabled then
    raise exception 'Envelope disabled';
  end if;

  if v_game.status not in ('playing', 'paused')
     or v_game.turn_no < public.protocol_envelope_turn(v_game.target_turns) then
    raise exception 'Envelope not available';
  end if;

  if length(v_message) > 140 then
    raise exception 'Envelope too long';
  end if;

  insert into public.protocol_game_envelopes (game_id, player_no, message)
  values (v_game.id, v_player_no, v_message)
  on conflict (game_id, player_no) do nothing;

  if not found then
    raise exception 'Envelope already sealed';
  end if;

  perform public.protocol_envelopes_cleanup();
  return true;
end;
$$;


-- ---------------------------------------------------------
-- 4. OUVRIR LES ENVELOPPES (fin normale de la partie)
--    Seules les enveloppes écrites sont renvoyées : celui qui a
--    passé reste invisible.
-- ---------------------------------------------------------

create or replace function public.open_protocol_envelopes(p_game_code text)
returns jsonb
language plpgsql
security definer
set search_path to ''
as $$
declare
  v_game public.games%rowtype;
begin
  perform public.protocol_current_player_no(p_game_code);
  perform public.protocol_envelopes_cleanup();

  select * into v_game
  from public.games
  where code = upper(trim(p_game_code));

  if v_game.status <> 'finished' then
    raise exception 'Game is not finished';
  end if;

  return coalesce(
    (
      select jsonb_agg(
        jsonb_build_object(
          'player_no', e.player_no,
          'name', case e.player_no
            when 1 then v_game.player_1_name
            else v_game.player_2_name
          end,
          'message', e.message
        )
        order by e.player_no
      )
      from public.protocol_game_envelopes e
      where e.game_id = v_game.id
        and e.message is not null
    ),
    '[]'::jsonb
  );
end;
$$;


-- ---------------------------------------------------------
-- 5. UN SEUL TÉLÉPHONE : écrire pour le joueur désigné
-- ---------------------------------------------------------

create or replace function public.get_protocol_envelope_as(
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
  return public.get_protocol_envelope(p_game_code);
end;
$$;

create or replace function public.seal_protocol_envelope_as(
  p_game_code text,
  p_player_no integer,
  p_message text
)
returns boolean
language plpgsql
security definer
set search_path to ''
as $$
begin
  perform public.protocol_act_as(p_game_code, p_player_no);
  return public.seal_protocol_envelope(p_game_code, p_message);
end;
$$;


-- ---------------------------------------------------------
-- DROITS
-- ---------------------------------------------------------

revoke all on function public.get_protocol_envelope_enabled() from public, anon;
revoke all on function public.set_protocol_envelope_enabled(boolean) from public, anon;
revoke all on function public.protocol_envelope_setting(uuid) from public, anon, authenticated;
revoke all on function public.protocol_envelopes_cleanup() from public, anon, authenticated;
revoke all on function public.get_protocol_envelope(text) from public, anon;
revoke all on function public.seal_protocol_envelope(text, text) from public, anon;
revoke all on function public.open_protocol_envelopes(text) from public, anon;
revoke all on function public.get_protocol_envelope_as(text, integer) from public, anon;
revoke all on function public.seal_protocol_envelope_as(text, integer, text) from public, anon;

grant execute on function public.get_protocol_envelope_enabled() to authenticated;
grant execute on function public.set_protocol_envelope_enabled(boolean) to authenticated;
grant execute on function public.get_protocol_envelope(text) to authenticated;
grant execute on function public.seal_protocol_envelope(text, text) to authenticated;
grant execute on function public.open_protocol_envelopes(text) to authenticated;
grant execute on function public.get_protocol_envelope_as(text, integer) to authenticated;
grant execute on function public.seal_protocol_envelope_as(text, integer, text) to authenticated;
