-- Notifications discrètes : sur l'écran verrouillé, « Nouveau
-- message » plutôt que « Jérôme t'a envoyé une photo ».
-- Préférence du destinataire, réglée par chacun pour soi (son
-- profil, qu'il peut déjà modifier). Lue par send-message et
-- send-invitation.
-- Migration rejouable sans risque.

alter table public.protocol_profiles
  add column if not exists discreet_notifications boolean not null default false;
