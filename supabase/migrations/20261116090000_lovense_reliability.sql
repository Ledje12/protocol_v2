-- =========================================================
-- Lovense : fiabilité des curseurs
--   - protocol_lovense_toy_state : l'état voulu de chaque jouet
--     (intensité ou ambiance), partagé par les deux téléphones.
--     Écrit seulement par la fonction edge lovense-command ; l'app
--     le relit pour afficher le même curseur des deux côtés, et un
--     arrêt décidé sur un téléphone n'est plus relancé par l'autre.
--   - un état de connexion vieux de plus de 24 h ne compte plus :
--     les cartes Lovense ne sortent pas pour un jouet resté au
--     tiroir (lovense-command rafraîchit la date à chaque commande
--     acceptée par Lovense).
-- Migration rejouable sans risque.
-- =========================================================

create table if not exists public.protocol_lovense_toy_state (
  couple_id uuid not null references public.protocol_couples (id) on delete cascade,
  toy_id text not null,
  level smallint not null default 0,
  ambiance text,
  updated_by uuid,
  -- dernière décision (curseur, ambiance, arrêt)
  updated_at timestamptz not null default now(),
  -- dernier envoi à Lovense : la commande s'éteint seule 30 s après
  renewed_at timestamptz not null default now(),
  primary key (couple_id, toy_id),
  constraint protocol_lovense_toy_state_level_check check (level between 0 and 20),
  constraint protocol_lovense_toy_state_ambiance_check
    check (ambiance is null or ambiance in ('wave', 'pulse', 'crescendo'))
);

alter table public.protocol_lovense_toy_state enable row level security;

-- lecture directe par l'app (les deux membres du couple) ;
-- aucune écriture hors fonction edge (service_role)
drop policy if exists protocol_lovense_toy_state_select on public.protocol_lovense_toy_state;
create policy protocol_lovense_toy_state_select
  on public.protocol_lovense_toy_state
  for select
  to authenticated
  using (couple_id = public.protocol_my_couple_id());

-- droits explicites, quel que soit le réglage par défaut du projet
revoke all on public.protocol_lovense_toy_state from public, anon, authenticated;
grant select on public.protocol_lovense_toy_state to authenticated;
grant select, insert, update, delete on public.protocol_lovense_toy_state to service_role;


-- un jouet de ce type est-il en ligne pour le couple ? (null : n'importe lequel)
-- Un état qui n'a pas bougé depuis 24 h n'est plus cru.
create or replace function public.protocol_lovense_has_toy(p_couple_id uuid, p_type text default null)
returns boolean
language sql
stable
security definer
set search_path to ''
as $$
  select exists (
    select 1
    from public.protocol_lovense_connections lc
    cross join lateral jsonb_array_elements(
      case jsonb_typeof(lc.toys)
        when 'array' then lc.toys
        when 'object' then (
          select coalesce(jsonb_agg(value), '[]'::jsonb) from jsonb_each(lc.toys)
        )
        else '[]'::jsonb
      end
    ) as toy
    where lc.couple_id = p_couple_id
      and nullif(trim(lc.lovense_uid), '') is not null
      and coalesce(lc.updated_at, lc.connected_at) > now() - interval '24 hours'
      and public.protocol_lovense_toy_online(toy)
      and (p_type is null or public.protocol_lovense_toy_type(toy) = p_type)
  )
$$;

revoke all on function public.protocol_lovense_has_toy(uuid, text) from public, anon;
grant execute on function public.protocol_lovense_has_toy(uuid, text) to authenticated;
