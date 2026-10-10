-- =========================================================
-- Joker « Imposer le type » : plus de partie bloquée
--   Si aucune carte du type imposé n'est disponible au tour
--   suivant (ex. une scène avant 20 % de la partie, ou plus de
--   scène autorisée), la partie se bloquait sur « No unused
--   compatible card of this type ». Désormais : tirage normal,
--   et le joker est rendu à celui qui l'a utilisé.
--   Une ligne ajoutée dans la version en place de
--   advance_protocol (pas de copie figée de la fonction).
-- Migration rejouable sans risque.
-- =========================================================

do $$
declare
  v_def text;
  v_anchor text := 'if v_next_pick is null then';
  v_found integer;
begin
  v_def := pg_get_functiondef(
    'public.advance_protocol(text,text,integer)'::regprocedure
  );

  if position('protocol.forced_type_fallback' in v_def) > 0 then
    raise notice 'advance_protocol : repli déjà présent';
    return;
  end if;

  select count(*)
  into v_found
  from regexp_matches(v_def, v_anchor, 'g');

  if v_found <> 1 then
    raise exception 'advance_protocol : % tirage(s) trouvé(s), 1 attendu - migration annulée', v_found;
  end if;

  execute replace(
    v_def,
    v_anchor,
    '-- protocol.forced_type_fallback : type imposé indisponible,
    -- tirage normal et joker rendu
    if v_next_pick is null and v_forced_type is not null then
        v_next_pick :=
            public.protocol_select_card_v2_unified(
                v_game.id,
                v_next_player,
                v_next_turn,
                null
            );

        if v_forced_by = 1 then
            v_bonus_p1 :=
                (v_bonus_p1 - ''choose_type_armed'')
                || ''{"choose_type": true}''::jsonb;
        elsif v_forced_by = 2 then
            v_bonus_p2 :=
                (v_bonus_p2 - ''choose_type_armed'')
                || ''{"choose_type": true}''::jsonb;
        end if;

        v_forced_type := null;
        v_forced_by := null;
    end if;

    ' || v_anchor
  );

  raise notice 'advance_protocol : repli ajouté';
end
$$;
