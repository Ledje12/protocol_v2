-- =========================================================
-- Cartes scellées : une marge en fin de partie (26/11/2026)
--
-- La seconde carte scellée était prévue jusqu'à l'avant-dernier tour :
-- si elle ne pouvait pas sortir à ce moment-là (pas d'action possible,
-- ou tour de celui qui avait déjà eu la sienne), il ne restait plus de
-- tour pour la rattraper. Elle est désormais prévue au plus tard trois
-- tours avant la fin. Migration rejouable.
-- =========================================================

create or replace function public.protocol_sealed_turns(p_game public.games)
returns integer[]
language sql
immutable
set search_path to ''
as $$
  with w as (
    select coalesce(p_game.target_turns, 20) as t,
           (4 + coalesce(p_game.target_turns, 20) - 1) / 2 as half
  )
  select array[
    4 + abs(hashtext(p_game.id::text || 's1')) % greatest(1, half - 4),
    half + 1 + abs(hashtext(p_game.id::text || 's2')) % greatest(1, (t - 3) - (half + 1))
  ]
  from w
$$;

revoke all on function public.protocol_sealed_turns(public.games) from public, anon, authenticated;
