-- =========================================================
-- Ménage : fonctions qui ne servent plus
--   buy_protocol_bonus(_guarded) : achat de bonus avec des points,
--   remplacé par les jokers (20261010110000_jokers.sql). La version
--   « guarded » restait appelable par l'app.
--   add_game_rule : règles de partie ajoutées à la main, plus
--   appelée nulle part.
--   Aucune autre fonction, trigger ou policy ne les utilise.
-- Migration rejouable sans risque.
-- =========================================================

drop function if exists public.buy_protocol_bonus_guarded(text, text, integer, bigint, text);
drop function if exists public.buy_protocol_bonus(text, text);
drop function if exists public.add_game_rule(text, text, text, integer, integer, text);
