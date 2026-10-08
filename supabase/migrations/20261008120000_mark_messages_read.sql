-- Marque comme lus les messages reçus par l'utilisateur connecté.
-- Appelée par l'écran Messages à son ouverture (src/unread.js).
-- SECURITY DEFINER : la table reste en lecture seule pour les
-- clients ; seule cette fonction peut remplir read_at, et
-- uniquement pour les messages dont on est le destinataire.

create or replace function public.mark_protocol_messages_read()
returns integer
language plpgsql
security definer
set search_path to ''
as $$
declare
  v_count integer;
begin
  if auth.uid() is null then
    raise exception 'Not authenticated';
  end if;

  update public.protocol_messages
     set read_at = now()
   where recipient_user_id = auth.uid()
     and read_at is null;

  get diagnostics v_count = row_count;
  return v_count;
end;
$$;

revoke all on function public.mark_protocol_messages_read() from public, anon;
grant execute on function public.mark_protocol_messages_read() to authenticated;
