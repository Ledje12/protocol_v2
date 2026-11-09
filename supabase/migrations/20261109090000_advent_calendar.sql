-- =========================================================
-- Calendrier de l'Avent : un défi par jour, du 1er au 24 décembre
--   Les 24 textes sont dans protocol_advent_days (remplie à part,
--   hors dépôt). Une case ne se dévoile qu'à partir de son jour
--   (heure de Paris), vérifié ici : impossible de tricher depuis
--   l'app. Les jours passés restent ouvrables.
--   Suivi par couple et par année : case ouverte, défi relevé.
--   Aperçu : un admin lit toutes les cases avant l'heure (sans
--   rien enregistrer).
-- Migration rejouable sans risque.
-- =========================================================

create table if not exists public.protocol_advent_days (
  day smallint primary key check (day between 1 and 24),
  title text not null,
  prompt text not null
);

create table if not exists public.protocol_advent_progress (
  couple_id uuid not null,
  year smallint not null,
  day smallint not null check (day between 1 and 24),
  opened_at timestamptz,
  opened_by uuid,
  done_at timestamptz,
  primary key (couple_id, year, day)
);

-- aucune politique : accès uniquement par les fonctions ci-dessous
alter table public.protocol_advent_days enable row level security;
alter table public.protocol_advent_progress enable row level security;
revoke all on public.protocol_advent_days from anon, authenticated;
revoke all on public.protocol_advent_progress from anon, authenticated;


-- jour de l'Avent à Paris : 0 avant le 1er décembre, 1 à 24
-- pendant, 25 après (tout est ouvert jusqu'à la fin de l'année)
create or replace function public.protocol_advent_today()
returns smallint
language sql
stable
set search_path to ''
as $$
  select case
    when extract(month from now() at time zone 'Europe/Paris') = 12
      then least(extract(day from now() at time zone 'Europe/Paris'), 25)::smallint
    else 0::smallint
  end
$$;


-- le calendrier du couple : cases, ce qui est ouvert, ce qui est
-- relevé. Le texte n'est renvoyé que pour les cases dévoilées.
create or replace function public.get_protocol_advent(p_preview boolean default false)
returns jsonb
language plpgsql
stable
security definer
set search_path to ''
as $$
declare
  v_couple uuid := public.protocol_my_couple_id();
  v_year smallint := extract(year from now() at time zone 'Europe/Paris')::smallint;
  v_today smallint := public.protocol_advent_today();
  v_preview boolean := coalesce(p_preview, false) and public.protocol_is_admin();
  v_days jsonb;
begin
  if v_couple is null then
    raise exception 'No couple';
  end if;

  select coalesce(jsonb_agg(
    jsonb_build_object(
      'day', d.day,
      'unlocked', d.day <= v_today or v_preview,
      'title', case when d.day <= v_today or v_preview then d.title end,
      'prompt', case when d.day <= v_today or v_preview then d.prompt end,
      'opened', p.opened_at is not null,
      'opened_by', p.opened_by,
      'done', p.done_at is not null
    ) order by d.day
  ), '[]'::jsonb)
  into v_days
  from public.protocol_advent_days d
  left join public.protocol_advent_progress p
    on p.couple_id = v_couple and p.year = v_year and p.day = d.day;

  return jsonb_build_object(
    'year', v_year,
    'today', v_today,
    'preview', v_preview,
    'days', v_days
  );
end;
$$;


-- ouvrir une case (la première fois), ou marquer le défi relevé
-- (l'aperçu admin ne fait que lire : rien n'est enregistré avant le jour)
drop function if exists public.set_protocol_advent(smallint, boolean, boolean);

create or replace function public.set_protocol_advent(
  p_day smallint,
  p_done boolean default null
)
returns void
language plpgsql
security definer
set search_path to ''
as $$
declare
  v_couple uuid := public.protocol_my_couple_id();
  v_year smallint := extract(year from now() at time zone 'Europe/Paris')::smallint;
begin
  if v_couple is null then
    raise exception 'No couple';
  end if;

  if p_day is null or p_day not between 1 and 24 then
    raise exception 'Invalid day';
  end if;

  if p_day > public.protocol_advent_today() then
    raise exception 'Not yet';
  end if;

  insert into public.protocol_advent_progress (couple_id, year, day, opened_at, opened_by)
  values (v_couple, v_year, p_day, now(), auth.uid())
  on conflict (couple_id, year, day) do nothing;

  if p_done is not null then
    update public.protocol_advent_progress
       set done_at = case when p_done then coalesce(done_at, now()) end
     where couple_id = v_couple and year = v_year and day = p_day;
  end if;
end;
$$;

revoke all on function public.protocol_advent_today() from public, anon;
revoke all on function public.get_protocol_advent(boolean) from public, anon;
revoke all on function public.set_protocol_advent(smallint, boolean) from public, anon;
grant execute on function public.protocol_advent_today() to authenticated;
grant execute on function public.get_protocol_advent(boolean) to authenticated;
grant execute on function public.set_protocol_advent(smallint, boolean) to authenticated;
