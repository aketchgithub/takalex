-- LOCAL DEVELOPMENT SEED DATA ONLY
--
-- Applied by `supabase db reset` on the local stack ([db.seed] in config.toml).
-- These are fictional placeholder sites for development and testing.
-- They are NOT real Chemolex sites. The real site list will be added
-- separately once confirmed.
--
-- Coordinates are deliberately fictional: points near 0°N 0°E in the
-- Gulf of Guinea, far from Kenya, so they cannot be mistaken for real sites.
--
-- No managers or collectors are assigned to these sites.
-- Idempotent: sites.name is UNIQUE, so re-running inserts nothing new.
INSERT INTO public.sites (name, location, active)
VALUES
  ('TEST Site 1', 'SRID=4326;POINT(0.001 0.001)', true),
  ('TEST Site 2', 'SRID=4326;POINT(0.002 0.002)', true),
  ('TEST Site 3', 'SRID=4326;POINT(0.003 0.003)', true),
  ('TEST Site 4', 'SRID=4326;POINT(0.004 0.004)', true),
  ('TEST Site 5', 'SRID=4326;POINT(0.005 0.005)', true),
  ('TEST Site 6', 'SRID=4326;POINT(0.006 0.006)', true),
  ('TEST Site 7', 'SRID=4326;POINT(0.007 0.007)', true),
  ('TEST Site 8', 'SRID=4326;POINT(0.008 0.008)', true),
  ('TEST Site 9', 'SRID=4326;POINT(0.009 0.009)', true)
ON CONFLICT (name) DO NOTHING;
