-- =========================================================
-- Avis sur les cartes : 🔥 j'adore, 👍 j'aime, 👎 je n'aime pas
--   Facultatifs et privés : chacun ne voit que ses propres avis.
--   Aucun effet sur le tirage : ce sont des données pour
--   comprendre ce qui plaît (à croiser avec game_card_history).
-- Migration rejouable sans risque.
-- =========================================================

create table if not exists public.protocol_card_ratings (
  user_id uuid not null references auth.users (id) on delete cascade,
  card_source text not null
    check (card_source in ('official', 'custom')),
  card_id bigint not null,
  rating text not null
    check (rating in ('fire', 'like', 'dislike')),
  rated_at timestamptz not null default now(),
  primary key (user_id, card_source, card_id)
);

alter table public.protocol_card_ratings enable row level security;

drop policy if exists "protocol_card_ratings_own" on public.protocol_card_ratings;
create policy "protocol_card_ratings_own"
  on public.protocol_card_ratings
  for select
  to authenticated
  using (user_id = auth.uid());

revoke all on public.protocol_card_ratings from anon;
grant select on public.protocol_card_ratings to authenticated;


-- poser, changer ou retirer (p_rating null) son avis
create or replace function public.set_card_rating(
  p_card_source text,
  p_card_id bigint,
  p_rating text
)
returns text
language plpgsql
security definer
set search_path to ''
as $$
begin
  if auth.uid() is null then
    raise exception 'Authentication required';
  end if;

  if p_card_source not in ('official', 'custom') then
    raise exception 'Invalid card source';
  end if;

  if p_rating is null then
    delete from public.protocol_card_ratings
    where user_id = auth.uid()
      and card_source = p_card_source
      and card_id = p_card_id;

    return null;
  end if;

  if p_rating not in ('fire', 'like', 'dislike') then
    raise exception 'Invalid rating';
  end if;

  insert into public.protocol_card_ratings
    (user_id, card_source, card_id, rating, rated_at)
  values
    (auth.uid(), p_card_source, p_card_id, p_rating, now())
  on conflict (user_id, card_source, card_id) do update
    set rating = excluded.rating,
        rated_at = excluded.rated_at;

  return p_rating;
end;
$$;

revoke all on function public.set_card_rating(text, bigint, text) from public, anon;
grant execute on function public.set_card_rating(text, bigint, text) to authenticated;


-- ---------------------------------------------------------
-- Lecture des statistiques (à lancer dans le SQL Editor)
-- ---------------------------------------------------------
-- select c.id, c.title, f.category,
--   count(*) filter (where h.outcome = 'done')        as faites,
--   count(*) filter (where h.outcome = 'pass')        as passees,
--   count(*) filter (where h.outcome = 'alternative') as remplacees,
--   (select count(*) from public.protocol_card_ratings r
--     where r.card_source = 'official' and r.card_id = c.id and r.rating = 'fire')    as fire,
--   (select count(*) from public.protocol_card_ratings r
--     where r.card_source = 'official' and r.card_id = c.id and r.rating = 'like')    as like,
--   (select count(*) from public.protocol_card_ratings r
--     where r.card_source = 'official' and r.card_id = c.id and r.rating = 'dislike') as dislike
-- from public.protocol_cards c
-- left join public.protocol_card_families f on f.family_key = c.family_key
-- left join public.game_card_history h
--   on h.card_source = 'official' and h.card_id = c.id
-- group by c.id, c.title, f.category
-- order by faites desc;
