-- =========================================================
-- Journal des erreurs de l'app
--   Quand l'app plante ou qu'une action échoue sur un téléphone,
--   l'erreur est notée ici (aucun service extérieur). Personne ne
--   peut lire la table depuis l'app : on la consulte dans
--   l'éditeur SQL de Supabase. Les entrées de plus de 90 jours
--   sont effacées au fil de l'eau.
--   Garde-fous : textes tronqués, 30 erreurs par heure et par
--   compte au plus (200 par heure sans compte).
-- Migration rejouable sans risque.
--
-- Lire les dernières erreurs :
--   select created_at, p.display_name, e.source, e.message,
--          e.context ->> 'path' as page, e.app_version
--   from public.protocol_client_errors e
--   left join public.protocol_profiles p on p.user_id = e.user_id
--   order by e.created_at desc
--   limit 50;
--
-- Les plus fréquentes sur 7 jours :
--   select e.message, count(*), max(e.created_at) as derniere
--   from public.protocol_client_errors e
--   where e.created_at > now() - interval '7 days'
--   group by 1 order by 2 desc;
-- =========================================================

create table if not exists public.protocol_client_errors (
  id bigint generated always as identity primary key,
  created_at timestamptz not null default now(),
  user_id uuid references auth.users (id) on delete set null,
  source text not null,
  message text not null,
  stack text,
  app_version text,
  user_agent text,
  context jsonb not null default '{}'::jsonb
);

create index if not exists protocol_client_errors_created_at
  on public.protocol_client_errors (created_at);

create index if not exists protocol_client_errors_user_recent
  on public.protocol_client_errors (user_id, created_at);

-- aucune politique : illisible et non modifiable depuis l'app
alter table public.protocol_client_errors enable row level security;
revoke all on public.protocol_client_errors from anon, authenticated;


create or replace function public.log_client_error(
  p_source text,
  p_message text,
  p_stack text default null,
  p_app_version text default null,
  p_user_agent text default null,
  p_context jsonb default '{}'::jsonb
)
returns boolean
language plpgsql
security definer
set search_path to ''
as $$
declare
  v_user_id uuid := auth.uid();
  v_recent integer;
begin
  if coalesce(trim(p_message), '') = '' then
    return false;
  end if;

  -- garde-fou contre une boucle d'erreurs
  select count(*)
  into v_recent
  from public.protocol_client_errors e
  where e.created_at > now() - interval '1 hour'
    and e.user_id is not distinct from v_user_id;

  if v_recent >= (case when v_user_id is null then 200 else 30 end) then
    return false;
  end if;

  insert into public.protocol_client_errors (
    user_id, source, message, stack, app_version, user_agent, context
  )
  values (
    v_user_id,
    left(coalesce(nullif(trim(p_source), ''), 'app'), 40),
    left(p_message, 1000),
    left(p_stack, 4000),
    left(p_app_version, 40),
    left(p_user_agent, 300),
    case
      when jsonb_typeof(p_context) = 'object'
       and length(p_context::text) <= 4000
        then p_context
      else '{}'::jsonb
    end
  );

  -- ménage : rien au-delà de 90 jours
  delete from public.protocol_client_errors
  where created_at < now() - interval '90 days';

  return true;
end;
$$;

revoke all on function public.log_client_error(text, text, text, text, text, jsonb) from public;
grant execute on function public.log_client_error(text, text, text, text, text, jsonb) to anon, authenticated;
