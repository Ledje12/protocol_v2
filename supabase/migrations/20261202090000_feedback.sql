-- =========================================================
-- Retours des joueurs : « Une idée, un souci ? » dans Réglages et
-- en fin de partie. Les messages arrivent dans protocol_feedback,
-- lue depuis le tableau de bord Supabase. Aucun accès direct depuis
-- l'app : écriture par une fonction, pas de lecture.
-- =========================================================

create table if not exists public.protocol_feedback (
  id bigint generated always as identity primary key,
  user_id uuid not null references auth.users (id) on delete cascade,
  display_name text,
  kind text not null check (kind in ('idea', 'issue', 'card')),
  body text not null check (char_length(body) between 1 and 2000),
  game_id uuid references public.games (id) on delete set null,
  app_version text,
  created_at timestamptz not null default now()
);

alter table public.protocol_feedback enable row level security;

create index if not exists protocol_feedback_created_idx
  on public.protocol_feedback (created_at desc);

create or replace function public.submit_protocol_feedback(
  p_kind text,
  p_body text,
  p_game_id uuid default null,
  p_app_version text default null
)
returns void
language plpgsql
security definer
set search_path to ''
as $$
declare
  v_user uuid := auth.uid();
  v_body text := btrim(coalesce(p_body, ''));
  v_name text;
begin
  if v_user is null then
    raise exception 'Connexion requise' using errcode = '42501';
  end if;

  if v_body = '' then
    raise exception 'Message vide';
  end if;

  if p_kind not in ('idea', 'issue', 'card') then
    raise exception 'Type de message inconnu';
  end if;

  -- garde-fou : 20 messages par jour et par compte
  if (select count(*) from public.protocol_feedback
       where user_id = v_user and created_at > now() - interval '1 day') >= 20 then
    raise exception 'Beaucoup de messages aujourd’hui : réessaie demain.';
  end if;

  select nullif(btrim(pr.display_name), '')
    into v_name
    from public.protocol_profiles pr where pr.user_id = v_user;

  insert into public.protocol_feedback (user_id, display_name, kind, body, game_id, app_version)
  values (
    v_user,
    v_name,
    p_kind,
    left(v_body, 2000),
    -- une partie n'est retenue que si l'auteur y joue
    case when p_game_id is not null and exists (
      select 1 from public.game_players gp
       where gp.game_id = p_game_id and gp.user_id = v_user
    ) then p_game_id end,
    left(p_app_version, 40)
  );
end;
$$;

revoke all on function public.submit_protocol_feedback(text, text, uuid, text) from public, anon;
grant execute on function public.submit_protocol_feedback(text, text, uuid, text) to authenticated;
