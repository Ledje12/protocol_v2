-- =========================================================
-- Le joker « L'envie », une seule autre proposition par tour,
-- cartes scellées un cran plus chaudes et plus pimentées
-- (26/11/2026)
--
-- 1. Une seule « Autre proposition » par tour. Refuser une carte
--    scellée compte comme ce changement. Ensuite, on joue la carte
--    ou on passe son tour.
-- 2. Les deux anciens jokers (imposer le type, prendre la main)
--    laissent la place à un seul : « L'envie ». Celui qui a la main
--    choisit le thème (catégorie de la bibliothèque) de la prochaine
--    carte. Chacun en a un au départ ; un duel gagné ou une carte
--    scellée acceptée en redonne un (deux en main au plus) ; passer
--    une carte scellée acceptée l'offre à l'autre. Si aucune carte
--    du thème n'est possible, l'envie est rendue.
-- 3. Cartes scellées : jusqu'à un niveau au-dessus de la montée du
--    moment (jamais au-delà du choix du couple), et de préférence
--    dans les familles les plus pimentées (colonne spice, 1 à 3 ;
--    sans valeur : 2 pour une famille kinky, 1 sinon).
--
-- Le tirage existant reçoit deux filtres facultatifs (thème choisi,
-- niveau en plus), lus dans des réglages de session : rien ne change
-- quand ils sont vides. La migration vérifie qu'elle trouve bien les
-- trois endroits à modifier, sinon elle s'arrête sans rien changer.
--
-- Migration rejouable sans risque.
-- =========================================================

-- ---------------------------------------------------------
-- 0. COLONNES
-- ---------------------------------------------------------

alter table public.games
  add column if not exists alternative_used boolean not null default false,
  add column if not exists desire_category text,
  add column if not exists desire_by smallint;

alter table public.protocol_card_families
  add column if not exists spice smallint;

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'protocol_card_families_spice_check'
      and conrelid = 'public.protocol_card_families'::regclass
  ) then
    alter table public.protocol_card_families
      add constraint protocol_card_families_spice_check
      check (spice is null or spice between 1 and 3);
  end if;
end $$;

create or replace function public.protocol_family_spice(p_family_key text)
returns integer
language sql
stable
security definer
set search_path to ''
as $$
  select coalesce(
    (select coalesce(f.spice, case when f.style = 'kinky' then 2 else 1 end)
     from public.protocol_card_families f where f.family_key = p_family_key),
    1
  )
$$;

revoke all on function public.protocol_family_spice(text) from public, anon, authenticated;


-- ---------------------------------------------------------
-- 1. TIRAGE : thème choisi et niveau en plus (réglages de session)
-- ---------------------------------------------------------

