-- La vue protocol_playable_cards (cartes officielles + cartes perso)
-- s'exécutait avec les droits de son créateur : RLS ignorée, et
-- anon/authenticated pouvaient la lire directement via l'API,
-- cartes perso de tous les couples comprises.
--
-- Personne ne la lit depuis l'app : seules les fonctions du jeu
-- (security definer) s'en servent. On la ferme donc à l'API et on
-- la passe en security_invoker (avis « Security Definer View »).

alter view public.protocol_playable_cards set (security_invoker = true);

revoke all on public.protocol_playable_cards from anon, authenticated;
