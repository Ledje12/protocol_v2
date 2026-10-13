-- =========================================================
-- Messages programmés : écrire maintenant, envoyer à l'heure
-- choisie (dans les 7 jours).
--   Le message attend ici, invisible pour l'autre. Chaque minute,
--   la fonction send-scheduled (appelée par pg_cron) le dépose dans
--   la conversation et envoie la notification habituelle.
--   Seul l'expéditeur voit et peut annuler ses messages en attente.
-- Migration rejouable sans risque.
-- =========================================================

create table if not exists public.protocol_scheduled_messages (
  id uuid primary key default gen_random_uuid(),
  couple_id uuid not null,
  sender_user_id uuid not null references auth.users (id) on delete cascade,
  recipient_user_id uuid not null references auth.users (id) on delete cascade,
  body text not null check (length(body) between 1 and 1200),
  send_at timestamptz not null,
  created_at timestamptz not null default now(),
  sent_at timestamptz,
  message_id bigint
);

create index if not exists protocol_scheduled_messages_due
  on public.protocol_scheduled_messages (send_at)
  where sent_at is null;

-- aucune politique : accès uniquement par les fonctions ci-dessous
alter table public.protocol_scheduled_messages enable row level security;
revoke all on public.protocol_scheduled_messages from anon, authenticated;


create or replace function public.schedule_protocol_message(p_body text, p_send_at timestamptz)
returns jsonb
language plpgsql
security definer
set search_path to ''
as $$
declare
  v_me uuid := auth.uid();
  v_couple_id uuid := public.protocol_my_couple_id();
  v_partner uuid;
  v_body text := trim(coalesce(p_body, ''));
  v_row public.protocol_scheduled_messages%rowtype;
begin
  if v_me is null or v_couple_id is null then
    raise exception 'User does not belong to a couple';
  end if;

  select m.user_id into v_partner
  from public.protocol_couple_members m
  where m.couple_id = v_couple_id and m.user_id <> v_me;

  if v_partner is null then
    raise exception 'Partner not found';
  end if;

  if v_body = '' or length(v_body) > 1200 then
    raise exception 'Invalid message';
  end if;

  if p_send_at is null
     or p_send_at < now() + interval '1 minute'
     or p_send_at > now() + interval '7 days' then
    raise exception 'Invalid send time';
  end if;

  if (
    select count(*) from public.protocol_scheduled_messages s
    where s.sender_user_id = v_me and s.sent_at is null
  ) >= 20 then
    raise exception 'Too many scheduled messages';
  end if;

  insert into public.protocol_scheduled_messages
    (couple_id, sender_user_id, recipient_user_id, body, send_at)
  values
    (v_couple_id, v_me, v_partner, v_body, p_send_at)
  returning * into v_row;

  return jsonb_build_object('id', v_row.id, 'body', v_row.body, 'send_at', v_row.send_at);
end;
$$;

-- mes messages en attente (jamais ceux de l'autre : surprise)
create or replace function public.get_my_scheduled_messages()
returns jsonb
language sql
stable
security definer
set search_path to ''
as $$
  select coalesce(
    jsonb_agg(
      jsonb_build_object('id', s.id, 'body', s.body, 'send_at', s.send_at)
      order by s.send_at
    ),
    '[]'::jsonb
  )
  from public.protocol_scheduled_messages s
  where s.sender_user_id = auth.uid()
    and s.sent_at is null
$$;

create or replace function public.cancel_scheduled_message(p_id uuid)
returns boolean
language plpgsql
security definer
set search_path to ''
as $$
begin
  delete from public.protocol_scheduled_messages
  where id = p_id
    and sender_user_id = auth.uid()
    and sent_at is null;

  if not found then
    raise exception 'Scheduled message not found';
  end if;

  return true;
end;
$$;

-- dépose les messages dont l'heure est venue, une seule fois
-- chacun ; renvoie de quoi envoyer les notifications.
-- Réservée au serveur (fonction send-scheduled).
create or replace function public.protocol_deliver_scheduled_messages()
returns table (
  message_id bigint,
  sender_user_id uuid,
  recipient_user_id uuid,
  sender_name text
)
language plpgsql
security definer
set search_path to ''
as $$
declare
  v_row public.protocol_scheduled_messages%rowtype;
  v_message_id bigint;
begin
  for v_row in
    select * from public.protocol_scheduled_messages s
    where s.sent_at is null and s.send_at <= now()
    order by s.send_at
    for update skip locked
  loop
    -- le duo existe toujours ?
    if not exists (
      select 1 from public.protocol_couple_members m
      where m.couple_id = v_row.couple_id and m.user_id = v_row.recipient_user_id
    ) then
      delete from public.protocol_scheduled_messages where id = v_row.id;
      continue;
    end if;

    insert into public.protocol_messages
      (body, sender_user_id, recipient_user_id, couple_id)
    values
      (v_row.body, v_row.sender_user_id, v_row.recipient_user_id, v_row.couple_id)
    returning id into v_message_id;

    update public.protocol_scheduled_messages
    set sent_at = now(), message_id = v_message_id
    where id = v_row.id;

    message_id := v_message_id;
    sender_user_id := v_row.sender_user_id;
    recipient_user_id := v_row.recipient_user_id;
    select p.display_name into sender_name
    from public.protocol_profiles p
    where p.user_id = v_row.sender_user_id;
    return next;
  end loop;

  -- ménage : envoyés depuis plus de 30 jours
  delete from public.protocol_scheduled_messages
  where sent_at < now() - interval '30 days';
end;
$$;

revoke all on function public.schedule_protocol_message(text, timestamptz) from public, anon;
revoke all on function public.get_my_scheduled_messages() from public, anon;
revoke all on function public.cancel_scheduled_message(uuid) from public, anon;
revoke all on function public.protocol_deliver_scheduled_messages() from public, anon, authenticated;
grant execute on function public.schedule_protocol_message(text, timestamptz) to authenticated;
grant execute on function public.get_my_scheduled_messages() to authenticated;
grant execute on function public.cancel_scheduled_message(uuid) to authenticated;
grant execute on function public.protocol_deliver_scheduled_messages() to service_role;
