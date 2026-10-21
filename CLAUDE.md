# Protocol : conventions

Dépôt public : jamais de vrai contenu de cartes, de secrets ni de données
personnelles dans le dépôt (seeds synthétiques uniquement).

## Migrations Supabase (`supabase/migrations`)

- Rejouables : `create … if not exists`, `create or replace`, gardes `do $$`.
- Fonctions : `security definer` + `set search_path to ''`, noms qualifiés
  (`public.…`).
- Chaque nouvelle table : `enable row level security`.
- **Droits explicites (Supabase, depuis le 30/10/2026)** : une table créée
  dans `public` n'est plus accessible à l'API sans `grant`. Dans la même
  migration que la table, n'accorder que ce dont l'app a besoin :
  - table lue seulement via des fonctions RPC `security definer` : aucun
    grant (rien à faire, c'est le cas de la plupart des tables) ;
  - table lue directement par l'app (`supabase.from(...)`) : le strict
    nécessaire, par exemple `grant select on public.x to authenticated;`
    (jamais `anon` sauf besoin réel), en plus des policies RLS.
- Le SQL est lancé à la main dans l'éditeur Supabase ; les fonctions edge
  sont redéployées depuis le tableau de bord.

## Tests

`cd tests && npm test` (unitaires + base locale, `TEST_DATABASE_URL`).
