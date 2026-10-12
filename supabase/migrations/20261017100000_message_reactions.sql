-- Réactions aux messages : ❤️, 🔥 ou 👍🏼, posées par celui ou celle
-- qui a reçu le message (appui long). La colonne reaction existe
-- déjà ; la table reste en lecture seule pour les clients, seule
-- cette fonction l'écrit. null retire la réaction.

create or replace function public.set_protocol_message_reaction(
  p_message_id bigint,
  p_reaction text
)
returns text
language plpgsql
security definer
set search_path to ''
as $$
begin
  if auth.uid() is null then
    raise exception 'Not authenticated';
  end if;

  if p_reaction is not null and p_reaction not in ('❤️', '🔥', '👍🏼') then
    raise exception 'Invalid reaction';
  end if;

  update public.protocol_messages
     set reaction = p_reaction
   where id = p_message_id
     and recipient_user_id = auth.uid();

  if not found then
    raise exception 'Message not found';
  end if;

  return p_reaction;
end;
$$;

revoke all on function public.set_protocol_message_reaction(bigint, text) from public, anon;
grant execute on function public.set_protocol_message_reaction(bigint, text) to authenticated;
