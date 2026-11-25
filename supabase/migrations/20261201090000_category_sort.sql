-- =========================================================
-- Catégories, deuxième passe : « Positions » devient « Sexe »,
-- « Liens » devient « Sensations » ; les liens (attaches, cordes,
-- bâillon, barre d'écartement) rejoignent « Domination », le plug
-- rejoint « Anal », l'uniforme et la bimbo rejoignent « Scénarios ».
-- Trois familles naissent : toy_kinky (jouets des cartes kinky,
-- invisibles aux couples « vanilla seulement »), rp_exhib (jeux de
-- rôle exhib) et closing (cartes de fin, rangées dans Confidences).
-- Rejouable.
-- =========================================================

do $$
declare
  renames constant text[][] := array[
    ['Positions', 'Sexe'],
    ['Liens', 'Sensations']
  ];
  moves constant text[][] := array[
    ['toy_plug', 'Anal'],
    ['restraint', 'Domination'], ['rope', 'Domination'],
    ['gag', 'Domination'], ['spreader', 'Domination'],
    ['uniform', 'Scénarios'], ['bimbo', 'Scénarios']
  ];
  i int;
begin
  for i in 1 .. array_length(renames, 1) loop
    update public.protocol_card_families set category = renames[i][2] where category = renames[i][1];
    update public.games set desire_category = renames[i][2] where desire_category = renames[i][1];
  end loop;

  for i in 1 .. array_length(moves, 1) loop
    update public.protocol_card_families f
       set category = moves[i][2],
           category_position = (select min(category_position) from public.protocol_card_families
                                 where category = moves[i][2])
     where f.family_key = moves[i][1]
       and f.category <> moves[i][2]
       and exists (select 1 from public.protocol_card_families where category = moves[i][2]);
  end loop;

  if exists (select 1 from public.protocol_card_families where category = 'Jouets') then
    insert into public.protocol_card_families (family_key, category, category_position, style, spice)
    select 'toy_kinky', 'Jouets', min(category_position), 'kinky', 3
      from public.protocol_card_families where category = 'Jouets'
    on conflict (family_key) do nothing;
  end if;

  if exists (select 1 from public.protocol_card_families where category = 'Scénarios') then
    insert into public.protocol_card_families (family_key, category, category_position, style, spice)
    select 'rp_exhib', 'Scénarios', min(category_position), 'kinky', 3
      from public.protocol_card_families where category = 'Scénarios'
    on conflict (family_key) do nothing;
  end if;

  if exists (select 1 from public.protocol_card_families where category = 'Confidences') then
    insert into public.protocol_card_families (family_key, category, category_position, style, spice)
    select 'closing', 'Confidences', min(category_position), 'vanilla', 1
      from public.protocol_card_families where category = 'Confidences'
    on conflict (family_key) do nothing;
  end if;
end
$$;
