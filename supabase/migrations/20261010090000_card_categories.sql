-- =========================================================
-- Catégories de la bibliothèque et style des cartes
--   1. Familles de cartes -> catégorie + style (vanille / kinky)
--   2. Réglage du couple : Vanille, Kinky ou Les deux (défaut)
--   3. Le tirage respecte ce réglage en mode « Sur mesure »
-- Migration rejouable sans risque.
-- =========================================================


-- ---------------------------------------------------------
-- 1. FAMILLES
--    Une famille absente de cette table apparaît en « Autres »
--    et sort dans tous les modes : rien ne disparaît par oubli.
-- ---------------------------------------------------------

create table if not exists public.protocol_card_families (
  family_key text primary key,
  category text not null,
  category_position smallint not null default 99,
  style text not null default 'vanilla'
    check (style in ('vanilla', 'kinky'))
);

alter table public.protocol_card_families enable row level security;

drop policy if exists "protocol_card_families_read" on public.protocol_card_families;
create policy "protocol_card_families_read"
  on public.protocol_card_families
  for select
  to authenticated
  using (true);

revoke all on public.protocol_card_families from anon;
grant select on public.protocol_card_families to authenticated;

insert into public.protocol_card_families
  (family_key, category, category_position, style)
values
  ('kiss', 'Baisers & caresses', 1, 'vanilla'),
  ('massage', 'Baisers & caresses', 1, 'vanilla'),
  ('massage_rp', 'Baisers & caresses', 1, 'vanilla'),
  ('hands_guided', 'Baisers & caresses', 1, 'vanilla'),
  ('secret_touch', 'Baisers & caresses', 1, 'vanilla'),
  ('fingering', 'Baisers & caresses', 1, 'vanilla'),
  ('handjob', 'Baisers & caresses', 1, 'vanilla'),
  ('breasts', 'Baisers & caresses', 1, 'vanilla'),
  ('feet', 'Baisers & caresses', 1, 'vanilla'),
  ('worship', 'Baisers & caresses', 1, 'vanilla'),
  ('shower', 'Baisers & caresses', 1, 'vanilla'),
  ('water', 'Baisers & caresses', 1, 'vanilla'),
  ('gel', 'Baisers & caresses', 1, 'vanilla'),
  ('grinding', 'Baisers & caresses', 1, 'vanilla'),
  ('us_time', 'Baisers & caresses', 1, 'vanilla'),
  ('slow_aftercare', 'Baisers & caresses', 1, 'vanilla'),
  ('slow_sex', 'Baisers & caresses', 1, 'vanilla'),
  ('fellatio', 'Bouche', 2, 'vanilla'),
  ('cunnilingus', 'Bouche', 2, 'vanilla'),
  ('oral_69', 'Bouche', 2, 'vanilla'),
  ('facesitting', 'Bouche', 2, 'vanilla'),
  ('anilingus', 'Bouche', 2, 'kinky'),
  ('throat', 'Bouche', 2, 'kinky'),
  ('spit', 'Bouche', 2, 'kinky'),
  ('sex_scene', 'Corps à corps', 3, 'vanilla'),
  ('pos_behind', 'Corps à corps', 3, 'vanilla'),
  ('pos_face', 'Corps à corps', 3, 'vanilla'),
  ('pos_furniture', 'Corps à corps', 3, 'vanilla'),
  ('pos_named', 'Corps à corps', 3, 'vanilla'),
  ('pos_on_top', 'Corps à corps', 3, 'vanilla'),
  ('pos_rhythm', 'Corps à corps', 3, 'vanilla'),
  ('pos_side', 'Corps à corps', 3, 'vanilla'),
  ('pos_still', 'Corps à corps', 3, 'vanilla'),
  ('quickie', 'Corps à corps', 3, 'vanilla'),
  ('place_change', 'Corps à corps', 3, 'vanilla'),
  ('wakeup', 'Corps à corps', 3, 'vanilla'),
  ('sleep', 'Corps à corps', 3, 'vanilla'),
  ('squirt', 'Corps à corps', 3, 'vanilla'),
  ('cum_where', 'Corps à corps', 3, 'vanilla'),
  ('cum_play', 'Corps à corps', 3, 'kinky'),
  ('toy_vibe', 'Jouets', 4, 'vanilla'),
  ('toy_dildo', 'Jouets', 4, 'vanilla'),
  ('toy_rabbit', 'Jouets', 4, 'vanilla'),
  ('toy_suction', 'Jouets', 4, 'vanilla'),
  ('toy_ventouse', 'Jouets', 4, 'vanilla'),
  ('toy_fleshlight', 'Jouets', 4, 'vanilla'),
  ('toy_geisha', 'Jouets', 4, 'vanilla'),
  ('toy_double', 'Jouets', 4, 'vanilla'),
  ('toy_plug', 'Jouets', 4, 'kinky'),
  ('toy_strapon', 'Jouets', 4, 'kinky'),
  ('toy_lovense', 'Jouets', 4, 'vanilla'),
  ('cock_ring', 'Jouets', 4, 'vanilla'),
  ('prostate', 'Jouets', 4, 'kinky'),
  ('lingerie', 'Tenues & regards', 5, 'vanilla'),
  ('open_lingerie', 'Tenues & regards', 5, 'vanilla'),
  ('thong', 'Tenues & regards', 5, 'vanilla'),
  ('see_through', 'Tenues & regards', 5, 'vanilla'),
  ('skintight', 'Tenues & regards', 5, 'vanilla'),
  ('secret_outfit', 'Tenues & regards', 5, 'vanilla'),
  ('outfit_choice', 'Tenues & regards', 5, 'vanilla'),
  ('outfit_stays_on', 'Tenues & regards', 5, 'vanilla'),
  ('dress_him', 'Tenues & regards', 5, 'vanilla'),
  ('heels_fetish', 'Tenues & regards', 5, 'kinky'),
  ('uniform', 'Tenues & regards', 5, 'vanilla'),
  ('striptease', 'Tenues & regards', 5, 'vanilla'),
  ('tease_glimpse', 'Tenues & regards', 5, 'vanilla'),
  ('display', 'Tenues & regards', 5, 'kinky'),
  ('watch_me', 'Tenues & regards', 5, 'vanilla'),
  ('mirror_photo', 'Tenues & regards', 5, 'vanilla'),
  ('camera_exhib', 'Tenues & regards', 5, 'kinky'),
  ('twerk', 'Tenues & regards', 5, 'vanilla'),
  ('bimbo', 'Tenues & regards', 5, 'kinky'),
  ('clothed_naked', 'Tenues & regards', 5, 'vanilla'),
  ('strip_games', 'Tenues & regards', 5, 'vanilla'),
  ('solo_duo', 'Tenues & regards', 5, 'vanilla'),
  ('rp_strangers', 'Jeux de rôle', 6, 'vanilla'),
  ('rp_tradesmen', 'Jeux de rôle', 6, 'vanilla'),
  ('rp_work', 'Jeux de rôle', 6, 'vanilla'),
  ('rp_mission', 'Jeux de rôle', 6, 'vanilla'),
  ('rp_authority', 'Jeux de rôle', 6, 'vanilla'),
  ('rp_affair', 'Jeux de rôle', 6, 'vanilla'),
  ('rp_jealousy', 'Jeux de rôle', 6, 'vanilla'),
  ('rp_medical', 'Jeux de rôle', 6, 'vanilla'),
  ('rp_paid', 'Jeux de rôle', 6, 'kinky'),
  ('her_roleplay', 'Jeux de rôle', 6, 'vanilla'),
  ('mask', 'Jeux de rôle', 6, 'vanilla'),
  ('orders', 'Domination & contrôle', 7, 'kinky'),
  ('service', 'Domination & contrôle', 7, 'kinky'),
  ('queen', 'Domination & contrôle', 7, 'kinky'),
  ('praise', 'Domination & contrôle', 7, 'vanilla'),
  ('degradation', 'Domination & contrôle', 7, 'kinky'),
  ('pet_play', 'Domination & contrôle', 7, 'kinky'),
  ('cnc', 'Domination & contrôle', 7, 'kinky'),
  ('contract', 'Domination & contrôle', 7, 'kinky'),
  ('passive_freeuse', 'Domination & contrôle', 7, 'kinky'),
  ('offering', 'Domination & contrôle', 7, 'kinky'),
  ('rough', 'Domination & contrôle', 7, 'kinky'),
  ('restraint', 'Liens & sensations', 8, 'kinky'),
  ('rope', 'Liens & sensations', 8, 'kinky'),
  ('gag', 'Liens & sensations', 8, 'kinky'),
  ('spreader', 'Liens & sensations', 8, 'kinky'),
  ('blindfold_senses', 'Liens & sensations', 8, 'vanilla'),
  ('impact', 'Liens & sensations', 8, 'kinky'),
  ('slap', 'Liens & sensations', 8, 'kinky'),
  ('martinet', 'Liens & sensations', 8, 'kinky'),
  ('wax', 'Liens & sensations', 8, 'kinky'),
  ('tickling', 'Liens & sensations', 8, 'vanilla'),
  ('orgasm_control', 'Jouir ou pas', 9, 'kinky'),
  ('edging', 'Jouir ou pas', 9, 'kinky'),
  ('ruined', 'Jouir ou pas', 9, 'kinky'),
  ('overstim', 'Jouir ou pas', 9, 'kinky'),
  ('chastity', 'Jouir ou pas', 9, 'kinky'),
  ('duel_edge', 'Jouir ou pas', 9, 'kinky'),
  ('out_cinema', 'Dehors & ailleurs', 10, 'vanilla'),
  ('out_deserted', 'Dehors & ailleurs', 10, 'vanilla'),
  ('out_nature', 'Dehors & ailleurs', 10, 'vanilla'),
  ('out_restaurant', 'Dehors & ailleurs', 10, 'vanilla'),
  ('outside_car', 'Dehors & ailleurs', 10, 'kinky'),
  ('car_ride', 'Dehors & ailleurs', 10, 'vanilla'),
  ('public_discreet', 'Dehors & ailleurs', 10, 'kinky'),
  ('club', 'Dehors & ailleurs', 10, 'vanilla'),
  ('hotel', 'Dehors & ailleurs', 10, 'vanilla'),
  ('jacuzzi', 'Dehors & ailleurs', 10, 'vanilla'),
  ('camping', 'Dehors & ailleurs', 10, 'vanilla'),
  ('fitting_room', 'Dehors & ailleurs', 10, 'kinky'),
  ('night_out', 'Dehors & ailleurs', 10, 'vanilla'),
  ('party_escape', 'Dehors & ailleurs', 10, 'vanilla'),
  ('transport', 'Dehors & ailleurs', 10, 'kinky'),
  ('naturism', 'Dehors & ailleurs', 10, 'vanilla'),
  ('after_sport', 'Dehors & ailleurs', 10, 'vanilla'),
  ('caught', 'Dehors & ailleurs', 10, 'kinky'),
  ('flash', 'Dehors & ailleurs', 10, 'kinky'),
  ('exhib', 'Dehors & ailleurs', 10, 'kinky'),
  ('gloryhole', 'Dehors & ailleurs', 10, 'kinky'),
  ('truth_about_partner', 'Mots & confidences', 11, 'vanilla'),
  ('truth_curiosity', 'Mots & confidences', 11, 'vanilla'),
  ('truth_fantasies', 'Mots & confidences', 11, 'vanilla'),
  ('truth_memories', 'Mots & confidences', 11, 'vanilla'),
  ('truth_preferences', 'Mots & confidences', 11, 'vanilla'),
  ('truth_raw', 'Mots & confidences', 11, 'vanilla'),
  ('truth_tonight', 'Mots & confidences', 11, 'vanilla'),
  ('truth_unsaid', 'Mots & confidences', 11, 'vanilla'),
  ('confession', 'Mots & confidences', 11, 'vanilla'),
  ('talk_dirty', 'Mots & confidences', 11, 'vanilla'),
  ('talk_narration', 'Mots & confidences', 11, 'vanilla'),
  ('talk_proposal', 'Mots & confidences', 11, 'vanilla'),
  ('erotic_reading', 'Mots & confidences', 11, 'vanilla'),
  ('sexting', 'Mots & confidences', 11, 'vanilla'),
  ('distance', 'Mots & confidences', 11, 'vanilla'),
  ('porn_inspi', 'Mots & confidences', 11, 'vanilla'),
  ('complicity', 'Mots & confidences', 11, 'vanilla'),
  ('trio', 'Fantasmes à plusieurs', 12, 'kinky'),
  ('hotwife', 'Fantasmes à plusieurs', 12, 'kinky'),
  ('cuckqueen', 'Fantasmes à plusieurs', 12, 'kinky'),
  ('group_fantasy', 'Fantasmes à plusieurs', 12, 'kinky'),
  ('truth_third', 'Fantasmes à plusieurs', 12, 'kinky'),
  ('food_messy', 'Jeux & surprises', 13, 'vanilla'),
  ('body_shots', 'Jeux & surprises', 13, 'vanilla'),
  ('body_writing', 'Jeux & surprises', 13, 'vanilla'),
  ('tipsy', 'Jeux & surprises', 13, 'vanilla'),
  ('smoking', 'Jeux & surprises', 13, 'vanilla'),
  ('distraction', 'Jeux & surprises', 13, 'vanilla'),
  ('wet_proof', 'Jeux & surprises', 13, 'vanilla'),
  ('guided', 'Jeux & surprises', 13, 'vanilla'),
  ('occasions', 'Jeux & surprises', 13, 'vanilla'),
  ('multi_day', 'Jeux & surprises', 13, 'vanilla'),
  ('replay', 'Jeux & surprises', 13, 'vanilla'),
  ('shaving', 'Jeux & surprises', 13, 'vanilla'),
  ('duel_hands', 'Duels', 14, 'vanilla'),
  ('duel_perf', 'Duels', 14, 'vanilla'),
  ('duel_power', 'Duels', 14, 'vanilla'),
  ('duel_words', 'Duels', 14, 'vanilla'),
  ('anal', 'Hors piste', 15, 'kinky'),
  ('urine', 'Hors piste', 15, 'kinky')
