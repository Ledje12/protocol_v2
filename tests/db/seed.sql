-- Cartes synthétiques pour les tests automatiques.
-- Le dépôt est public : aucune vraie carte ici, seulement des textes
-- neutres générés (« Carte test … », clés « test-… »). Une carte par famille et par
-- niveau d'intensité, le type tournant d'une famille à l'autre ;
-- deux tiers des cartes (hors duels) visent un sexe précis. Chaque scène a trois
-- étapes, dont une privée (un texte différent pour chaque joueur).

begin;

with fam as (
  select
    family_key,
    row_number() over (order by family_key) as n
  from public.protocol_card_families
)
insert into public.protocol_cards (
  type, title, prompt, intensity, active,
  target_sex, library_version, library_key, family_key
)
select
  t.type,
  'Carte test ' || f.n || '.' || i,
  'Consigne de test pour {{partner}} (' || t.type || ', niveau ' || i || ').',
  i,
  true,
  case
    when t.type = 'duel' then null -- un duel se joue à deux
    when (f.n + i) % 3 = 1 then 'female'
    when (f.n + i) % 3 = 2 then 'male'
  end,
  'v1',
  'test-' || f.family_key || '-' || i,
  f.family_key
from fam f
cross join generate_series(1, 5) as i
cross join lateral (
  -- comme la vraie bibliothèque : pas de scène au niveau 1
  select case
    when (f.n + i) % 4 = 3 and i = 1 then 'action'
    else (array['truth', 'action', 'duel', 'scene'])[1 + (f.n + i) % 4]
  end as type
) t;

insert into public.protocol_scene_steps (
  card_id, step_no, title, prompt, prompt_player_1, prompt_player_2
)
select
  c.id,
  s,
  'Étape ' || s,
  'Étape de test ' || s || '.',
  case when s = 2 then 'Texte privé du joueur 1.' end,
  case when s = 2 then 'Texte privé du joueur 2.' end
from public.protocol_cards c
cross join generate_series(1, 3) as s
where c.type = 'scene'
  and c.library_key like 'test-%';

commit;
