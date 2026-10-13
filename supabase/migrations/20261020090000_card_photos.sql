-- =========================================================
-- Photos de cartes : un picto 📷 sur chaque carte en jeu.
--   La photo est chiffrée et rangée dans l'album (sans message),
--   et rattachée à la carte, pas à la partie : elle illustre la
--   carte, et se retrouve dans le récap de toutes les soirées où
--   cette carte est sortie.
-- Migration rejouable sans risque.
-- =========================================================

alter table public.protocol_photos
  add column if not exists card_source text
    check (card_source is null or card_source in ('official', 'custom')),
  add column if not exists card_id bigint;

create index if not exists protocol_photos_card
  on public.protocol_photos (couple_id, card_source, card_id)
  where card_id is not null;

-- même fonction, avec la carte en option : l'ancienne version
-- (sans carte) est remplacée pour éviter deux variantes
drop function if exists public.create_protocol_photo(text, bigint, bigint, integer, integer);

create or replace function public.create_protocol_photo(
  p_mime text,
  p_byte_size bigint,
  p_thumb_size bigint,
  p_width integer,
  p_height integer,
  p_card_source text default null,
  p_card_id bigint default null
)
returns jsonb
language plpgsql
security definer
set search_path to ''
as $$
declare
  v_couple_id uuid := public.protocol_my_couple_id();
  v_used bigint;
  v_id uuid;
begin
  if v_couple_id is null then
    raise exception 'User does not belong to a couple';
  end if;

  if coalesce(p_byte_size, 0) <= 0 or p_byte_size > 30 * 1024 * 1024
     or coalesce(p_thumb_size, 0) <= 0 or p_thumb_size > 2 * 1024 * 1024 then
    raise exception 'Invalid photo size';
  end if;

  -- la carte doit exister (une carte perso : seulement celle du duo)
  if p_card_id is not null and not (
    (p_card_source = 'official' and exists (
      select 1 from public.protocol_cards c where c.id = p_card_id
    ))
    or (p_card_source = 'custom' and exists (
      select 1 from public.protocol_custom_cards c
      where c.id = p_card_id and c.couple_id = v_couple_id
    ))
  ) then
    raise exception 'Card not found';
  end if;

  -- envois abandonnés (téléphone coupé pendant l'envoi)
  delete from public.protocol_photos
  where couple_id = v_couple_id
    and not ready
    and created_at < now() - interval '1 day';

  select coalesce(sum(byte_size + thumb_size), 0) into v_used
  from public.protocol_photos
  where couple_id = v_couple_id;

  if v_used + p_byte_size + p_thumb_size > public.protocol_album_quota() then
    raise exception 'Album full';
  end if;

  insert into public.protocol_photos
    (couple_id, sender_user_id, mime, byte_size, thumb_size, width, height,
     card_source, card_id)
  values
    (v_couple_id, auth.uid(), left(coalesce(p_mime, 'image/jpeg'), 60),
     p_byte_size, p_thumb_size, p_width, p_height,
     case when p_card_id is not null then p_card_source end, p_card_id)
  returning id into v_id;

  return jsonb_build_object(
    'id', v_id,
    'original_path', v_couple_id || '/' || v_id || '/original',
    'thumb_path', v_couple_id || '/' || v_id || '/thumb'
  );
end;
$$;

revoke all on function public.create_protocol_photo(text, bigint, bigint, integer, integer, text, bigint) from public, anon;
grant execute on function public.create_protocol_photo(text, bigint, bigint, integer, integer, text, bigint) to authenticated;