on conflict (family_key) do update
  set category = excluded.category,
      category_position = excluded.category_position,
      style = excluded.style;


-- ---------------------------------------------------------
-- 2. RÉGLAGE DU COUPLE
-- ---------------------------------------------------------

alter table public.protocol_couple_settings
  add column if not exists card_style text not null default 'both';

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'protocol_couple_settings_card_style_check'
  ) then
    alter table public.protocol_couple_settings
      add constraint protocol_couple_settings_card_style_check
      check (card_style in ('both', 'vanilla', 'kinky'));
  end if;
end
$$;

create or replace function public.get_protocol_card_style()
returns text
language sql
stable
security definer
set search_path to ''
as $$
  select coalesce(
    (
      select s.card_style
      from public.protocol_couple_members m
      join public.protocol_couple_settings s
        on s.couple_id = m.couple_id
      where m.user_id = auth.uid()
      limit 1
    ),
    'both'
  )
$$;

create or replace function public.set_protocol_card_style(p_style text)
returns text
language plpgsql
security definer
set search_path to ''
as $$
declare
  v_couple_id uuid;
begin
  if auth.uid() is null then
    raise exception 'Authentication required';
  end if;

  if p_style not in ('both', 'vanilla', 'kinky') then
    raise exception 'Invalid card style';
  end if;

  select m.couple_id
  into v_couple_id
  from public.protocol_couple_members m
  where m.user_id = auth.uid()
  limit 1;

  if v_couple_id is null then
    raise exception 'User does not belong to a couple';
  end if;

  insert into public.protocol_couple_settings
    (couple_id, card_style, updated_by, updated_at)
  values
    (v_couple_id, p_style, auth.uid(), now())
  on conflict (couple_id) do update
    set card_style = excluded.card_style,
        updated_by = excluded.updated_by,
        updated_at = excluded.updated_at;

  return p_style;
