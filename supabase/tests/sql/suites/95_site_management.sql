-- ADMIN SITE MANAGEMENT (migration 009): admin_create_site(),
-- admin_update_site(), the site name rules and the site_events audit trail.
-- "Inactive" means no new people: the site leaves public_site_options() and
-- invitations, but assigned collectors can still submit.
SET client_min_messages = notice;

DO $$ BEGIN
  PERFORM t.mkuser('admin', 'admin@example.test', true);
  PERFORM public.bootstrap_first_admin('admin@example.test');

  PERFORM t.mkuser('admin_off', 'adminoff@example.test', true);  -- inactive admin
  PERFORM t.set_profile(t.id('admin_off'), 'admin', false);
  PERFORM t.mkuser('c1', 'c1@example.test', true);               -- collector, site 1
  PERFORM t.set_profile(t.id('c1'), 'collector', true);
  PERFORM t.assign(t.id('c1'), t.site(1));
  PERFORM t.mkuser('m1', 'm1@example.test', true);               -- manager, site 1
  PERFORM t.set_profile(t.id('m1'), 'site_manager', true);
  PERFORM t.assign(t.id('m1'), t.site(1));
  PERFORM t.mkuser('r1', 'r1@example.test', true);               -- recycler
  PERFORM t.set_profile(t.id('r1'), 'recycler', true);
END $$;

-- Runs p_sql as p_role (and JWT subject p_user); returns 'ok' or the
-- SQLSTATE it failed with. A failure rolls back everything p_sql did.
CREATE FUNCTION t.state(p_role TEXT, p_user UUID, p_sql TEXT) RETURNS TEXT
LANGUAGE plpgsql AS $$
BEGIN
  BEGIN
    PERFORM t.become(p_role, p_user);
    EXECUTE p_sql;
    PERFORM t.become('postgres');
    RETURN 'ok';
  EXCEPTION WHEN OTHERS THEN
    RETURN SQLSTATE;
  END;
END $$;

CREATE FUNCTION t.create_as(p_user UUID, p_name TEXT) RETURNS UUID
LANGUAGE plpgsql AS $$
DECLARE v UUID;
BEGIN
  PERFORM t.as_user(p_user);
  v := public.admin_create_site(p_name);
  PERFORM t.become('postgres');
  RETURN v;
END $$;

CREATE FUNCTION t.update_as(p_user UUID, p_site UUID, p_name TEXT, p_active BOOLEAN) RETURNS UUID
LANGUAGE plpgsql AS $$
DECLARE v UUID;
BEGIN
  PERFORM t.as_user(p_user);
  v := public.admin_update_site(p_site, p_name, p_active);
  PERFORM t.become('postgres');
  RETURN v;
END $$;

CREATE FUNCTION t.site_row(p_id UUID) RETURNS public.sites
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog AS $$
  SELECT * FROM public.sites WHERE id = p_id
$$;

CREATE FUNCTION t.event_count() RETURNS BIGINT
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog AS $$
  SELECT count(*) FROM public.site_events
$$;

CREATE FUNCTION t.site_count() RETURNS BIGINT
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog AS $$
  SELECT count(*) FROM public.sites
$$;

-- 1: create, with the name normalised and one audit row
DO $$
DECLARE v UUID; s public.sites; e public.site_events;
BEGIN
  v := t.put('new', t.create_as(t.id('admin'), E'  Dandora \t  North\n '));
  s := t.site_row(v);
  ASSERT s.name = 'Dandora North', 'name: ' || s.name;
  ASSERT s.active AND s.location IS NULL, 'new site must be active with no location';

  SELECT * INTO STRICT e FROM public.site_events WHERE site_id = v;
  ASSERT e.action = 'created' AND e.actor_id = t.id('admin'), 'created event';
  ASSERT e.new_name = 'Dandora North' AND e.new_active, 'created event values';
  ASSERT e.old_name IS NULL AND e.old_active IS NULL, 'created event has no old values';

  ASSERT EXISTS (SELECT 1 FROM public.public_site_options() o WHERE o.id = v), 'new site offered to access requests';
  PERFORM t.pass('admin_create_site: active admin adds a site, name trimmed and spaces collapsed, location NULL, one created event');
END $$;