do $$
declare
  v_def text;
  v_count integer;
  -- espaces et fins de ligne quelconques (le texte peut venir de Windows)
  v_pattern text := 'and\s+c\.intensity\s*<=\s*v_max_intensity';
  v_new text := 'and c.intensity <=
              least(
                  v_profile_intensity,
                  v_max_intensity
                  -- carte scellée : un niveau de plus, jamais au-delà du choix du couple
                  + coalesce(nullif(current_setting(''protocol.intensity_bonus'', true), '''')::integer, 0)
              )

          -- L''envie : thème choisi (réglage de session)
          and (
              nullif(current_setting(''protocol.desire_category'', true), '''') is null
              or exists (
                  select 1 from public.protocol_card_families f
                  where f.family_key = c.family_key
                    and f.category = current_setting(''protocol.desire_category'', true)
              )
          )';
begin
  v_def := pg_get_functiondef('public.protocol_select_card_v2_base(uuid, integer, integer, text)'::regprocedure);

  if position('protocol.desire_category' in v_def) > 0 then
    return;
  end if;

  select count(*) into v_count from regexp_matches(v_def, v_pattern, 'g');
  if v_count <> 3 then
    raise exception 'Tirage : % filtres d''intensité trouvés au lieu de 3, rien n''est modifié', v_count;
  end if;

  if position('v_profile_intensity' in v_def) = 0 then
    raise exception 'Tirage : plafond du couple (v_profile_intensity) introuvable, rien n''est modifié';
  end if;

  v_def := regexp_replace(v_def, v_pattern, v_new, 'g');
  execute v_def;
end $$;

revoke all on function public.protocol_select_card_v2_base(uuid, integer, integer, text)
  from public, anon, authenticated;


-- ---------------------------------------------------------
-- 2. RELAIS DU TIRAGE : l'envie d'abord, sinon peut-être une scellée
-- ---------------------------------------------------------

create or replace function public.protocol_select_card_v2_unified(
  p_game_id uuid,
  p_next_player integer,
  p_next_turn integer,
  p_forced_type text default null
)
returns jsonb
language plpgsql
security definer
set search_path to ''
as $$
declare
  v_game public.games%rowtype;
  v_cat text;
  v_by integer;
  v_pick jsonb;
  v_normal jsonb;
  v_try jsonb;
  v_best jsonb;
  v_best_spice integer;
  v_spice integer;
  v_used integer;
  v_left integer;
  v_new_turn boolean;
  i integer;
begin
  select * into v_game from public.games where id = p_game_id;
  v_new_turn := v_game.id is not null and p_next_turn > coalesce(v_game.turn_no, 0);

  -- L'envie : armée pour le prochain tour, ou thème du tour en cours
  -- quand on demande une autre proposition
  if v_game.id is not null and p_forced_type is null then
    if v_new_turn then
      if coalesce(v_game.bonus_player_1 ->> 'desire_armed', '') <> '' then
        v_cat := v_game.bonus_player_1 ->> 'desire_armed'; v_by := 1;
      elsif coalesce(v_game.bonus_player_2 ->> 'desire_armed', '') <> '' then
        v_cat := v_game.bonus_player_2 ->> 'desire_armed'; v_by := 2;
      end if;
    elsif v_game.desire_category is not null then
      v_cat := v_game.desire_category; v_by := v_game.desire_by;
    end if;
  end if;

  if v_cat is not null then
    perform set_config('protocol.desire_category', v_cat, true);
    v_pick := public.protocol_select_card_v2_base(p_game_id, p_next_player, p_next_turn, null);
    perform set_config('protocol.desire_category', '', true);

    if v_pick is not null then
      perform set_config('protocol.desire_result', v_by || '|ok|' || v_cat, true);
      return v_pick;
    end if;

    -- aucun carte possible dans ce thème : l'envie est rendue
    if v_new_turn then
      perform set_config('protocol.desire_result', v_by || '|refund|', true);
    end if;
  end if;

  v_normal := public.protocol_select_card_v2_base(p_game_id, p_next_player, p_next_turn, p_forced_type);

  -- carte scellée : un vrai nouveau tour, sans type imposé, du 4e tour
  -- à l'avant-dernier, deux fois par joueur au plus
  if v_normal is null
     or v_game.id is null
     or not v_game.sealed_enabled
     or p_forced_type is not null
     or v_game.status <> 'playing'
     or not v_new_turn
     or p_next_turn < 4
     or p_next_turn >= coalesce(v_game.target_turns, 20) then
    return v_normal;
  end if;

  v_used := case when p_next_player = 1 then v_game.sealed_used_p1 else v_game.sealed_used_p2 end;
  if v_used >= 2 then
    return v_normal;
  end if;

  v_left := greatest(1, ceil((coalesce(v_game.target_turns, 20) - p_next_turn) / 2.0)::integer);
  if random() >= (2 - v_used)::numeric / v_left then
    return v_normal;
  end if;

  -- un niveau de plus que la montée (jamais au-delà du choix du
  -- couple), et la famille la plus pimentée parmi plusieurs tirages
  perform set_config('protocol.intensity_bonus', '1', true);
  for i in 1..12 loop
    v_try := public.protocol_select_card_v2_base(p_game_id, p_next_player, p_next_turn, 'action');
    if v_try is not null
       and v_try ->> 'card_source' = 'official'
       and not exists (
         select 1 from public.protocol_card_rules r
         where r.card_id = (v_try ->> 'official_card_id')::bigint and r.active
       ) then
      select public.protocol_family_spice(c.family_key) into v_spice
      from public.protocol_cards c where c.id = (v_try ->> 'official_card_id')::bigint;

      if v_best is null
         or v_spice > v_best_spice
         or (v_spice = v_best_spice
             and (v_try ->> 'intensity')::integer > (v_best ->> 'intensity')::integer) then
        v_best := v_try;
        v_best_spice := v_spice;
      end if;
    end if;
  end loop;
  perform set_config('protocol.intensity_bonus', '', true);

  if v_best is null then
    return v_normal;
  end if;

  perform set_config('protocol.sealed_next', '1', true);
  return v_best;
end;
$$;

revoke all on function public.protocol_select_card_v2_unified(uuid, integer, integer, text)
  from public, anon, authenticated;


-- ---------------------------------------------------------
-- 3. JOKERS : un seul, « L'envie »
-- ---------------------------------------------------------

create or replace function public.protocol_jokers_on_game_update()
returns trigger
language plpgsql
security definer
set search_path to ''
as $$
declare
  v_winner text;
  v_result text[];
  v_bonus jsonb;
  v_player integer;
begin
  -- lancement (pas une reprise après STOP) : une envie chacun
  if new.status = 'playing'
     and old.status is distinct from 'playing'
     and old.status is distinct from 'paused' then
    new.bonus_player_1 :=
      (coalesce(new.bonus_player_1, '{}'::jsonb)
        - 'choose_type' - 'choose_type_armed' - 'take_control' - 'take_control_armed' - 'desire_armed')
      || '{"desire": 1}'::jsonb;
    new.bonus_player_2 :=
      (coalesce(new.bonus_player_2, '{}'::jsonb)
        - 'choose_type' - 'choose_type_armed' - 'take_control' - 'take_control_armed' - 'desire_armed')
      || '{"desire": 1}'::jsonb;
    new.desire_category := null;
    new.desire_by := null;
  end if;

  -- envie consommée (ou rendue) par le tirage de la nouvelle carte
  v_result := string_to_array(nullif(current_setting('protocol.desire_result', true), ''), '|');
  if v_result is not null then
    perform set_config('protocol.desire_result', '', true);
    v_player := v_result[1]::integer;
    v_bonus := case v_player when 1 then coalesce(new.bonus_player_1, '{}'::jsonb)
                             else coalesce(new.bonus_player_2, '{}'::jsonb) end;
    v_bonus := v_bonus - 'desire_armed';
    if v_result[2] = 'refund' then
      v_bonus := jsonb_set(v_bonus, '{desire}',
        to_jsonb(least(2, coalesce((v_bonus ->> 'desire')::integer, 0) + 1)));
    else
      new.desire_category := v_result[3];
      new.desire_by := v_player;
    end if;
    if v_player = 1 then new.bonus_player_1 := v_bonus; else new.bonus_player_2 := v_bonus; end if;
  elsif new.turn_no is distinct from old.turn_no then
    new.desire_category := null;
    new.desire_by := null;
  end if;

  -- duel gagné, carte scellée acceptée, ou joker offert : une envie
  -- de plus (deux au plus)
  v_winner := nullif(current_setting('protocol.duel_winner', true), '');
  if v_winner in ('1', '2') then
    perform set_config('protocol.duel_winner', '', true);
    v_bonus := case v_winner when '1' then coalesce(new.bonus_player_1, '{}'::jsonb)
                             else coalesce(new.bonus_player_2, '{}'::jsonb) end;
    v_bonus := jsonb_set(v_bonus, '{desire}',
      to_jsonb(least(2, coalesce((v_bonus ->> 'desire')::integer, 0) + 1)));
    if v_winner = '1' then new.bonus_player_1 := v_bonus; else new.bonus_player_2 := v_bonus; end if;
  end if;

  return new;
end;
$$;

revoke all on function public.protocol_jokers_on_game_update() from public, anon, authenticated;


-- choisir le thème de la prochaine carte (null : annuler, l'envie est rendue)
create or replace function public.use_desire(p_game_code text, p_category text)
returns jsonb
language plpgsql
security definer
set search_path to ''
as $$
declare
  v_player integer;
  v_game public.games%rowtype;
  v_bonus jsonb;
  v_armed text;
  v_left integer;
begin
  v_player := public.protocol_current_player_no(p_game_code);

  select * into v_game from public.games
  where code = upper(trim(p_game_code))
  for update;

  if v_game.id is null then
    raise exception 'Game not found';
  end if;
  if v_game.status <> 'playing' then
    raise exception 'Game is not playing';
  end if;
  if v_game.active_player <> v_player then
    raise exception 'Only active player can choose';
  end if;

  v_bonus := case v_player when 1 then coalesce(v_game.bonus_player_1, '{}'::jsonb)
                           else coalesce(v_game.bonus_player_2, '{}'::jsonb) end;
  v_armed := nullif(v_bonus ->> 'desire_armed', '');
  v_left := coalesce((v_bonus ->> 'desire')::integer, 0);

  if p_category is null then
    if v_armed is not null then
      v_bonus := jsonb_set(v_bonus - 'desire_armed', '{desire}', to_jsonb(least(2, v_left + 1)));
    end if;
  else
    if not exists (select 1 from public.protocol_card_families f where f.category = p_category) then
      raise exception 'Unknown category';
    end if;
    if v_armed is null then
      if v_left < 1 then
        raise exception 'No desire left';
      end if;
      v_bonus := jsonb_set(v_bonus, '{desire}', to_jsonb(v_left - 1));
    end if;
    v_bonus := v_bonus || jsonb_build_object('desire_armed', p_category);
  end if;

  if v_player = 1 then
    update public.games set bonus_player_1 = v_bonus where id = v_game.id;
  else
    update public.games set bonus_player_2 = v_bonus where id = v_game.id;
  end if;

  return jsonb_build_object('desire', v_bonus -> 'desire', 'armed', v_bonus -> 'desire_armed');
end;
$$;

-- les thèmes possibles pour la prochaine carte (celle de l'autre)
create or replace function public.get_desire_categories(p_game_code text)
returns jsonb
language plpgsql
stable
security definer
set search_path to ''
as $$
declare
  v_game public.games%rowtype;
  v_next integer;
  v_sex text;
  v_ceiling integer;
begin
  perform public.protocol_current_player_no(p_game_code);

  select * into v_game from public.games where code = upper(trim(p_game_code));
  if v_game.id is null then
    raise exception 'Game not found';
  end if;

  v_next := case when v_game.active_player = 1 then 2 else 1 end;
  v_sex := case when v_next = 1 then v_game.player_1_sex else v_game.player_2_sex end;
  -- plafond de la prochaine carte : la montée du moment, dans le
  -- choix du couple (le thème proposé a forcément des cartes jouables)
  v_ceiling := public.protocol_max_intensity(
    greatest(1, least(5, coalesce((v_game.shared_profile ->> 'intensity')::integer, 1))),
    coalesce(v_game.turn_no, 0) + 1,
    v_game.target_turns
  );

  return coalesce((
    select jsonb_agg(jsonb_build_object('category', x.category, 'count', x.n) order by x.pos, x.category)
    from (
      select f.category, min(f.category_position) as pos, count(*) as n
      from public.protocol_cards c
      join public.protocol_card_families f on f.family_key = c.family_key
      where c.active
        and c.library_version = 'v1'
        and f.category is not null
        and c.type <> 'duel'
        and c.intensity <= v_ceiling
        and (c.target_sex is null or c.target_sex = v_sex)
        and public.protocol_card_style_allowed(v_game.couple_id, c.id)
        and public.protocol_lovense_card_allowed(v_game.couple_id, c.id)
        and not exists (
          select 1 from public.game_card_history h
          where h.game_id = v_game.id and h.card_source = 'official' and h.card_id = c.id
        )
      group by f.category
      having count(*) >= 2
    ) x
  ), '[]'::jsonb);
end;
$$;


-- ---------------------------------------------------------
-- 4. UNE SEULE AUTRE PROPOSITION PAR TOUR
-- ---------------------------------------------------------

create or replace function public.protocol_sealed_on_game_change()
returns trigger
language plpgsql
security definer
set search_path to ''
as $$
declare
  v_next text;
  v_refuse text;
begin
  if tg_op = 'INSERT' then
    new.sealed_enabled := public.protocol_sealed_setting(new.couple_id);
    new.sealed_status := null;
    new.alternative_used := false;
    return new;
  end if;

  -- revanche : tout repart de zéro
  if old.status = 'finished' and new.status is distinct from 'finished' then
    new.sealed_enabled := public.protocol_sealed_setting(new.couple_id);
    new.sealed_status := null;
    new.sealed_used_p1 := 0;
    new.sealed_used_p2 := 0;
    new.sealed_accepted := 0;
    new.alternative_used := false;
    return new;
  end if;

  if new.current_card_id is not distinct from old.current_card_id
     and new.current_custom_card_id is not distinct from old.current_custom_card_id
     and new.turn_no is not distinct from old.turn_no then
    return new;
  end if;

  v_next := nullif(current_setting('protocol.sealed_next', true), '');
  v_refuse := nullif(current_setting('protocol.sealed_refuse', true), '');

  if old.sealed_status = 'pending' and v_refuse is null and new.status = 'playing' then
    raise exception 'Sealed card must be accepted or refused first';
  end if;

  if new.turn_no is not distinct from old.turn_no and new.status = 'playing' then
    if old.sealed_status = 'accepted' then
      raise exception 'Sealed card cannot be changed';
    end if;
    -- autre proposition : une seule par tour (un refus de scellée compte)
    if old.alternative_used and v_refuse is null then
      raise exception 'Only one alternative per turn';
    end if;
    new.alternative_used := true;
  else
    new.alternative_used := false;
  end if;

  perform set_config('protocol.sealed_refuse', '', true);

  if v_next = '1' and new.status = 'playing' then
    perform set_config('protocol.sealed_next', '', true);
    new.sealed_status := 'pending';
    if new.active_player = 1 then
      new.sealed_used_p1 := new.sealed_used_p1 + 1;
    else
      new.sealed_used_p2 := new.sealed_used_p2 + 1;
    end if;
  else
    new.sealed_status := null;
  end if;

  return new;
end;
$$;

revoke all on function public.protocol_sealed_on_game_change() from public, anon, authenticated;


-- ---------------------------------------------------------
-- 5. CARTE COURANTE : thème choisi et autre proposition déjà prise
-- ---------------------------------------------------------

create or replace function public.get_protocol_current_card(p_game_code text)
returns jsonb
language plpgsql
security definer
set search_path to ''
as $$
declare
  v_card jsonb;
  v_game public.games%rowtype;
  v_extra jsonb;
begin
  v_card := public.get_protocol_current_card_base(p_game_code);

  select * into v_game from public.games g where g.code = upper(trim(p_game_code));

  v_extra := jsonb_build_object(
    'alternative_used', coalesce(v_game.alternative_used, false),
    'desire', case when v_game.desire_category is null then null
                   else jsonb_build_object('category', v_game.desire_category, 'by', v_game.desire_by) end
  );

  if v_game.sealed_status = 'pending' then
    return jsonb_build_object(
      'id', v_card -> 'id',
      'card_source', v_card -> 'card_source',
      'source_id', v_card -> 'source_id',
      'official_card_id', v_card -> 'official_card_id',
      'custom_card_id', v_card -> 'custom_card_id',
      'type', v_card -> 'type',
      'intensity', v_card -> 'intensity',
      'title', 'Carte scellée',
      'prompt', '',
      'sealed', 'pending'
    ) || v_extra;
  end if;

  if v_game.sealed_status = 'accepted' then
    return v_card || '{"sealed": "accepted"}'::jsonb || v_extra;
  end if;

  return v_card || v_extra;
end;
$$;

revoke all on function public.get_protocol_current_card(text) from public, anon;
grant execute on function public.get_protocol_current_card(text) to authenticated;

do $$
declare
  v_fn text;
begin
  foreach v_fn in array array[
    'public.use_desire(text, text)',
    'public.get_desire_categories(text)'
  ]
  loop
    execute format('revoke all on function %s from public, anon', v_fn);
    execute format('grant execute on function %s to authenticated', v_fn);
  end loop;
end $$;
