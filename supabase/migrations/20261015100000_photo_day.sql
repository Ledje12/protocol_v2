-- =========================================================
-- « À distance » : une journée de défis photo
--   L'un lance la journée, l'autre l'accepte (seul consentement
--   demandé : pas de calibration). Puis, chacun son tour, un
--   défi tiré dans protocol_photo_challenges : on y répond par
--   une photo de l'album chiffré (envoyée dans la conversation),
--   ou on passe, sans se justifier.
--   12 défis (6 chacun) ; le niveau monte de 1 à 4 au fil de la
--   journée (3 défis par niveau). Pas de style Vanilla / Kinky.
--   Le défi en cours n'est visible que par celui qui le relève.
--   Une journée à la fois par duo ; chacun peut l'arrêter.
-- Migration rejouable sans risque.
-- =========================================================

create table if not exists public.protocol_photo_days (
  id uuid primary key default gen_random_uuid(),
  couple_id uuid not null,
  started_by uuid not null references auth.users (id) on delete cascade,
  partner_id uuid not null references auth.users (id) on delete cascade,
  status text not null default 'invited'
    check (status in ('invited', 'active', 'finished', 'declined', 'stopped')),
  total_turns integer not null default 12,
  turn_no integer not null default 0,
  active_user uuid,
  created_at timestamptz not null default now(),
  accepted_at timestamptz,
  ended_at timestamptz
);

create index if not exists protocol_photo_days_couple
  on public.protocol_photo_days (couple_id, created_at desc);

create table if not exists public.protocol_photo_day_turns (
  day_id uuid not null references public.protocol_photo_days (id) on delete cascade,
  turn_no integer not null,
  user_id uuid not null,
  challenge_id bigint not null references public.protocol_photo_challenges (id),
  status text not null default 'pending' check (status in ('pending', 'done', 'skipped')),
  photo_id uuid references public.protocol_photos (id) on delete set null,
  created_at timestamptz not null default now(),
  done_at timestamptz,
  primary key (day_id, turn_no)
);

-- accès uniquement par les fonctions ci-dessous
alter table public.protocol_photo_days enable row level security;
alter table public.protocol_photo_day_turns enable row level security;
revoke all on public.protocol_photo_days from anon, authenticated;
revoke all on public.protocol_photo_day_turns from anon, authenticated;


-- niveau du défi n° p_turn (1 à 4, trois défis par niveau)
create or replace function public.protocol_photo_day_level(p_turn integer, p_total integer)
returns integer
language sql
immutable
set search_path to ''
as $$
  select least(4, greatest(1, ceil(p_turn * 4.0 / greatest(p_total, 1))::integer))
$$;

