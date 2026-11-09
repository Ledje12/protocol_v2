-- =========================================================
-- Calendrier de l'Avent : case 0, « L'invitation »
--   Une case à part, ouvrable tout de suite (avant le 1er décembre),
--   pour présenter le calendrier à deux : les règles et une première
--   consigne. Même contenu hors dépôt, même illustration à gratter
--   (jour-00.webp). Les fonctions existantes la traitent déjà comme
--   ouverte (0 <= jour de l'Avent) ; seules les bornes changent.
-- Migration rejouable sans risque.
-- =========================================================

alter table public.protocol_advent_days
  drop constraint if exists protocol_advent_days_day_check;
alter table public.protocol_advent_days
  add constraint protocol_advent_days_day_check check (day between 0 and 24);

alter table public.protocol_advent_progress
  drop constraint if exists protocol_advent_progress_day_check;
alter table public.protocol_advent_progress
  add constraint protocol_advent_progress_day_check check (day between 0 and 24);


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

  if p_day is null or p_day not between 0 and 24 then
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

revoke all on function public.set_protocol_advent(smallint, boolean, text) from public, anon;
grant execute on function public.set_protocol_advent(smallint, boolean, text) to authenticated;
