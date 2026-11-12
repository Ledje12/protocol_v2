-- =========================================================
-- Lovense : deux jouets (le Lush d'elle, l'anneau Diamo de lui)
--   Protocol ne pilote plus les jouets (Lovense Remote s'en
--   charge) : il sait seulement quels jouets sont là, pour ne
--   proposer une carte que si son jouet est connecté, et le dire.
--   - protocol_cards.lovense_toy : 'lush', 'ring', 'both' ou null
--     (n'importe quel jouet)
--   - type d'un jouet déduit de son nom Lovense (lush / diamo)
--   - un jouet est en ligne s'il est marqué connecté (SDK) ou
--     status 1 (rappel du QR) ; toutes les connexions du couple
--     comptent (un téléphone pour deux jouets, ou un chacun)
--   - get_active_rules renvoie le jouet de la carte d'origine
-- Migration rejouable sans risque.
-- =========================================================

alter table public.protocol_cards
  add column if not exists lovense_toy text;

alter table public.protocol_cards
  drop constraint if exists protocol_cards_lovense_toy_check;
alter table public.protocol_cards
  add constraint protocol_cards_lovense_toy_check
  check (lovense_toy is null or lovense_toy in ('lush', 'ring', 'both'));


-- type d'un jouet d'après ce que Lovense renvoie
create or replace function public.protocol_lovense_toy_type(p_toy jsonb)
returns text
language sql
immutable
set search_path to ''
as $$
  select case
    when lower(concat_ws(' ', p_toy ->> 'toyType', p_toy ->> 'name', p_toy ->> 'type'))
         like '%lush%' then 'lush'
    when lower(concat_ws(' ', p_toy ->> 'toyType', p_toy ->> 'name', p_toy ->> 'type'))
         like '%diamo%' then 'ring'
    else 'other'
  end
$$;

-- en ligne : connecté (SDK) ou status 1 (rappel du QR)
create or replace function public.protocol_lovense_toy_online(p_toy jsonb)
returns boolean
language sql
immutable
set search_path to ''
as $$
  select coalesce(p_toy ->> 'connected', '') = 'true'
      or coalesce(p_toy ->> 'status', '') in ('1', 'true')
$$;

-- un jouet de ce type est-il en ligne pour le couple ? (null : n'importe lequel)
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
      and public.protocol_lovense_toy_online(toy)
      and (p_type is null or public.protocol_lovense_toy_type(toy) = p_type)
  )
$$;


create or replace function public.protocol_lovense_connected(p_couple_id uuid)
returns boolean
language sql
stable
security definer
set search_path to ''
as $$
  select public.protocol_lovense_has_toy(p_couple_id, null)
$$;


-- une carte « required » ne sort que si son jouet est là ;
-- 'both' : les deux ; null : n'importe quel jouet
create or replace function public.protocol_lovense_card_allowed(p_couple_id uuid, p_card_id bigint)
returns boolean
language plpgsql
stable
security definer
set search_path to ''
as $$
declare
  v_mode text;
  v_toy text;
begin
  select c.lovense_mode, c.lovense_toy
  into v_mode, v_toy
  from public.protocol_cards c
  where c.id = p_card_id;

  if not found then
    return false;
  end if;

  if coalesce(v_mode, 'none') <> 'required' then
    return true;
  end if;

  if p_couple_id is null then
    return false;
  end if;

  return case v_toy
    when 'lush' then public.protocol_lovense_has_toy(p_couple_id, 'lush')
    when 'ring' then public.protocol_lovense_has_toy(p_couple_id, 'ring')
    when 'both' then public.protocol_lovense_has_toy(p_couple_id, 'lush')
                 and public.protocol_lovense_has_toy(p_couple_id, 'ring')
    else public.protocol_lovense_has_toy(p_couple_id, null)
  end;
end;
$$;

revoke all on function public.protocol_lovense_toy_type(jsonb) from public, anon;
revoke all on function public.protocol_lovense_toy_online(jsonb) from public, anon;
revoke all on function public.protocol_lovense_has_toy(uuid, text) from public, anon;
revoke all on function public.protocol_lovense_connected(uuid) from public, anon;
revoke all on function public.protocol_lovense_card_allowed(uuid, bigint) from public, anon;
grant execute on function public.protocol_lovense_toy_type(jsonb) to authenticated;
grant execute on function public.protocol_lovense_toy_online(jsonb) to authenticated;
grant execute on function public.protocol_lovense_has_toy(uuid, text) to authenticated;
grant execute on function public.protocol_lovense_connected(uuid) to authenticated;
grant execute on function public.protocol_lovense_card_allowed(uuid, bigint) to authenticated;


-- règles actives : le jouet de la carte d'origine (pour le bandeau)
do $$
declare
  v_def text;
  v_new text;
begin
  select pg_get_functiondef('public.get_active_rules(text)'::regprocedure) into v_def;

  if v_def like '%''lovense_toy''%' then
    return;
  end if;

  v_new := regexp_replace(
    v_def,
    '''created_turn'',(\s*)r\.created_turn',
    '''created_turn'',\1r.created_turn,\1''lovense_toy'',\1(select c.lovense_toy from public.protocol_cards c where c.id = r.source_card_id)'
  );

  if v_new = v_def then
    raise notice 'get_active_rules : format inattendu, jouet non ajouté';
    return;
  end if;

  execute v_new;
end $$;
