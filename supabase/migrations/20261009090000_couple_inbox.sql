-- =========================================================
-- Boîte de réception du couple
--   1. Rejoindre la partie que le partenaire vient de créer
--   2. Signes (« Un défi ? », « Ce soir ? »…) lisibles dans l'app
--   3. Réponses rapides aux cartes proposées
-- Toutes les fonctions sont limitées à l'utilisateur connecté.
-- =========================================================


-- ---------------------------------------------------------
-- 1. PARTIE EN ATTENTE CRÉÉE PAR LE PARTENAIRE
--    Partie du couple, encore à un seul joueur, créée par
--    l'autre il y a moins de 3 heures.
-- ---------------------------------------------------------

create or replace function public.get_partner_waiting_game()
returns table (
  code text,
  host_name text,
  created_at timestamptz
)
language sql
stable
security definer
set search_path to ''
as $$
  select
    g.code,
    coalesce(p.display_name, g.player_1_name),
    g.created_at
  from public.games g
  join public.protocol_couple_members me
    on me.couple_id = g.couple_id
   and me.user_id = auth.uid()
  join public.game_players host
    on host.game_id = g.id
   and host.player_no = 1
  left join public.protocol_profiles p
    on p.user_id = host.user_id
  where g.status = 'waiting'
    and g.player_count = 1
    and host.user_id <> auth.uid()
    and g.created_at > now() - interval '3 hours'
    and not exists (
      select 1
      from public.game_players gp
      where gp.game_id = g.id
        and gp.user_id = auth.uid()
    )
  order by g.created_at desc
  limit 1
$$;


-- ---------------------------------------------------------
-- 2. SIGNES REÇUS
-- ---------------------------------------------------------

alter table public.protocol_signals
  add column if not exists seen_at timestamptz;

create or replace function public.get_my_signals()
returns table (
  id bigint,
  type text,
  status text,
  created_at timestamptz,
  seen_at timestamptz,
  sender_name text
)
language sql
stable
security definer
set search_path to ''
as $$
  select
    s.id,
    s.type,
    s.status,
    s.created_at,
    s.seen_at,
    coalesce(p.display_name, 'Ton partenaire')
  from public.protocol_signals s
  left join public.protocol_profiles p
    on p.user_id = s.sender_user_id
  where s.recipient_user_id = auth.uid()
    and s.created_at > now() - interval '30 days'
  order by s.created_at desc
  limit 30
$$;


-- ---------------------------------------------------------
-- 3. RÉPONSES AUX CARTES PROPOSÉES
-- ---------------------------------------------------------

alter table public.card_invitations
  add column if not exists response text,
  add column if not exists responded_at timestamptz,
  add column if not exists response_seen_at timestamptz;

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'card_invitations_response_check'
  ) then
    alter table public.card_invitations
      add constraint card_invitations_response_check
      check (response is null or response in ('tonight', 'later', 'love'));
  end if;
end
$$;

-- seul le destinataire répond ; répondre vaut ouverture
create or replace function public.respond_card_invitation(
  p_invitation_id uuid,
  p_response text
)
returns timestamptz
language plpgsql
security definer
set search_path to ''
as $$
declare
  v_at timestamptz;
begin
  if auth.uid() is null then
    raise exception 'Not authenticated';
  end if;

  if p_response not in ('tonight', 'later', 'love') then
    raise exception 'Invalid response';
  end if;

  update public.card_invitations
     set response = p_response,
         responded_at = now(),
         response_seen_at = null,
         opened_at = coalesce(opened_at, now())
   where id = p_invitation_id
     and recipient_user_id = auth.uid()
  returning responded_at into v_at;

  if v_at is null then
    raise exception 'Invitation not found';
  end if;

  return v_at;
end;
$$;


-- ---------------------------------------------------------
-- 4. COMPTEURS ET « VU »
--    Pastille Invitations : signes reçus non vus
--    + réponses reçues à mes propositions non vues.
-- ---------------------------------------------------------

create or replace function public.get_inbox_counts()
returns jsonb
language sql
stable
security definer
set search_path to ''
as $$
  select jsonb_build_object(
    'signals', (
      select count(*)
      from public.protocol_signals
      where recipient_user_id = auth.uid()
        and seen_at is null
        and created_at > now() - interval '30 days'
    ),
    'responses', (
      select count(*)
      from public.card_invitations
      where sender_user_id = auth.uid()
        and responded_at is not null
        and response_seen_at is null
    )
  )
$$;

-- appelée à l'ouverture de l'écran Invitations
create or replace function public.mark_inbox_seen()
returns void
language plpgsql
security definer
set search_path to ''
as $$
begin
  if auth.uid() is null then
    raise exception 'Not authenticated';
  end if;

  update public.protocol_signals
     set seen_at = now()
   where recipient_user_id = auth.uid()
     and seen_at is null;

  update public.card_invitations
     set response_seen_at = now()
   where sender_user_id = auth.uid()
     and responded_at is not null
     and response_seen_at is null;
end;
$$;


-- ---------------------------------------------------------
-- DROITS : utilisateurs connectés uniquement
-- ---------------------------------------------------------

revoke all on function public.get_partner_waiting_game() from public, anon;
revoke all on function public.get_my_signals() from public, anon;
revoke all on function public.respond_card_invitation(uuid, text) from public, anon;
revoke all on function public.get_inbox_counts() from public, anon;
revoke all on function public.mark_inbox_seen() from public, anon;

grant execute on function public.get_partner_waiting_game() to authenticated;
grant execute on function public.get_my_signals() to authenticated;
grant execute on function public.respond_card_invitation(uuid, text) to authenticated;
grant execute on function public.get_inbox_counts() to authenticated;
grant execute on function public.mark_inbox_seen() to authenticated;
