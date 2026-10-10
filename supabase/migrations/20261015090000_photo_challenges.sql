-- =========================================================
-- Défis photo (jeu « À distance »)
--   Catalogue séparé de la bibliothèque : un défi photo ne sort
--   jamais dans une partie classique, et une carte classique
--   jamais dans les défis. Pas de style Vanilla / Kinky : tout
--   se mélange. Intensité de 1 à 4 (la journée monte de 1 à 4).
--   Rempli par SQL, comme les cartes ; illisible depuis l'app
--   (les défis passent par les fonctions du jeu).
-- Migration rejouable sans risque.
-- =========================================================

create table if not exists public.protocol_photo_challenges (
  id bigint generated always as identity primary key,
  title text not null,
  prompt text not null,
  intensity smallint not null check (intensity between 1 and 4),
  target_sex text check (target_sex is null or target_sex in ('male', 'female')),
  active boolean not null default true,
  created_at timestamptz not null default now()
);

alter table public.protocol_photo_challenges enable row level security;
revoke all on public.protocol_photo_challenges from anon, authenticated;
