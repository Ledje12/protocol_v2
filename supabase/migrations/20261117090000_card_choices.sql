-- =========================================================
-- Dilemmes : deux boutons sous la carte
--   Une carte peut proposer deux choix (protocol_cards.choice_a /
--   choice_b, libellés posés hors dépôt comme les textes). Le joueur
--   dont c'est le tour touche un bouton ; le choix s'affiche sur les
--   deux téléphones et ne se reprend pas. Un choix par carte jouée
--   (partie + tour), gardé pour le récapitulatif.
--   Lecture et écriture uniquement par fonctions RPC.
-- Migration rejouable sans risque.
-- =========================================================

alter table public.protocol_cards
  add column if not exists choice_a text,
  add column if not exists choice_b text;

alter table public.protocol_cards
  drop constraint if exists protocol_cards_choices_check;
alter table public.protocol_cards
  add constraint protocol_cards_choices_check
  check ((choice_a is null) = (choice_b is null));


create table if not exists public.protocol_card_choices (
  game_id uuid not null references public.games (id) on delete cascade,
  turn_no integer not null,
  card_id bigint not null,
  choice smallint not null,
  chosen_by smallint not null,
  created_at timestamptz not null default now(),
  primary key (game_id, turn_no),
  constraint protocol_card_choices_choice_check check (choice in (1, 2)),
  constraint protocol_card_choices_player_check check (chosen_by in (1, 2))
);

alter table public.protocol_card_choices enable row level security;

-- aucune lecture directe : tout passe par les deux fonctions ci-dessous
revoke all on public.protocol_card_choices from public, anon, authenticated;


-- état du dilemme de la carte en cours (null : la carte n'en a pas)
create or replace function public.get_card_choice(p_game_code text)
returns jsonb
language plpgsql
stable
security definer
set search_path to ''
as $$
declare
  v_player integer := public.protocol_current_player_no(p_game_code);
  v_game public.games%rowtype;
  v_a text;
  v_b text;
  v_choice public.protocol_card_choices%rowtype;
begin
  select * into v_game
  from public.games g
  where g.code = upper(trim(p_game_code));

  if v_game.current_card_id is null
     or coalesce(v_game.current_card_source, 'official') <> 'official' then
    return null;
  end if;

  select c.choice_a, c.choice_b into v_a, v_b
  from public.protocol_cards c
  where c.id = v_game.current_card_id;

  if v_a is null or v_b is null then
    return null;
  end if;

  select * into v_choice
  from public.protocol_card_choices pc
  where pc.game_id = v_game.id
    and pc.turn_no = v_game.turn_no
    and pc.card_id = v_game.current_card_id;

  return jsonb_build_object(
    'card_id', v_game.current_card_id,
    'turn_no', v_game.turn_no,
    'options', jsonb_build_array(v_a, v_b),
    'choice', v_choice.choice,
    'chosen_by', v_choice.chosen_by,
    -- celui dont c'est le tour choisit (sur un seul téléphone : toujours lui)
    'can_choose', v_choice.choice is null
                  and (v_game.active_player = v_player or coalesce(v_game.single_device, false))
  );
end;
$$;


-- choisir : une seule fois par carte, par le joueur dont c'est le tour
create or replace function public.set_card_choice(p_game_code text, p_choice smallint)
returns jsonb
language plpgsql
security definer
set search_path to ''
as $$
declare
  v_player integer := public.protocol_current_player_no(p_game_code);
  v_game public.games%rowtype;
  v_has boolean;
begin
  if p_choice is null or p_choice not in (1, 2) then
    raise exception 'Invalid choice';
  end if;

  select * into v_game
  from public.games g
  where g.code = upper(trim(p_game_code));

  if v_game.status <> 'playing' then
    raise exception 'Game not playing';
  end if;

  if not coalesce(v_game.single_device, false) and v_game.active_player <> v_player then
    raise exception 'Not your turn';
  end if;

  select c.choice_a is not null and c.choice_b is not null into v_has
  from public.protocol_cards c
  where c.id = v_game.current_card_id
    and coalesce(v_game.current_card_source, 'official') = 'official';

  if not coalesce(v_has, false) then
    raise exception 'No choice on this card';
  end if;

  -- le premier choix reste : « on ne change pas d'avis »
  insert into public.protocol_card_choices (game_id, turn_no, card_id, choice, chosen_by)
  values (
    v_game.id, v_game.turn_no, v_game.current_card_id, p_choice,
    case when coalesce(v_game.single_device, false) then v_game.active_player else v_player end
  )
  on conflict (game_id, turn_no) do nothing;

  return public.get_card_choice(p_game_code);
end;
$$;

revoke all on function public.get_card_choice(text) from public, anon;
revoke all on function public.set_card_choice(text, smallint) from public, anon;
grant execute on function public.get_card_choice(text) to authenticated;
grant execute on function public.set_card_choice(text, smallint) to authenticated;
