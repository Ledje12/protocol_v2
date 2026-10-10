-- =========================================================
-- Album photo chiffré du duo
--   Les photos sont chiffrées SUR LE TÉLÉPHONE (AES-GCM, clé
--   tirée d'une phrase secrète que seuls les deux membres du
--   duo connaissent) avant d'être envoyées : le serveur ne garde
--   que des données illisibles, en qualité d'origine.
--   Fichiers : bucket privé « protocol-photos », rangés par duo
--   ({couple_id}/{photo_id}/original et /thumb) ; seul le duo
--   peut les lire, les envoyer ou les supprimer.
--   La base ne garde que la phrase « témoin » chiffrée (pour
--   vérifier qu'un téléphone a la bonne phrase) : jamais la
--   phrase ni la clé.
--   Une photo peut accompagner un message (protocol_messages
--   .photo_id) ; supprimer une photo la retire pour les deux.
--   Garde-fou : ~950 Mo par duo (offre gratuite : 1 Go).
-- Migration rejouable sans risque.
-- =========================================================


-- ---------------------------------------------------------
-- 1. DUO DU COMPTE CONNECTÉ
-- ---------------------------------------------------------

create or replace function public.protocol_my_couple_id()
returns uuid
language sql
stable
security definer
set search_path to ''
as $$
  select m.couple_id
  from public.protocol_couple_members m
  where m.user_id = auth.uid()
  limit 1
$$;

revoke all on function public.protocol_my_couple_id() from public, anon;
grant execute on function public.protocol_my_couple_id() to authenticated;


-- ---------------------------------------------------------
-- 2. PHRASE SECRÈTE : seulement de quoi la vérifier
-- ---------------------------------------------------------

alter table public.protocol_couple_settings
  add column if not exists album_key_salt text,
  add column if not exists album_key_check text;

create or replace function public.get_protocol_album_key()
returns jsonb
language sql
stable
security definer
set search_path to ''
as $$
  select case
    when s.album_key_salt is null then null
    else jsonb_build_object('salt', s.album_key_salt, 'check', s.album_key_check)
  end
  from public.protocol_couple_settings s
  where s.couple_id = public.protocol_my_couple_id()
$$;

-- une seule fois par duo : changer de phrase rendrait les
-- photos déjà envoyées illisibles
create or replace function public.set_protocol_album_key(p_salt text, p_check text)
returns boolean
language plpgsql
security definer
set search_path to ''
as $$
declare
  v_couple_id uuid := public.protocol_my_couple_id();
begin
  if v_couple_id is null then
    raise exception 'User does not belong to a couple';
  end if;

  if coalesce(length(p_salt), 0) < 16 or coalesce(length(p_check), 0) < 16 then
    raise exception 'Invalid album key';
  end if;

  insert into public.protocol_couple_settings
    (couple_id, album_key_salt, album_key_check, updated_by, updated_at)
  values
    (v_couple_id, p_salt, p_check, auth.uid(), now())
  on conflict (couple_id) do update
    set album_key_salt = excluded.album_key_salt,
        album_key_check = excluded.album_key_check,
        updated_by = excluded.updated_by,
        updated_at = excluded.updated_at
    where public.protocol_couple_settings.album_key_salt is null;

  if not found then
    raise exception 'Album key already set';
  end if;

  return true;
end;
$$;


-- ---------------------------------------------------------
-- 3. LES PHOTOS
-- ---------------------------------------------------------

create table if not exists public.protocol_photos (
  id uuid primary key default gen_random_uuid(),
  couple_id uuid not null,
  sender_user_id uuid not null references auth.users (id) on delete cascade,
  created_at timestamptz not null default now(),
  mime text not null,
  byte_size bigint not null check (byte_size > 0),
  thumb_size bigint not null check (thumb_size > 0),
  width integer,
  height integer,
  ready boolean not null default false
);

create index if not exists protocol_photos_couple
  on public.protocol_photos (couple_id, created_at desc);

alter table public.protocol_photos enable row level security;
revoke all on public.protocol_photos from anon, authenticated;
grant select on public.protocol_photos to authenticated;

drop policy if exists "protocol_photos_couple" on public.protocol_photos;
create policy "protocol_photos_couple"
  on public.protocol_photos
  for select
  to authenticated
  using (couple_id = public.protocol_my_couple_id() and ready);

alter table public.protocol_messages
  add column if not exists photo_id uuid
    references public.protocol_photos (id) on delete set null;

-- plafond par duo (Mo), sous les 1 Go de l'offre gratuite
create or replace function public.protocol_album_quota()
returns bigint
language sql
immutable
set search_path to ''
as $$ select 950::bigint * 1024 * 1024 $$;

create or replace function public.get_protocol_album_usage()
returns jsonb
language sql
stable
security definer
set search_path to ''
as $$
  select jsonb_build_object(
    'used', coalesce(sum(p.byte_size + p.thumb_size), 0),
    'quota', public.protocol_album_quota(),
    'count', count(*) filter (where p.ready)
  )
  from public.protocol_photos p
  where p.couple_id = public.protocol_my_couple_id()
$$;

-- 1) réserver la place et obtenir les chemins
create or replace function public.create_protocol_photo(
  p_mime text,
  p_byte_size bigint,
  p_thumb_size bigint,
  p_width integer,
  p_height integer
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
    (couple_id, sender_user_id, mime, byte_size, thumb_size, width, height)
  values
    (v_couple_id, auth.uid(), left(coalesce(p_mime, 'image/jpeg'), 60),
     p_byte_size, p_thumb_size, p_width, p_height)
  returning id into v_id;

  return jsonb_build_object(
    'id', v_id,
    'original_path', v_couple_id || '/' || v_id || '/original',
    'thumb_path', v_couple_id || '/' || v_id || '/thumb'
  );
end;
$$;

-- 2) une fois les deux fichiers envoyés
create or replace function public.finish_protocol_photo(p_photo_id uuid)
returns boolean
language plpgsql
security definer
set search_path to ''
as $$
begin
  update public.protocol_photos
  set ready = true
  where id = p_photo_id
    and sender_user_id = auth.uid();

  if not found then
    raise exception 'Photo not found';
  end if;

  return true;