-- tire le défi du tour (et l'enregistre)
create or replace function public.protocol_photo_day_draw(p_day_id uuid)
returns void
language plpgsql
security definer
set search_path to ''
as $$
declare
  v_day public.protocol_photo_days%rowtype;
  v_sex text;
  v_level integer;
  v_challenge bigint;
begin
  select * into v_day from public.protocol_photo_days where id = p_day_id;

  select p.sex into v_sex from public.protocol_profiles p where p.user_id = v_day.active_user;

  v_level := public.protocol_photo_day_level(v_day.turn_no, v_day.total_turns);

  -- même niveau d'abord, puis le plus proche en dessous ; jamais deux
  -- fois le même défi dans la journée ; les défis récents du duo
  -- passent après les autres
  select c.id into v_challenge
  from public.protocol_photo_challenges c
  where c.active
    and c.intensity <= v_level
    and (c.target_sex is null or c.target_sex = v_sex)
    and c.id not in (
      select t.challenge_id from public.protocol_photo_day_turns t where t.day_id = v_day.id
    )
  order by
    c.intensity desc,
    c.id in (
      select t.challenge_id
      from public.protocol_photo_day_turns t
      join public.protocol_photo_days d on d.id = t.day_id
      where d.couple_id = v_day.couple_id and d.id <> v_day.id
        and t.created_at > now() - interval '60 days'
    ),
    random()
  limit 1;

  if v_challenge is null then
    raise exception 'No photo challenge available';
  end if;

  insert into public.protocol_photo_day_turns (day_id, turn_no, user_id, challenge_id)
  values (v_day.id, v_day.turn_no, v_day.active_user, v_challenge);
end;
$$;


-- ---------------------------------------------------------
-- ÉTAT DE LA JOURNÉE (vu par le joueur connecté)
-- ---------------------------------------------------------

create or replace function public.get_photo_day()
returns jsonb
language plpgsql
security definer
set search_path to ''
as $$
declare
  v_me uuid := auth.uid();
  v_day public.protocol_photo_days%rowtype;
  v_turn record;
begin
  -- la journée en cours, ou la dernière des dernières 24 h
  select * into v_day
  from public.protocol_photo_days d
  where d.couple_id = public.protocol_my_couple_id()
    and (d.status in ('invited', 'active') or d.created_at > now() - interval '24 hours')
  order by (d.status in ('invited', 'active')) desc, d.created_at desc
  limit 1;

  if v_day.id is null then
    return null;
  end if;

  select t.*, c.title, c.prompt, c.intensity
  into v_turn
  from public.protocol_photo_day_turns t
  join public.protocol_photo_challenges c on c.id = t.challenge_id
  where t.day_id = v_day.id and t.turn_no = v_day.turn_no;

  return jsonb_build_object(
    'id', v_day.id,
    'status', v_day.status,
    'started_by_me', v_day.started_by = v_me,
    'my_turn', v_day.status = 'active' and v_day.active_user = v_me,
    'turn_no', v_day.turn_no,
    'total_turns', v_day.total_turns,
    'level', case when v_day.turn_no > 0
      then public.protocol_photo_day_level(v_day.turn_no, v_day.total_turns) end,
    -- le défi reste secret pour l'autre jusqu'à la photo
    'challenge', case
      when v_day.status = 'active' and v_day.active_user = v_me and v_turn.title is not null
        then jsonb_build_object('title', v_turn.title, 'prompt', v_turn.prompt)
    end,
    'done', (select count(*) from public.protocol_photo_day_turns t
             where t.day_id = v_day.id and t.status = 'done'),
    'ended_at', v_day.ended_at
  );
end;
$$;


-- ---------------------------------------------------------
-- LANCER, ACCEPTER, REFUSER, ARRÊTER
-- ---------------------------------------------------------

create or replace function public.start_photo_day()
returns jsonb
language plpgsql
security definer
set search_path to ''
as $$
declare
  v_me uuid := auth.uid();
  v_couple uuid := public.protocol_my_couple_id();
  v_partner uuid;
begin
  if v_couple is null then
    raise exception 'User does not belong to a couple';
  end if;

  select m.user_id into v_partner
  from public.protocol_couple_members m
  where m.couple_id = v_couple and m.user_id <> v_me
  limit 1;

  if v_partner is null then
    raise exception 'Partner not found';
  end if;

  if exists (
    select 1 from public.protocol_photo_days
    where couple_id = v_couple and status in ('invited', 'active')
  ) then
    raise exception 'A photo day is already running';
  end if;

  if not exists (select 1 from public.protocol_photo_challenges where active) then
    raise exception 'No photo challenge available';
  end if;

  insert into public.protocol_photo_days (couple_id, started_by, partner_id)
  values (v_couple, v_me, v_partner);

  return public.get_photo_day();
end;
$$;

create or replace function public.respond_photo_day(p_day_id uuid, p_accept boolean)
returns jsonb
language plpgsql
security definer
set search_path to ''
as $$
declare
  v_day public.protocol_photo_days%rowtype;
begin
  select * into v_day
  from public.protocol_photo_days
  where id = p_day_id
  for update;

  if v_day.id is null or v_day.partner_id <> auth.uid() or v_day.status <> 'invited' then
    raise exception 'Photo day not found';
  end if;

  if not coalesce(p_accept, false) then
    update public.protocol_photo_days
    set status = 'declined', ended_at = now()
    where id = p_day_id;

    return public.get_photo_day();
  end if;

  -- celui qui a lancé la journée relève le premier défi
  update public.protocol_photo_days
  set status = 'active', accepted_at = now(), turn_no = 1, active_user = v_day.started_by
  where id = p_day_id;

  perform public.protocol_photo_day_draw(p_day_id);

  return public.get_photo_day();
end;
$$;

create or replace function public.stop_photo_day(p_day_id uuid)
returns jsonb
language plpgsql
security definer
set search_path to ''
as $$
begin
  update public.protocol_photo_days
  set status = 'stopped', ended_at = now()
  where id = p_day_id
    and couple_id = public.protocol_my_couple_id()
    and status in ('invited', 'active');

  if not found then
    raise exception 'Photo day not found';
  end if;

  return public.get_photo_day();
end;
$$;


-- ---------------------------------------------------------
-- RELEVER OU PASSER SON DÉFI
-- ---------------------------------------------------------

create or replace function public.protocol_photo_day_advance(
  p_day_id uuid,
  p_status text,
  p_photo_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path to ''
as $$
declare
  v_me uuid := auth.uid();
  v_day public.protocol_photo_days%rowtype;
begin
  select * into v_day
  from public.protocol_photo_days
  where id = p_day_id
  for update;

  if v_day.id is null or v_day.status <> 'active' or v_day.active_user <> v_me then
    raise exception 'Not your photo challenge';
  end if;

  if p_photo_id is not null and not exists (
    select 1 from public.protocol_photos p
    where p.id = p_photo_id and p.couple_id = v_day.couple_id
      and p.sender_user_id = v_me and p.ready
  ) then
    raise exception 'Photo not found';
  end if;

  update public.protocol_photo_day_turns
  set status = p_status, photo_id = p_photo_id, done_at = now()
  where day_id = v_day.id and turn_no = v_day.turn_no;

  if v_day.turn_no >= v_day.total_turns then
    update public.protocol_photo_days
    set status = 'finished', ended_at = now(), active_user = null
    where id = v_day.id;
  else
    update public.protocol_photo_days
    set turn_no = turn_no + 1,
        active_user = case when v_me = started_by then partner_id else started_by end
    where id = v_day.id;

    perform public.protocol_photo_day_draw(v_day.id);
  end if;

  return public.get_photo_day();
end;
$$;

create or replace function public.complete_photo_turn(p_day_id uuid, p_photo_id uuid)
returns jsonb
language sql
security definer
set search_path to ''
as $$
  select public.protocol_photo_day_advance(p_day_id, 'done', p_photo_id)
$$;

create or replace function public.skip_photo_turn(p_day_id uuid)
returns jsonb
language sql
security definer
set search_path to ''
as $$
  select public.protocol_photo_day_advance(p_day_id, 'skipped', null)
$$;


-- ---------------------------------------------------------
-- DROITS
-- ---------------------------------------------------------

revoke all on function public.protocol_photo_day_draw(uuid) from public, anon, authenticated;
revoke all on function public.protocol_photo_day_advance(uuid, text, uuid) from public, anon, authenticated;
revoke all on function public.get_photo_day() from public, anon;
revoke all on function public.start_photo_day() from public, anon;
revoke all on function public.respond_photo_day(uuid, boolean) from public, anon;
revoke all on function public.stop_photo_day(uuid) from public, anon;
revoke all on function public.complete_photo_turn(uuid, uuid) from public, anon;
revoke all on function public.skip_photo_turn(uuid) from public, anon;

grant execute on function public.get_photo_day() to authenticated;
grant execute on function public.start_photo_day() to authenticated;
grant execute on function public.respond_photo_day(uuid, boolean) to authenticated;
grant execute on function public.stop_photo_day(uuid) to authenticated;
grant execute on function public.complete_photo_turn(uuid, uuid) to authenticated;
grant execute on function public.skip_photo_turn(uuid) to authenticated;
