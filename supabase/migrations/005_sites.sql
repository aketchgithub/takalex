-- REAL CHEMOLEX SITES
--
-- Reference data (not test data): reaches every environment with this
-- migration. Each waste picker group has the same name as its site, so these
-- are also the collectors' groups (confirmed with Chemolex, 7 Nov).
--
-- location is NULL until Chemolex supplies real coordinates; do not invent
-- them. More sites are added later by administrators.
--
-- Idempotent: sites.name is UNIQUE, so re-running inserts nothing and never
-- changes an existing row (for example one an admin has deactivated).
INSERT INTO public.sites (name, location, active)
VALUES
  ('Kariadudu',  NULL, true),
  ('Ng''omong''o', NULL, true),
  ('Kiyambea',   NULL, true),
  ('Komb Green', NULL, true),
  ('Mathare',    NULL, true),
  ('Babadogo',   NULL, true),
  ('Njiru',      NULL, true),
  ('Kariobangi', NULL, true)
ON CONFLICT (name) DO NOTHING;
