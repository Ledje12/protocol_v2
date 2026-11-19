-- =========================================================
-- Sécurité et signalements (19/11/2026)
--
-- 1. Fonctions internes du Director trop ouvertes : elles prennent
--    l'identifiant d'une partie et ne vérifient pas que l'appelant y
--    joue. Elles ne servent qu'à l'intérieur d'autres fonctions
--    (security definer, propriétaire postgres) : on retire le droit
--    de les appeler directement depuis l'app.
--
-- 2. « Signaler » une carte de la bibliothèque : faute, carte qui
--    tombe à plat, pas pour nous, doublon, autre. Table lue seulement
--    dans l'éditeur SQL (aucun grant), écriture par une fonction.
--
-- Migration rejouable sans risque.
-- =========================================================

-- ---------------------------------------------------------
-- 1. Fonctions internes : plus d'appel direct
-- ---------------------------------------------------------

do $$
begin
  if to_regprocedure('public.protocol_select_card_v2_unified(uuid, integer, integer, text)') is not null then
    revoke all on function public.protocol_select_card_v2_unified(uuid, integer, integer, text)
      from public, anon, authenticated;
  end if;

  if to_regprocedure('public.protocol_last_intensity_v2(uuid)') is not null then
    revoke all on function public.protocol_last_intensity_v2(uuid)
      from public, anon, authenticated;
  end if;

  if to_regprocedure('public.protocol_recent_high_intensity_count_v2(uuid, integer)') is not null then
    revoke all on function public.protocol_recent_high_intensity_count_v2(uuid, integer)
      from public, anon, authenticated;
  end if;

  if to_regprocedure('public.protocol_recent_type_count_v2(uuid, text, integer)') is not null then
    revoke all on function public.protocol_recent_type_count_v2(uuid, text, integer)
      from public, anon, authenticated;
  end if;
end $$;


-- ---------------------------------------------------------
-- 2. Signalements
-- ---------------------------------------------------------

create table if not exists public.protocol_card_reports (
  id bigint generated always as identity primary key,
  user_id uuid not null references auth.users (id) on delete cascade,
  card_source text not null
    check (card_source in ('official', 'custom')),
  card_id bigint not null,
  reason text not null
    check (reason in ('faute', 'flop', 'pas_pour_nous', 'doublon', 'autre')),
  comment text
    check (comment is null or char_length(comment) <= 500),
  created_at timestamptz not null default now()
);

create index if not exists protocol_card_reports_card_idx
  on public.protocol_card_reports (card_source, card_id);

alter table public.protocol_card_reports enable row level security;

-- lue seulement dans l'éditeur SQL : aucun accès direct depuis l'app
revoke all on public.protocol_card_reports from public, anon, authenticated;


create or replace function public.report_protocol_card(
  p_card_source text,
  p_card_id bigint,
  p_reason text,
  p_comment text default null
)
returns boolean
language plpgsql
security definer
set search_path to ''
as $$
declare
  v_comment text := nullif(trim(coalesce(p_comment, '')), '');
begin
  if auth.uid() is null then
    raise exception 'Authentication required';
  end if;

  if p_card_source not in ('official', 'custom') then
    raise exception 'Invalid card source';
  end if;

  if p_reason not in ('faute', 'flop', 'pas_pour_nous', 'doublon', 'autre') then
    raise exception 'Invalid reason';
  end if;

  if v_comment is not null and char_length(v_comment) > 500 then
    raise exception 'Comment too long';
  end if;

  -- garde-fou : pas plus de 30 signalements par jour et par joueur
  if (
    select count(*)
    from public.protocol_card_reports r
    where r.user_id = auth.uid()
      and r.created_at > now() - interval '1 day'
  ) >= 30 then
    raise exception 'Too many reports';
  end if;

  insert into public.protocol_card_reports
    (user_id, card_source, card_id, reason, comment)
  values
    (auth.uid(), p_card_source, p_card_id, p_reason, v_comment);

  return true;
end;
$$;

revoke all on function public.report_protocol_card(text, bigint, text, text) from public, anon;
grant execute on function public.report_protocol_card(text, bigint, text, text) to authenticated;


-- ---------------------------------------------------------
-- Lecture des signalements (à lancer dans le SQL Editor)
-- ---------------------------------------------------------
-- select r.created_at, p.display_name, c.library_key, c.title, r.reason, r.comment
-- from public.protocol_card_reports r
-- left join public.protocol_profiles p on p.user_id = r.user_id
-- left join public.protocol_cards c on r.card_source = 'official' and c.id = r.card_id
-- order by r.created_at desc;