-- 2: everyone else is refused, and nothing is written
DO $$
DECLARE n_sites BIGINT := t.site_count(); n_events BIGINT := t.event_count();
BEGIN
  ASSERT t.state('authenticated', t.id('c1'), $q$SELECT public.admin_create_site('X1')$q$) = '42501', 'collector';
  ASSERT t.state('authenticated', t.id('m1'), $q$SELECT public.admin_create_site('X2')$q$) = '42501', 'manager';
  ASSERT t.state('authenticated', t.id('r1'), $q$SELECT public.admin_create_site('X3')$q$) = '42501', 'recycler';
  ASSERT t.state('authenticated', t.id('admin_off'), $q$SELECT public.admin_create_site('X4')$q$) = '42501', 'inactive admin';
  ASSERT t.state('authenticated', NULL, $q$SELECT public.admin_create_site('X5')$q$) = '42501', 'no user';
  ASSERT t.state('anon', NULL, $q$SELECT public.admin_create_site('X6')$q$) = '42501', 'anon (no EXECUTE)';
  ASSERT t.state('service_role', NULL, $q$SELECT public.admin_create_site('X7')$q$) = '42501', 'service_role (no EXECUTE)';

  ASSERT t.state('authenticated', t.id('c1'), format('SELECT public.admin_update_site(%L, %L, false)', t.site(1), 'FIXTURE Site 1')) = '42501', 'collector update';
  ASSERT t.state('authenticated', t.id('m1'), format('SELECT public.admin_update_site(%L, %L, false)', t.site(1), 'FIXTURE Site 1')) = '42501', 'manager update';
  ASSERT t.state('authenticated', t.id('admin_off'), format('SELECT public.admin_update_site(%L, %L, false)', t.site(1), 'FIXTURE Site 1')) = '42501', 'inactive admin update';
  ASSERT t.state('anon', NULL, format('SELECT public.admin_update_site(%L, %L, false)', t.site(1), 'FIXTURE Site 1')) = '42501', 'anon update';

  ASSERT t.site_count() = n_sites AND t.event_count() = n_events, 'a refused call wrote something';
  ASSERT (t.site_row(t.site(1))).active, 'site 1 changed';
  PERFORM t.pass('collectors, managers, recyclers, inactive admins, no user, anon and service_role cannot create or update sites');
END $$;

-- 3: name rules
DO $$
DECLARE n_sites BIGINT := t.site_count(); n_events BIGINT := t.event_count(); v UUID;
BEGIN
  ASSERT t.state('authenticated', t.id('admin'), $q$SELECT public.admin_create_site('')$q$) = '22023', 'empty';
  ASSERT t.state('authenticated', t.id('admin'), $q$SELECT public.admin_create_site(E' \t\n ')$q$) = '22023', 'blank';
  ASSERT t.state('authenticated', t.id('admin'), $q$SELECT public.admin_create_site(NULL)$q$) = '22023', 'NULL';
  ASSERT t.state('authenticated', t.id('admin'), format('SELECT public.admin_create_site(%L)', repeat('a', 81))) = '22023', '81 characters';
  ASSERT t.state('authenticated', t.id('admin'), format('SELECT public.admin_create_site(%L)', 'Bad' || chr(7) || 'Name')) = '22023', 'control character';
  ASSERT t.site_count() = n_sites AND t.event_count() = n_events, 'a bad name wrote something';

  v := t.create_as(t.id('admin'), repeat('b', 80));
  ASSERT char_length((t.site_row(v)).name) = 80, '80 characters accepted';
  v := t.create_as(t.id('admin'), 'Ng''ambo Ç');
  ASSERT (t.site_row(v)).name = 'Ng''ambo Ç', 'apostrophes and accents kept';
  PERFORM t.pass('names: empty, blank, NULL, over 80 characters and control characters refused (22023); 80 characters, apostrophes and accents accepted');
END $$;

-- 4: duplicates, ignoring case and spacing
DO $$
DECLARE n_events BIGINT := t.event_count();
BEGIN
  ASSERT t.state('authenticated', t.id('admin'), $q$SELECT public.admin_create_site('FIXTURE Site 1')$q$) = '23505', 'same name';
  ASSERT t.state('authenticated', t.id('admin'), $q$SELECT public.admin_create_site('fixture site 1')$q$) = '23505', 'other case';
  ASSERT t.state('authenticated', t.id('admin'), $q$SELECT public.admin_create_site('  FIXTURE   Site 1 ')$q$) = '23505', 'other spacing';
  ASSERT t.state('authenticated', t.id('admin'), format('SELECT public.admin_update_site(%L, %L, true)', t.site(2), 'Fixture Site 1')) = '23505', 'rename onto another site';
  ASSERT t.event_count() = n_events, 'a duplicate wrote an event';
  PERFORM t.pass('duplicates refused (23505) on create and rename, ignoring case and extra spaces');
