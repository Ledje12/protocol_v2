-- =========================================================
-- « Nos soirées » : un souvenir de chaque partie terminée
--   Rejouer remet la partie à zéro (historique des cartes effacé) :
--   on prend donc une photo de la soirée au moment où elle se
--   termine (déclencheur), gardée pour le duo.
--   Contenu : durée, cartes tirées (titre, type, intensité, issue),
--   missions secrètes révélées. Pas les enveloppes : leurs mots
--   restent éphémères, comme prévu.
--   Les avis 🔥 ne sont pas figés : lus à l'affichage (les miens,
--   et ceux notés 🔥 par vous deux), ils suivent vos changements.
-- Migration rejouable sans risque.
-- =========================================================

create table if not exists public.protocol_game_recaps (
  id uuid primary key default gen_random_uuid(),
  couple_id uuid not null,
  game_id uuid,
  started_at timestamptz,
  finished_at timestamptz not null,
  player_1_name text,
  player_2_name text,
  cards jsonb not null default '[]'::jsonb,
  missions jsonb not null default '[]'::jsonb,
  created_at timestamptz not null default now(),
  unique (game_id, finished_at)
);

create index if not exists protocol_game_recaps_couple
  on public.protocol_game_recaps (couple_id, finished_at desc);

-- aucune politique : accès uniquement par les fonctions ci-dessous
alter table public.protocol_game_recaps enable row level security;
revoke all on public.protocol_game_recaps from anon, authenticated;


-- photo de la soirée (appelée par le déclencheur, et pour les
-- parties déjà terminées)
create or replace function public.protocol_snapshot_recap(p_game_id uuid)
returns void
language plpgsql
security definer
set search_path to ''
as $$
declare
  v_game public.games%rowtype;
begin
  select * into v_game from public.games where id = p_game_id;

  if v_game.id is null or v_game.finished_at is null then
    return;
  end if;

  insert into public.protocol_game_recaps (
    couple_id, game_id, started_at, finished_at,
    player_1_name, player_2_name, cards, missions
  )
  select
    v_game.couple_id,
    v_game.id,
    (select min(h.shown_at) from public.game_card_history h where h.game_id = v_game.id),
    v_game.finished_at,
    v_game.player_1_name,
    v_game.player_2_name,
    coalesce((
      select jsonb_agg(
        jsonb_build_object(
          'source', h.card_source,
          'card_id', coalesce(h.card_id, h.custom_card_id),
          'title', coalesce(oc.title, cc.title),
          'type', coalesce(oc.type, cc.type),
          'intensity', coalesce(oc.intensity, cc.intensity),
          'player_no', h.player_no,
          'outcome', h.outcome
        )
        order by h.turn_no, h.id
      )
      from public.game_card_history h
      left join public.protocol_cards oc
        on h.card_source = 'official' and oc.id = h.card_id
      left join public.protocol_custom_cards cc
        on h.card_source = 'custom' and cc.id = h.custom_card_id
      where h.game_id = v_game.id
    ), '[]'::jsonb),
    coalesce((
      select jsonb_agg(
        jsonb_build_object(
          'player_no', gm.player_no,
          'title', m.title,
          'done', gm.done
        )
        order by gm.player_no
      )
      from public.protocol_game_missions gm
      join public.protocol_missions m on m.id = gm.mission_id
      where gm.game_id = v_game.id
    ), '[]'::jsonb)
  on conflict (game_id, finished_at) do nothing;
end;
$$;

create or replace function public.protocol_recap_on_finish()
returns trigger
language plpgsql
security definer
set search_path to ''
as $$
begin
  if new.status = 'finished'
     and old.status is distinct from 'finished'
     and new.finished_at is not null then
    perform public.protocol_snapshot_recap(new.id);
  end if;

  return new;
end;
$$;

drop trigger if exists trg_protocol_recap_on_finish on public.games;
create trigger trg_protocol_recap_on_finish
  after update of status on public.games
  for each row
  execute function public.protocol_recap_on_finish();


-- nos soirées, de la plus récente à la plus ancienne ; pour chaque
-- carte : mon avis, et si vous l'avez notée 🔥 tous les deux
create or replace function public.get_protocol_recaps(p_game_id uuid default null)
returns jsonb
language sql
stable
security definer
set search_path to ''
as $$
  with mine as (
    select public.protocol_my_couple_id() as couple_id, auth.uid() as user_id
  ),
  fire_both as (
    select r.card_source, r.card_id
    from public.protocol_card_ratings r
    join public.protocol_couple_members m
      on m.user_id = r.user_id
     and m.couple_id = (select couple_id from mine)
    where r.rating = 'fire'
    group by r.card_source, r.card_id
    having count(distinct r.user_id) = 2
  )
  select coalesce(jsonb_agg(recap order by recap->>'finished_at' desc), '[]'::jsonb)
  from (
    select jsonb_build_object(
      'id', g.id,
      'game_id', g.game_id,
      'started_at', g.started_at,
      'finished_at', g.finished_at,
      'player_1_name', g.player_1_name,
      'player_2_name', g.player_2_name,
      'missions', g.missions,
      'cards', coalesce((
        select jsonb_agg(
          c.card || jsonb_build_object(
            'my_rating', r.rating,
            'fire_both', fb.card_id is not null
          )
          order by c.ord
        )
        from jsonb_array_elements(g.cards) with ordinality as c(card, ord)
        left join public.protocol_card_ratings r
          on r.user_id = (select user_id from mine)
         and r.card_source = c.card->>'source'
         and r.card_id = (c.card->>'card_id')::bigint
        left join fire_both fb
          on fb.card_source = c.card->>'source'
         and fb.card_id = (c.card->>'card_id')::bigint
      ), '[]'::jsonb)
    ) as recap
    from public.protocol_game_recaps g
    where g.couple_id = (select couple_id from mine)
      and (p_game_id is null or g.game_id = p_game_id)
    order by g.finished_at desc
    limit 100
  ) recaps
$$;

-- oublier une soirée (pour vous deux)
create or replace function public.delete_protocol_recap(p_recap_id uuid)
returns boolean
language plpgsql
security definer
set search_path to ''
as $$
begin
  delete from public.protocol_game_recaps
  where id = p_recap_id
    and couple_id = public.protocol_my_couple_id();

  if not found then
    raise exception 'Recap not found';
  end if;

  return true;
end;
$$;

revoke all on function public.protocol_snapshot_recap(uuid) from public, anon, authenticated;
revoke all on function public.protocol_recap_on_finish() from public, anon, authenticated;
revoke all on function public.get_protocol_recaps(uuid) from public, anon;
revoke all on function public.delete_protocol_recap(uuid) from public, anon;
grant execute on function public.get_protocol_recaps(uuid) to authenticated;
grant execute on function public.delete_protocol_recap(uuid) to authenticated;

-- les parties déjà terminées (encore en mémoire) deviennent des soirées
do $$
declare
  v_id uuid;
begin
  for v_id in
    select g.id from public.games g
    where g.status = 'finished' and g.finished_at is not null
  loop
    perform public.protocol_snapshot_recap(v_id);
  end loop;
end;
$$;
