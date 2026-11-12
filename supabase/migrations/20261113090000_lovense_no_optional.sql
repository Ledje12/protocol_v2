-- =========================================================
-- Lovense : fin des cartes « optional »
--   Protocol ne pilote plus les jouets : une carte Lovense est
--   soit « required » (elle ne sort que si son jouet est connecté),
--   soit une carte normale (lovense_mode null). La valeur
--   'optional' est désormais refusée.
-- Échoue proprement s'il reste des cartes 'optional' : les
-- convertir d'abord.
-- Migration rejouable sans risque.
-- =========================================================

alter table public.protocol_cards
  drop constraint if exists protocol_cards_lovense_mode_check;

alter table public.protocol_cards
  add constraint protocol_cards_lovense_mode_check
  check (lovense_mode is null or lovense_mode = 'required');
