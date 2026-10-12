-- Réactions : chacun peut aussi réagir à ses propres messages.
-- reaction        = celle du destinataire
-- sender_reaction = celle de l'expéditeur
-- (deux colonnes : la réaction de l'un n'écrase pas celle de l'autre)

alter table public.protocol_messages
  add column if not exists sender_reaction text;

create or replace function public.set_protocol_message_reaction(
  p_message_id bigint,
  p_reaction text
)
returns text
language plpgsql
security definer
set search_path to ''
as $$
declare
  v_me uuid := auth.uid();
begin
  if v_me is null then
    raise exception 'Not authenticated';
  end if;

  if p_reaction is not null and p_reaction not in ('❤️', '🔥', '👍🏼') then
    raise exception 'Invalid reaction';
  end if;

  update public.protocol_messages
     set reaction = case when recipient_user_id = v_me then p_reaction else reaction end,
         sender_reaction = case when sender_user_id = v_me then p_reaction else sender_reaction end
   where id = p_message_id
     and v_me in (sender_user_id, recipient_user_id);

  if not found then
    raise exception 'Message not found';
  end if;

  return p_reaction;
end;
$$;

revoke all on function public.set_protocol_message_reaction(bigint, text) from public, anon;
grant execute on function public.set_protocol_message_reaction(bigint, text) to authenticated;
