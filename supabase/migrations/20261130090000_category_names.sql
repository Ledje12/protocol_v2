-- =========================================================
-- Catégories : un seul mot évocateur par catégorie.
-- « Hors piste » devient « Anal » ; la famille urine rejoint
-- « Domination ». Rejouable : chaque renommage ne touche que
-- l'ancien nom. L'envie affichée d'une partie suit le nouveau nom.
-- =========================================================

do $$
declare
  renames constant text[][] := array[
    ['Baisers & caresses', 'Caresses'],
    ['Corps à corps', 'Positions'],
    ['Tenues & regards', 'Effeuillage'],
    ['Jeux de rôle', 'Scénarios'],
    ['Domination & contrôle', 'Domination'],
    ['Liens & sensations', 'Liens'],
    ['Jouir ou pas', 'Frustration'],
    ['Dehors & ailleurs', 'Ailleurs'],
    ['Mots & confidences', 'Confidences'],
    ['Fantasmes à plusieurs', 'Partage'],
    ['Jeux & surprises', 'Surprises'],
    ['Hors piste', 'Anal'],
    ['Les inédits', 'Inédits']
  ];
  i int;
begin
  -- urine quitte « Hors piste » avant le renommage en « Anal »
  update public.protocol_card_families f
     set category = d.category,
         category_position = d.category_position
    from (
      select category, category_position
        from public.protocol_card_families
       where category in ('Domination & contrôle', 'Domination')
       limit 1
    ) d
   where f.family_key = 'urine'
     and f.category in ('Hors piste', 'Anal');

  for i in 1 .. array_length(renames, 1) loop
    update public.protocol_card_families
       set category = renames[i][2]
     where category = renames[i][1];

    update public.games
       set desire_category = renames[i][2]
     where desire_category = renames[i][1];
  end loop;
end
$$;
