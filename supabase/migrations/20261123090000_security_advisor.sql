-- =========================================================
-- Security Advisor de Supabase (23/11/2026)
--
-- 1. Fonctions appelables sans être connecté (rôle anon) : le jeu
--    se joue toujours connecté. Seul log_client_error reste ouvert
--    (une erreur peut survenir avant la connexion).
--    get_protocol_scene_preview, en particulier, laissait lire les
--    étapes d'une scène de la bibliothèque sans compte.
-- 2. Fonctions de déclencheur (triggers) et choix de la première
--    carte : jamais appelées par l'app, plus appelables du tout.
--    Un déclencheur se déclenche toujours : le droit d'exécution
--    n'est vérifié qu'à sa création.
-- 3. set_protocol_custom_card_updated_at : search_path figé.
--
-- Migration rejouable sans risque.
-- =========================================================

do $$
declare
  v_fn text;
begin
  -- fonctions de jeu : réservées aux joueurs connectés
  foreach v_fn in array array[
    'public.advance_protocol_guarded(text, text, integer, integer, bigint, text)',
    'public.get_protocol_current_card(text)',
    'public.get_protocol_scene_preview(bigint)',
    'public.resume_protocol_game(text)',
    'public.stop_protocol_game(text)',
    'public.use_choose_type_guarded(text, text, integer, bigint, text)',
    'public.use_take_control_guarded(text, integer, bigint, text)'
  ]
  loop
    if to_regprocedure(v_fn) is not null then
      execute format('revoke all on function %s from public, anon', v_fn);
      execute format('grant execute on function %s to authenticated', v_fn);
    end if;
  end loop;

  -- fonctions internes : plus d'appel direct par personne
  foreach v_fn in array array[
    'public.protocol_pick_start_card(text)',
    'public.protocol_envelopes_on_game_change()',
    'public.protocol_jokers_on_game_update()',
    'public.protocol_missions_on_game_change()',
    'public.protocol_missions_on_game_start()',
    'public.protocol_single_device_on_game_update()',
    'public.reset_protocol_timer_on_transition()'
  ]
  loop
    if to_regprocedure(v_fn) is not null then
      execute format('revoke all on function %s from public, anon, authenticated', v_fn);
    end if;
  end loop;

  if to_regprocedure('public.set_protocol_custom_card_updated_at()') is not null then
    alter function public.set_protocol_custom_card_updated_at() set search_path to '';
  end if;
end $$;
