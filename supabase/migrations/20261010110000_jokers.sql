-- =========================================================
-- Jokers à la place des points
--   Chaque joueur reçoit au départ deux jokers : « Imposer le
--   type » et « Prendre la main ». Gagner un duel recharge un
--   joker déjà utilisé. Plus d'achat avec des points (l'écran ne
--   montre plus les scores ; ils restent calculés, sans effet).
--   Les fonctions d'utilisation des jokers sont inchangées.
-- Migration rejouable sans risque.
-- =========================================================


-- ---------------------------------------------------------
-- 1. JOKERS AU DÉPART ET APRÈS UN DUEL GAGNÉ
-- ---------------------------------------------------------

create or replace function public.protocol_jokers_on_game_update()
returns trigger
language plpgsql
security definer
set search_path to ''
as $$
declare
  v_winner text;
  v_bonus jsonb;
begin
  -- lancement (pas une reprise après STOP) : deux jokers chacun
  if new.status = 'playing'
     and old.status is distinct from 'playing'
     and old.status is distinct from 'paused' then
    new.bonus_player_1 :=
      coalesce(new.bonus_player_1, '{}'::jsonb)
      || '{"choose_type": true, "take_control": true}'::jsonb;
    new.bonus_player_2 :=
      coalesce(new.bonus_player_2, '{}'::jsonb)
      || '{"choose_type": true, "take_control": true}'::jsonb;
  end if;

  -- duel gagné (signalé par advance_protocol dans la même
  -- transaction) : recharge un joker déjà utilisé
  v_winner := nullif(current_setting('protocol.duel_winner', true), '');

  if v_winner in ('1', '2') then
    perform set_config('protocol.duel_winner', '', true);

    v_bonus := case v_winner
      when '1' then coalesce(new.bonus_player_1, '{}'::jsonb)
      else coalesce(new.bonus_player_2, '{}'::jsonb)
    end;

    if not coalesce((v_bonus ->> 'choose_type')::boolean, false)
       and v_bonus -> 'choose_type_armed' is null then
      v_bonus := v_bonus || '{"choose_type": true}'::jsonb;
    elsif not coalesce((v_bonus ->> 'take_control')::boolean, false)
       and not coalesce((v_bonus ->> 'take_control_armed')::boolean, false) then
      v_bonus := v_bonus || '{"take_control": true}'::jsonb;
    end if;

    if v_winner = '1' then
      new.bonus_player_1 := v_bonus;
    else
      new.bonus_player_2 := v_bonus;
    end if;
  end if;

  return new;
end;
$$;

drop trigger if exists protocol_jokers on public.games;
create trigger protocol_jokers
  before update on public.games
  for each row
  execute function public.protocol_jokers_on_game_update();


-- ---------------------------------------------------------
-- 2. SIGNAL DU GAGNANT DE DUEL
--    Une ligne ajoutée dans la version en place de
--    advance_protocol (pas de copie figée de la fonction).
-- ---------------------------------------------------------

do $$
declare
  v_def text;
  v_found integer;
begin
  v_def := pg_get_functiondef(
    'public.advance_protocol(text,text,integer)'::regprocedure
  );

  if position('protocol.duel_winner' in v_def) > 0 then
    raise notice 'advance_protocol : signal déjà présent';
    return;
  end if;

  select count(*)
  into v_found
  from regexp_matches(v_def, 'if p_duel_winner = 1 then', 'g');

  if v_found <> 1 then
    raise exception 'advance_protocol : % attribution(s) de duel trouvée(s), 1 attendue - migration annulée', v_found;
  end if;

  execute replace(
    v_def,
    'if p_duel_winner = 1 then',
    'perform set_config(''protocol.duel_winner'', p_duel_winner::text, true);

        if p_duel_winner = 1 then'
  );

  raise notice 'advance_protocol : signal ajouté';
end
$$;
