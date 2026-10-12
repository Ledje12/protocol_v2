-- =========================================================
-- « Nos favoris » : les cartes notées 🔥 par vous deux.
--   Les avis restent privés : cette fonction ne renvoie que les
--   cartes où les deux avis sont 🔥, jamais l'avis de l'autre
--   sur une carte précise sinon. Consultation seule (bibliothèque).
-- Migration rejouable sans risque.
-- =========================================================

create or replace function public.get_couple_favorites()
returns table (card_source text, card_id bigint)
language sql
stable
security definer
set search_path to ''
as $$
  select r.card_source, r.card_id
  from public.protocol_card_ratings r
  join public.protocol_couple_members m
    on m.user_id = r.user_id
   and m.couple_id = public.protocol_my_couple_id()
  where r.rating = 'fire'
  group by r.card_source, r.card_id
  having count(distinct r.user_id) = 2
$$;

revoke all on function public.get_couple_favorites() from public, anon;
grant execute on function public.get_couple_favorites() to authenticated;
