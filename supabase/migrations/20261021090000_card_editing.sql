-- =========================================================
-- Modifier une carte depuis la bibliothèque
--   Consigne et intensité seulement (pas le titre, le type, le
--   sexe visé ni la catégorie), écrites tout de suite dans la base.
--   Réservé aux comptes listés dans protocol_admins, ajoutés à la
--   main dans le SQL Editor :
--     insert into public.protocol_admins (user_id)
--     select id from auth.users where email = '…';
--   Pas d'historique : une réécriture par Claude classique
--   remplacera la version modifiée ici.
-- Migration rejouable sans risque.
-- =========================================================

create table if not exists public.protocol_admins (
  user_id uuid primary key references auth.users (id) on delete cascade,
  created_at timestamptz not null default now()
);

-- aucune politique : la liste ne se lit ni ne s'écrit depuis l'app
alter table public.protocol_admins enable row level security;
revoke all on public.protocol_admins from anon, authenticated;

-- pour afficher (ou non) le bouton « Modifier »
create or replace function public.protocol_is_admin()
returns boolean
language sql
stable
security definer
set search_path to ''
as $$
  select exists (
    select 1 from public.protocol_admins a where a.user_id = auth.uid()
  )
$$;

create or replace function public.update_protocol_card(
  p_card_id bigint,
  p_prompt text,
  p_intensity smallint
)
returns jsonb
language plpgsql
security definer
set search_path to ''
as $$
declare
  v_prompt text := trim(coalesce(p_prompt, ''));
  v_card public.protocol_cards%rowtype;
begin
  if not public.protocol_is_admin() then
    raise exception 'Not allowed';
  end if;

  if v_prompt = '' or length(v_prompt) > 2000 then
    raise exception 'Invalid prompt';
  end if;

  if p_intensity is null or p_intensity not between 1 and 5 then
    raise exception 'Invalid intensity';
  end if;

  update public.protocol_cards
  set prompt = v_prompt,
      intensity = p_intensity
  where id = p_card_id
  returning * into v_card;

  if v_card.id is null then
    raise exception 'Card not found';
  end if;

  return jsonb_build_object(
    'id', v_card.id,
    'prompt', v_card.prompt,
    'intensity', v_card.intensity
  );
end;
$$;

revoke all on function public.protocol_is_admin() from public, anon;
revoke all on function public.update_protocol_card(bigint, text, smallint) from public, anon;
grant execute on function public.protocol_is_admin() to authenticated;
grant execute on function public.update_protocol_card(bigint, text, smallint) to authenticated;