END $$;

-- 5: rename, including a change of case on the site's own name
DO $$
DECLARE v UUID := t.id('new'); e public.site_events;
BEGIN
  PERFORM t.update_as(t.id('admin'), v, 'Dandora  Phase 2 ', true);
  ASSERT (t.site_row(v)).name = 'Dandora Phase 2', 'renamed';
  SELECT * INTO STRICT e FROM public.site_events WHERE site_id = v AND action = 'updated';
  ASSERT e.actor_id = t.id('admin') AND e.old_name = 'Dandora North' AND e.new_name = 'Dandora Phase 2'
     AND e.old_active AND e.new_active, 'rename event';

  PERFORM t.update_as(t.id('admin'), v, 'DANDORA PHASE 2', true);
  ASSERT (t.site_row(v)).name = 'DANDORA PHASE 2', 'own name in another case';
  ASSERT (SELECT count(*) FROM public.site_events WHERE site_id = v AND action = 'updated') = 2, 'one event per update';
  PERFORM t.pass('admin_update_site renames (normalised), allows a change of case on its own name, one updated event each with old and new values');
END $$;

-- 6: deactivate and reactivate
DO $$
DECLARE v UUID := t.id('new'); e public.site_events;
BEGIN
  PERFORM t.update_as(t.id('admin'), v, 'DANDORA PHASE 2', false);
  ASSERT NOT (t.site_row(v)).active, 'deactivated';
  ASSERT NOT EXISTS (SELECT 1 FROM public.public_site_options() o WHERE o.id = v), 'inactive site still offered';
  SELECT * INTO STRICT e FROM public.site_events WHERE site_id = v ORDER BY created_at DESC, id LIMIT 1;
  ASSERT e.old_active AND NOT e.new_active, 'deactivation event';

  PERFORM t.as_user(t.id('admin'));
  ASSERT EXISTS (SELECT 1 FROM public.sites WHERE id = v AND NOT active), 'admin still sees the inactive site';
  PERFORM t.become('postgres');

  PERFORM t.update_as(t.id('admin'), v, 'DANDORA PHASE 2', true);
  ASSERT (t.site_row(v)).active, 'reactivated';
  ASSERT EXISTS (SELECT 1 FROM public.public_site_options() o WHERE o.id = v), 'reactivated site offered again';
  PERFORM t.pass('deactivate removes the site from public_site_options (admins still see it); reactivate brings it back; both audited');
END $$;

-- 7: inactive means "no new people" only (decision 16 Nov 2026)
DO $$
DECLARE v_rec UUID := gen_random_uuid();
BEGIN
  PERFORM t.update_as(t.id('admin'), t.site(1), 'FIXTURE Site 1', false);

  PERFORM t.as_user(t.id('c1'));
  INSERT INTO public.collection_logs (client_record_id, site_id, material_code, reported_weight_kg)
  VALUES (v_rec, t.site(1), 'PET', 2);
  PERFORM t.become('postgres');
  ASSERT EXISTS (SELECT 1 FROM public.collection_logs WHERE client_record_id = v_rec), 'collector could not submit';

  -- A new invitation to the inactive site is refused (as the Edge Function
  -- would call it)...
  PERFORM t.mkuser('newp', 'new@example.test');
  PERFORM t.become('service_role');
  BEGIN
    PERFORM public.register_invitation(t.id('newp'), 'new@example.test', 'New Person',
      'collector', ARRAY[t.site(1)], t.id('admin'), t.h('site-test'));
    RAISE EXCEPTION 'an invitation to an inactive site was accepted';
  EXCEPTION WHEN raise_exception THEN
    ASSERT SQLERRM LIKE 'One or more selected sites are invalid or inactive%', SQLERRM;
  END;
  PERFORM t.become('postgres');

  -- ...and the same invitation succeeds once the site is active again, so the
  -- refusal above was about the site.
  PERFORM t.update_as(t.id('admin'), t.site(1), 'FIXTURE Site 1', true);
  PERFORM t.become('service_role');
  PERFORM public.register_invitation(t.id('newp'), 'new@example.test', 'New Person',
    'collector', ARRAY[t.site(1)], t.id('admin'), t.h('site-test'));
  PERFORM t.become('postgres');
  PERFORM t.pass('an assigned collector can still submit at an inactive site; a new invitation to it is refused until it is reactivated');
END $$;