end;
$$;


-- ---------------------------------------------------------
-- 3. FILTRE DU TIRAGE
--    Actif seulement en mode « Sur mesure ».
--    Vanille : aucune carte kinky.
--    Kinky : actions et scènes d'intensité 3+ kinky ; vérités,
--    duels et mise en tension (intensité 1-2) puisent partout,
--    sinon le début de partie n'aurait presque rien à tirer.
-- ---------------------------------------------------------

create or replace function public.protocol_card_style_allowed(
  p_couple_id uuid,
  p_card_id bigint
)
returns boolean
language sql
stable
security definer
set search_path to ''
as $$
  select coalesce(
    (
      select case
        when s.director_mode <> 'custom' or s.card_style = 'both'
          then true
        when f.style is null
          then true
        when s.card_style = 'vanilla'
          then f.style = 'vanilla'
        else
          f.style = 'kinky'
          or c.type in ('truth', 'duel')
          or c.intensity <= 2
      end
      from public.protocol_couple_settings s
      join public.protocol_cards c
        on c.id = p_card_id
      left join public.protocol_card_families f
        on f.family_key = c.family_key
      where s.couple_id = p_couple_id
    ),
    true
  )
$$;

-- Insère le filtre à côté de chaque contrôle Lovense des deux
-- fonctions de tirage, dans la version actuellement en place
-- (pas de copie figée : on ne risque pas d'écraser une
-- modification faite depuis l'export du schéma).
do $$
declare
  v_fn text;
  v_def text;
  v_new text;
  v_expected integer;
  v_found integer;
begin
  foreach v_fn in array array[
    'public.protocol_select_card_v2_unified(uuid,integer,integer,text)',
    'public.protocol_pick_start_card(text)'
  ] loop
    v_def := pg_get_functiondef(v_fn::regprocedure);

    if position('protocol_card_style_allowed' in v_def) > 0 then
      raise notice '% : filtre déjà présent', v_fn;
      continue;
    end if;

    v_expected := case
      when v_fn like 'public.protocol_select_card_v2_unified%' then 3
      else 1
    end;

    select count(*)
    into v_found
    from regexp_matches(
      v_def,
      'public\.protocol_lovense_card_allowed\(([^()]*)\)',
      'g'
    );

    if v_found <> v_expected then
      raise exception '% : % contrôle(s) Lovense trouvé(s), % attendu(s) - migration annulée',
        v_fn, v_found, v_expected;
    end if;

    v_new := regexp_replace(
      v_def,
      'public\.protocol_lovense_card_allowed\(([^()]*)\)',
      '(public.protocol_card_style_allowed(\1) and public.protocol_lovense_card_allowed(\1))',
      'g'
    );

    execute v_new;
    raise notice '% : filtre ajouté (% endroit(s))', v_fn, v_found;
  end loop;
end
$$;


-- ---------------------------------------------------------
-- DROITS
-- ---------------------------------------------------------

revoke all on function public.get_protocol_card_style() from public, anon;
revoke all on function public.set_protocol_card_style(text) from public, anon;
revoke all on function public.protocol_card_style_allowed(uuid, bigint) from public, anon;

grant execute on function public.get_protocol_card_style() to authenticated;
grant execute on function public.set_protocol_card_style(text) to authenticated;
grant execute on function public.protocol_card_style_allowed(uuid, bigint) to authenticated;
