-- =========================================================
-- Calibration à 3 niveaux et montée proportionnelle
--   Taquin = cartes jusqu'au niveau 3, Coquin = 4, Indécent = 5
--   (l'app envoie 3, 4 ou 5 ; la partie garde le plus bas des deux).
--   La montée vers le plafond suit maintenant la durée de la partie :
--   paliers à 15 % puis 40 % des cartes (avant : cartes 3 et 8,
--   identique pour une partie de 20 cartes).
--   Les anciennes calibrations 1 et 2 restent gérées (parties en cours).
-- Migration rejouable sans risque.
-- =========================================================

create or replace function public.protocol_max_intensity(
  p_profile_intensity integer,
  p_turn_no integer,
  p_target_turns integer
)
returns integer
language plpgsql
immutable
set search_path to ''
as $$
declare
  v_turns integer := greatest(coalesce(p_target_turns, 20), 4);
  -- carte 3 et carte 8 sur 20 cartes ; 2 et 6 sur 16 ; 4 et 11 sur 28
  v_first integer := greatest(1, round(v_turns * 0.15)::integer);
  v_second integer := greatest(v_first + 1, round(v_turns * 0.40)::integer);
begin
  case p_profile_intensity
    when 1 then
      return 1;

    when 2 then
      return case when p_turn_no <= round(v_turns * 0.25) then 1 else 2 end;

    when 3 then
      return case when p_turn_no <= v_first then 2 else 3 end;

    when 4 then
      return case
        when p_turn_no <= v_first then 2
        when p_turn_no <= v_second then 3
        else 4
      end;

    else
      return case
        when p_turn_no <= v_first then 3
        when p_turn_no <= v_second then 4
        else 5
      end;
  end case;
end;
$$;

-- l'ancienne version (sans durée) reste valable : partie de 20 cartes
create or replace function public.protocol_max_intensity(
  p_profile_intensity integer,
  p_turn_no integer
)
returns integer
language sql
immutable
set search_path to ''
as $$
  select public.protocol_max_intensity(p_profile_intensity, p_turn_no, 20)
$$;

-- le tirage passe la durée de la partie (première carte et suivantes)
do $$
declare
  v_fn text;
  v_def text;
  v_new text;
begin
  foreach v_fn in array array[
    'public.protocol_pick_start_card',
    'public.protocol_select_card_v2_unified'
  ]
  loop
    select pg_get_functiondef(p.oid) into v_def
    from pg_proc p
    where p.oid = (
      select min(p2.oid) from pg_proc p2
      join pg_namespace n on n.oid = p2.pronamespace
      where n.nspname || '.' || p2.proname = v_fn
    );

    if v_def is null then
      raise exception 'Function % not found', v_fn;
    end if;

    -- déjà fait (migration rejouée)
    continue when v_def ~ 'protocol_max_intensity\(\s*v_profile_intensity,\s*[a-z_0-9]+,\s*v_game\.target_turns';

    v_new := regexp_replace(
      v_def,
      'public\.protocol_max_intensity\(\s*v_profile_intensity,\s*(1|p_next_turn)\s*\)',
      'public.protocol_max_intensity(v_profile_intensity, \1, v_game.target_turns)',
      'g'
    );

    if v_new = v_def then
      raise exception 'Max intensity call not found in %', v_fn;
    end if;

    execute v_new;
  end loop;
end;
$$;
