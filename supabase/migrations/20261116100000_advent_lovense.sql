-- =========================================================
-- Calendrier de l'Avent : curseurs Lovense sous une case
--   Chaque version d'une case (douce, osée, noire) peut désigner
--   un jouet : 'lush', 'ring' ou 'both'. L'app affiche alors le
--   même panneau que sous les cartes, si le jouet est connecté.
--   Les valeurs se posent hors dépôt, comme les textes.
-- Migration rejouable sans risque.
-- =========================================================

alter table public.protocol_advent_days
  add column if not exists soft_lovense_toy text,
  add column if not exists lovense_toy text,
  add column if not exists black_lovense_toy text;

alter table public.protocol_advent_days
  drop constraint if exists protocol_advent_days_lovense_toy_check;
alter table public.protocol_advent_days
  add constraint protocol_advent_days_lovense_toy_check check (
    (soft_lovense_toy is null or soft_lovense_toy in ('lush', 'ring', 'both'))
    and (lovense_toy is null or lovense_toy in ('lush', 'ring', 'both'))
    and (black_lovense_toy is null or black_lovense_toy in ('lush', 'ring', 'both'))
  );


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
      'has_black', d.black_prompt is not null,
      'opened', p.opened_at is not null,
      'opened_by', p.opened_by,
      'done', p.done_at is not null,
      'done_variant', p.done_variant
    )
    -- jouets : seulement une fois la case ouverte, comme les textes
    || case when d.day <= v_today or v_preview then
         jsonb_build_object(
           'soft_lovense_toy', d.soft_lovense_toy,
           'lovense_toy', d.lovense_toy,
           'black_lovense_toy', d.black_lovense_toy
         )
       else '{}'::jsonb end
    order by d.day
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

revoke all on function public.get_protocol_advent(boolean) from public, anon;
grant execute on function public.get_protocol_advent(boolean) to authenticated;
