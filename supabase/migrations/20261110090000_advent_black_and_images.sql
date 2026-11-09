-- =========================================================
-- Calendrier de l'Avent : carte noire et illustrations à gratter
--   Carte noire : une troisième version, plus loin que l'Osée,
--   certains jours seulement (black_title, black_prompt, remplies
--   à part, hors dépôt). Scellée comme les autres.
--   Illustrations : bucket privé « protocol-advent », un fichier
--   par case (jour-01.webp … jour-24.webp), déposé à la main. Une
--   image n'est lisible qu'à partir de son jour (heure de Paris),
--   comme le texte ; un admin peut tout voir en aperçu.
-- Migration rejouable sans risque.
-- =========================================================

alter table public.protocol_advent_days
  add column if not exists black_title text,
  add column if not exists black_prompt text;

alter table public.protocol_advent_progress
  drop constraint if exists protocol_advent_progress_done_variant_check;

alter table public.protocol_advent_progress
  add constraint protocol_advent_progress_done_variant_check
  check (done_variant is null or done_variant in ('soft', 'bold', 'black'));


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
      'soft_title', case when d.day <= v_today or v_preview then d.soft_title end,
      'soft_prompt', case when d.day <= v_today or v_preview then d.soft_prompt end,
      'black_title', case when d.day <= v_today or v_preview then d.black_title end,
      'black_prompt', case when d.day <= v_today or v_preview then d.black_prompt end,
      -- la case cache-t-elle une carte noire ? (visible avant le jour)
      'has_black', d.black_prompt is not null,
      'opened', p.opened_at is not null,
      'opened_by', p.opened_by,
      'done', p.done_at is not null,
      'done_variant', p.done_variant
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


create or replace function public.set_protocol_advent(
  p_day smallint,
  p_done boolean default null,
  p_variant text default null
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

  if p_variant is not null and p_variant not in ('soft', 'bold', 'black') then
    raise exception 'Invalid variant';
  end if;

  insert into public.protocol_advent_progress (couple_id, year, day, opened_at, opened_by)
  values (v_couple, v_year, p_day, now(), auth.uid())
  on conflict (couple_id, year, day) do nothing;

  if p_done is not null then
    update public.protocol_advent_progress
       set done_at = case when p_done then now() end,
           done_variant = case when p_done then coalesce(p_variant, 'bold') end
     where couple_id = v_couple and year = v_year and day = p_day;
  end if;
end;
$$;


-- jour d'une illustration d'après son nom (« jour-07.webp » → 7)
create or replace function public.protocol_advent_image_day(p_name text)
returns smallint
language sql
immutable
set search_path to ''
as $$
  select nullif(substring(p_name from '^jour-([0-9]{2})\.webp$'), '')::smallint
$$;

revoke all on function public.protocol_advent_image_day(text) from public, anon;
grant execute on function public.protocol_advent_image_day(text) to authenticated;


insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('protocol-advent', 'protocol-advent', false, 2097152, array['image/webp'])
on conflict (id) do nothing;

-- lecture seule, à partir du jour de la case (aperçu : un admin)
drop policy if exists "protocol_advent_read" on storage.objects;
create policy "protocol_advent_read"
  on storage.objects
  for select
  to authenticated
  using (
    bucket_id = 'protocol-advent'
    and (
      public.protocol_advent_image_day(name) <= public.protocol_advent_today()
      or public.protocol_is_admin()
    )
  );