-- 8: other update refusals write nothing
DO $$
DECLARE n_events BIGINT := t.event_count();
BEGIN
  ASSERT t.state('authenticated', t.id('admin'), format('SELECT public.admin_update_site(%L, %L, true)', gen_random_uuid(), 'Anything')) = 'P0002', 'unknown site';
  ASSERT t.state('authenticated', t.id('admin'), format('SELECT public.admin_update_site(%L, %L, NULL)', t.site(2), 'FIXTURE Site 2')) = '22023', 'NULL active';
  ASSERT t.state('authenticated', t.id('admin'), format('SELECT public.admin_update_site(%L, %L, true)', t.site(2), ' FIXTURE  Site 2 ')) = '22023', 'nothing to change';
  ASSERT t.state('authenticated', t.id('admin'), format('SELECT public.admin_update_site(%L, %L, true)', t.site(2), '')) = '22023', 'empty name';
  ASSERT t.event_count() = n_events, 'a refused update wrote an event';
  PERFORM t.pass('admin_update_site refuses an unknown site (P0002), a NULL active flag, no change and a bad name (22023), writing nothing');
END $$;

-- 9: no direct writes; only active admins read the audit trail
DO $$
DECLARE n BIGINT;
BEGIN
  ASSERT t.state('authenticated', t.id('admin'), $q$INSERT INTO public.sites (name) VALUES ('Direct')$q$) = '42501', 'admin INSERT sites';
  ASSERT t.state('authenticated', t.id('admin'), format('UPDATE public.sites SET active = false WHERE id = %L', t.site(3))) = '42501', 'admin UPDATE sites';
  ASSERT t.state('authenticated', t.id('admin'), format('DELETE FROM public.sites WHERE id = %L', t.site(3))) = '42501', 'admin DELETE sites';
  ASSERT t.state('authenticated', t.id('admin'), format(
    'INSERT INTO public.site_events (site_id, actor_id, action, new_name, new_active) VALUES (%L, %L, %L, %L, true)',
    t.site(3), t.id('admin'), 'created', 'Fake')) = '42501', 'admin INSERT site_events';
  ASSERT t.state('authenticated', t.id('admin'), 'DELETE FROM public.site_events') = '42501', 'admin DELETE site_events';
  ASSERT t.state('service_role', NULL, 'SELECT 1 FROM public.site_events') = '42501', 'service_role SELECT site_events';
  ASSERT t.state('anon', NULL, 'SELECT 1 FROM public.site_events') = '42501', 'anon SELECT site_events';

  PERFORM t.as_user(t.id('admin'));
  SELECT count(*) INTO n FROM public.site_events;
  PERFORM t.become('postgres');
  ASSERT n = t.event_count() AND n > 0, 'admin sees ' || n || ' of ' || t.event_count();

  PERFORM t.as_user(t.id('c1'));
  SELECT count(*) INTO n FROM public.site_events;
  PERFORM t.become('postgres');
  ASSERT n = 0, 'collector saw site events';
  PERFORM t.as_user(t.id('admin_off'));
  SELECT count(*) INTO n FROM public.site_events;
  PERFORM t.become('postgres');
  ASSERT n = 0, 'inactive admin saw site events';
  PERFORM t.pass('no direct INSERT/UPDATE/DELETE on sites or site_events; only active admins read site_events');
END $$;

-- 10: the constraint and index guard writes that bypass the functions
DO $$
BEGIN
  ASSERT t.state('postgres', NULL, $q$INSERT INTO public.sites (name) VALUES (' Padded')$q$) = '23514', 'padded name';
  ASSERT t.state('postgres', NULL, $q$INSERT INTO public.sites (name) VALUES ('Two  spaces')$q$) = '23514', 'double space';
  ASSERT t.state('postgres', NULL, $q$INSERT INTO public.sites (name) VALUES ('')$q$) = '23514', 'empty';
  ASSERT t.state('postgres', NULL, $q$INSERT INTO public.sites (name) VALUES ('FIXTURE SITE 4')$q$) = '23505', 'case duplicate';
  ASSERT t.state('postgres', NULL, format(
    'INSERT INTO public.site_events (site_id, actor_id, action, old_name, new_name, new_active) VALUES (%L, %L, %L, %L, %L, true)',
    t.site(3), t.id('admin'), 'created', 'Old', 'New')) = '23514', 'created event with an old value';
  PERFORM t.pass('owner writes are still held to the name format (23514), case-insensitive uniqueness (23505) and event shape (23514)');
END $$;
