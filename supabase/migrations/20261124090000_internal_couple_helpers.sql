-- =========================================================
-- Fonctions internes qui prennent l'identifiant d'un couple
-- (24/11/2026)
--
-- protocol_card_style_allowed, protocol_lovense_card_allowed,
-- protocol_lovense_connected et protocol_lovense_has_toy ne servent
-- qu'à l'intérieur du choix des cartes (fonctions security definer).
-- Appelées directement, elles répondraient pour n'importe quel
-- couple dont on connaîtrait l'identifiant : on retire le droit de
-- les appeler depuis l'app.
--
-- Migration rejouable sans risque.
-- =========================================================

do $$
declare
  v_fn text;
begin
  foreach v_fn in array array[
    'public.protocol_card_style_allowed(uuid, bigint)',
    'public.protocol_lovense_card_allowed(uuid, bigint)',
    'public.protocol_lovense_connected(uuid)',
    'public.protocol_lovense_has_toy(uuid, text)'
  ]
  loop
    if to_regprocedure(v_fn) is not null then
      execute format('revoke all on function %s from public, anon, authenticated', v_fn);
    end if;
  end loop;
end $$;