end;
$$;

-- supprimer pour les deux (les fichiers sont retirés avant par
-- le téléphone, avec les droits du duo sur le bucket)
create or replace function public.delete_protocol_photo(p_photo_id uuid)
returns boolean
language plpgsql
security definer
set search_path to ''
as $$
begin
  delete from public.protocol_photos
  where id = p_photo_id
    and couple_id = public.protocol_my_couple_id();

  if not found then
    raise exception 'Photo not found';
  end if;

  return true;
end;
$$;


-- ---------------------------------------------------------
-- 4. FICHIERS : bucket privé, accès réservé au duo
-- ---------------------------------------------------------

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('protocol-photos', 'protocol-photos', false, 31457280, array['application/octet-stream'])
on conflict (id) do nothing;

drop policy if exists "protocol_photos_read" on storage.objects;
create policy "protocol_photos_read"
  on storage.objects
  for select
  to authenticated
  using (
    bucket_id = 'protocol-photos'
    and (storage.foldername(name))[1] = public.protocol_my_couple_id()::text
  );

drop policy if exists "protocol_photos_upload" on storage.objects;
create policy "protocol_photos_upload"
  on storage.objects
  for insert
  to authenticated
  with check (
    bucket_id = 'protocol-photos'
    and (storage.foldername(name))[1] = public.protocol_my_couple_id()::text
  );

drop policy if exists "protocol_photos_delete" on storage.objects;
create policy "protocol_photos_delete"
  on storage.objects
  for delete
  to authenticated
  using (
    bucket_id = 'protocol-photos'
    and (storage.foldername(name))[1] = public.protocol_my_couple_id()::text
  );


-- ---------------------------------------------------------
-- DROITS
-- ---------------------------------------------------------

revoke all on function public.get_protocol_album_key() from public, anon;
revoke all on function public.set_protocol_album_key(text, text) from public, anon;
revoke all on function public.get_protocol_album_usage() from public, anon;
revoke all on function public.create_protocol_photo(text, bigint, bigint, integer, integer) from public, anon;
revoke all on function public.finish_protocol_photo(uuid) from public, anon;
revoke all on function public.delete_protocol_photo(uuid) from public, anon;

grant execute on function public.get_protocol_album_key() to authenticated;
grant execute on function public.set_protocol_album_key(text, text) to authenticated;
grant execute on function public.get_protocol_album_usage() to authenticated;
grant execute on function public.create_protocol_photo(text, bigint, bigint, integer, integer) to authenticated;
grant execute on function public.finish_protocol_photo(uuid) to authenticated;
grant execute on function public.delete_protocol_photo(uuid) to authenticated;
