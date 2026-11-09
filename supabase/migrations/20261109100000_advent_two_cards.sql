-- =========================================================
-- Calendrier de l'Avent : deux cartes par jour, Douce ou Osée
--   La carte existante (title, prompt) devient la version « osée » ;
--   la version « douce » s'ajoute (soft_title, soft_prompt, remplies
--   à part, hors dépôt). On choisit selon l'envie du jour, sans
--   verrou : « Défi relevé » retient simplement laquelle.
--   Toujours scellées côté serveur jusqu'à leur jour.
-- Migration rejouable sans risque.
-- =========================================================

alter table public.protocol_advent_days
  add column if not exists soft_title text,
  add column if not exists soft_prompt text;

alter table public.protocol_advent_progress
  add column if not exists done_variant text
    check (done_variant is null or done_variant in ('soft', 'bold'));


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


-- ouvrir une case, ou marquer un défi relevé (et lequel)
drop function if exists public.set_protocol_advent(smallint, boolean);

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

  if p_variant is not null and p_variant not in ('soft', 'bold') then
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

revoke all on function public.get_protocol_advent(boolean) from public, anon;
revoke all on function public.set_protocol_advent(smallint, boolean, text) from public, anon;
grant execute on function public.get_protocol_advent(boolean) to authenticated;
grant execute on function public.set_protocol_advent(smallint, boolean, text) to authenticated;
