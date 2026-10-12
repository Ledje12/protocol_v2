-- =========================================================
-- Défis photo dans la bibliothèque
--   Les membres d'un duo peuvent lire le catalogue des défis
--   photo (lecture seule), pour les parcourir et en envoyer un
--   à l'autre en message. La table reste fermée à l'app : on ne
--   la lit que par cette fonction.
-- Migration rejouable sans risque.
-- =========================================================

create or replace function public.get_photo_challenges()
returns table (
  id bigint,
  title text,
  prompt text,
  intensity smallint,
  target_sex text
)
language sql
stable
security definer
set search_path to ''
as $$
  select c.id, c.title, c.prompt, c.intensity, c.target_sex
  from public.protocol_photo_challenges c
  where c.active
    and public.protocol_my_couple_id() is not null
  order by c.intensity, c.title
$$;

revoke all on function public.get_photo_challenges() from public, anon;
grant execute on function public.get_photo_challenges() to authenticated;
