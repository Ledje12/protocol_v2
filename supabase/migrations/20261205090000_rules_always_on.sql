-- =========================================================
-- Règles de la partie imposées (26/11/2026)
--
-- Enveloppe, cartes scellées, « Oui / Non » et missions secrètes font
-- partie du jeu : l'écran « Règles de la partie » disparaît des
-- Réglages. Chacune garde son refus pendant la partie (passer
-- l'enveloppe, une carte normale au lieu de la scellée, tout refuser
-- au vote, « Pas cette fois » pour la mission).
--
-- Tous les couples repassent à « actif », y compris ceux qui avaient
-- coupé une option ; les missions deviennent actives par défaut.
-- Les colonnes restent : on pourra réafficher un réglage si besoin.
-- Les parties déjà lancées gardent leurs règles ; les nouvelles
-- parties et les revanches suivent ces valeurs.
-- Migration rejouable.
-- =========================================================

alter table public.protocol_couple_settings
  alter column envelope_enabled set default true,
  alter column sealed_enabled set default true,
  alter column vote_enabled set default true,
  alter column missions_enabled set default true;

update public.protocol_couple_settings
set envelope_enabled = true,
    sealed_enabled = true,
    vote_enabled = true,
    missions_enabled = true
where not (envelope_enabled and sealed_enabled and vote_enabled and missions_enabled);

-- un couple sans ligne de réglages : missions actives aussi
create or replace function public.protocol_missions_setting(p_couple_id uuid)
returns boolean
language sql
stable
security definer
set search_path to ''
as $$
  select coalesce(
    (select s.missions_enabled from public.protocol_couple_settings s
     where s.couple_id = p_couple_id),
    true
  )
$$;

revoke all on function public.protocol_missions_setting(uuid) from public, anon, authenticated;

create or replace function public.get_protocol_missions_enabled()
returns boolean
language sql
stable
security definer
set search_path to ''
as $$
  select coalesce(
    (
      select s.missions_enabled
      from public.protocol_couple_members m
      join public.protocol_couple_settings s on s.couple_id = m.couple_id
      where m.user_id = auth.uid()
      limit 1
    ),
    true
  )
$$;

revoke all on function public.get_protocol_missions_enabled() from public, anon;
grant execute on function public.get_protocol_missions_enabled() to authenticated;
