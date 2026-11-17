-- ADMIN MATERIAL MANAGEMENT (migration 010): admin_create_material(),
-- admin_update_material(), admin_move_material(), admin_delete_material(),
-- the name and Mixed rules, the "at least one reportable / verifiable"
-- guards and the material_events audit trail.
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

-- Runs p_sql as p_role (JWT subject p_user); returns 'ok', or the SQLSTATE
-- and message it failed with. A failure rolls back everything p_sql did.
CREATE FUNCTION t.run(p_role TEXT, p_user UUID, p_sql TEXT) RETURNS TEXT
LANGUAGE plpgsql AS $$
BEGIN
  BEGIN
    PERFORM t.become(p_role, p_user);
    EXECUTE p_sql;
    PERFORM t.become('postgres');
    RETURN 'ok';
  EXCEPTION WHEN OTHERS THEN
    RETURN SQLSTATE || ' ' || SQLERRM;
  END;
END $$;

CREATE FUNCTION t.as_admin(p_sql TEXT) RETURNS TEXT
LANGUAGE sql AS $$ SELECT t.run('authenticated', t.id('admin'), p_sql) $$;

CREATE FUNCTION t.mat(p_code TEXT) RETURNS public.materials
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog AS $$
  SELECT * FROM public.materials WHERE code = p_code
$$;

CREATE FUNCTION t.mat_events() RETURNS BIGINT
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog AS $$
  SELECT count(*) FROM public.material_events
$$;

CREATE FUNCTION t.mat_count() RETURNS BIGINT
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog AS $$
  SELECT count(*) FROM public.materials
$$;

-- admin_update_material as admin, changing only is_active.
CREATE FUNCTION t.set_active(p_code TEXT, p_active BOOLEAN) RETURNS TEXT
LANGUAGE plpgsql AS $$
DECLARE m public.materials := t.mat(p_code);
BEGIN
  RETURN t.as_admin(format('SELECT public.admin_update_material(%L, %L, %L, %L, %L, %L)',
    m.code, m.display_name, m.is_reportable, m.is_verifiable, m.is_recycler_visible, p_active));
END $$;

CREATE FUNCTION t.submit(p_user UUID, p_material TEXT) RETURNS UUID
LANGUAGE plpgsql AS $$
DECLARE v_rec UUID := gen_random_uuid(); v_id UUID;
BEGIN
  PERFORM t.as_user(p_user);
  INSERT INTO public.collection_logs (client_record_id, site_id, material_code, reported_weight_kg)
  VALUES (v_rec, t.site(1), p_material, 5);
  PERFORM t.become('postgres');
  SELECT id INTO STRICT v_id FROM public.collection_logs WHERE client_record_id = v_rec;
  RETURN v_id;
END $$;

CREATE FUNCTION t.add_evidence(p_id UUID) RETURNS VOID
LANGUAGE sql SECURITY DEFINER SET search_path = pg_catalog AS $$
  INSERT INTO public.collection_evidence (collection_id, storage_path, content_type)
  VALUES (p_id, 'test/' || p_id || '/' || gen_random_uuid() || '.jpg', 'image/jpeg')
$$;

-- Material codes in recycler_material_totals(), as recycler r1.
CREATE FUNCTION t.recycler_codes() RETURNS TEXT
LANGUAGE plpgsql AS $$
DECLARE v TEXT;
BEGIN
  PERFORM t.as_user(t.id('r1'));
  SELECT string_agg(r.material_code, ',') INTO v FROM public.recycler_material_totals(NULL, NULL, NULL) AS r;
  PERFORM t.become('postgres');
  RETURN COALESCE(v, '');
END $$;

-- 1: add, with the name normalised, a code made from it, last in the order
DO $$
DECLARE v TEXT; m public.materials; e public.material_events; n BIGINT;
BEGIN
  PERFORM t.as_user(t.id('admin'));
  v := public.admin_create_material(E'  Polystyrene \t (PS) ', true, true, true);
  PERFORM t.become('postgres');
  ASSERT v = 'POLYSTYRENE_PS', 'code: ' || v;
  m := t.mat(v);
  ASSERT m.display_name = 'Polystyrene (PS)', 'name: ' || m.display_name;
  ASSERT m.is_reportable AND m.is_verifiable AND m.is_recycler_visible AND m.is_active, 'flags';
  ASSERT m.sort_order = 70, 'sort_order ' || m.sort_order;

  SELECT * INTO STRICT e FROM public.material_events WHERE material_code = v;
  ASSERT e.action = 'created' AND e.actor_id = t.id('admin') AND e.old_values IS NULL, 'created event';
  ASSERT e.new_values ->> 'display_name' = 'Polystyrene (PS)' AND NOT (e.new_values ? 'code'), 'created values';

  PERFORM t.as_user(t.id('admin'));
  v := public.admin_create_material('3D film', false, true, false);
  PERFORM t.become('postgres');
  ASSERT v = 'M_3D_FILM', 'code for a name starting with a digit: ' || v;

  PERFORM t.as_user(t.id('c1'));
  SELECT count(*) INTO n FROM public.materials WHERE code = 'POLYSTYRENE_PS' AND is_active AND is_reportable;
  PERFORM t.become('postgres');
  ASSERT n = 1, 'collectors do not see the new reportable material';
  PERFORM t.pass('admin_create_material: name normalised, code from the name (M_ prefix for a digit), last in order, active, one created event; collectors see it');
END $$;

-- 2: everyone else is refused, and nothing is written
DO $$
DECLARE n_m BIGINT := t.mat_count(); n_e BIGINT := t.mat_events(); u TEXT; q TEXT;
BEGIN
  FOREACH q IN ARRAY ARRAY[
    $q$SELECT public.admin_create_material('Nope', true, true, true)$q$,
    $q$SELECT public.admin_update_material('PET', 'PET', true, true, true, false)$q$,
    $q$SELECT public.admin_move_material('PET', 'down')$q$,
    $q$SELECT public.admin_delete_material('M_3D_FILM')$q$
  ] LOOP
    FOREACH u IN ARRAY ARRAY['c1', 'm1', 'r1', 'admin_off'] LOOP
      ASSERT t.run('authenticated', t.id(u), q) LIKE '42501%', u || ': ' || q;
    END LOOP;
    ASSERT t.run('authenticated', NULL, q) LIKE '42501%', 'no user: ' || q;
    ASSERT t.run('anon', NULL, q) LIKE '42501%', 'anon: ' || q;
    ASSERT t.run('service_role', NULL, q) LIKE '42501%', 'service_role: ' || q;
  END LOOP;
  ASSERT t.mat_count() = n_m AND t.mat_events() = n_e, 'a refused call wrote something';
  ASSERT (t.mat('PET')).is_active AND (t.mat('PET')).sort_order = 10, 'PET changed';
  PERFORM t.pass('collectors, managers, recyclers, inactive admins, no user, anon and service_role cannot add, edit, move or delete materials');
END $$;

-- 3: name and flag rules when adding
DO $$
DECLARE n_m BIGINT := t.mat_count(); n_e BIGINT := t.mat_events(); v TEXT;
BEGIN
  ASSERT t.as_admin($q$SELECT public.admin_create_material('', true, true, true)$q$) LIKE '22023%', 'empty';
  ASSERT t.as_admin($q$SELECT public.admin_create_material(E' \t ', true, true, true)$q$) LIKE '22023%', 'blank';
  ASSERT t.as_admin($q$SELECT public.admin_create_material(NULL, true, true, true)$q$) LIKE '22023%', 'NULL name';
  ASSERT t.as_admin(format('SELECT public.admin_create_material(%L, true, true, true)', repeat('a', 61))) LIKE '22023%', '61 characters';
  ASSERT t.as_admin(format('SELECT public.admin_create_material(%L, true, true, true)', 'Bad' || chr(7))) LIKE '22023%', 'control character';
  ASSERT t.as_admin($q$SELECT public.admin_create_material('Flagless', NULL, true, true)$q$) LIKE '22023%', 'NULL flag';
  ASSERT t.as_admin($q$SELECT public.admin_create_material('Odd', true, false, true)$q$) LIKE '22023%Recyclers only see verified%', 'recycler-visible, not verifiable';
  ASSERT t.as_admin($q$SELECT public.admin_create_material('Useless', false, false, false)$q$) LIKE '22023%reportable by collectors or verifiable%', 'neither';
  ASSERT t.mat_count() = n_m AND t.mat_events() = n_e, 'a bad material was written';

  PERFORM t.as_user(t.id('admin'));
  v := public.admin_create_material(repeat('b', 60), true, false, false);
  PERFORM t.become('postgres');
  ASSERT char_length((t.mat(v)).display_name) = 60 AND char_length(v) <= 32, '60 characters accepted, code cut to 32';
  PERFORM t.pass('adding: empty, blank, NULL, over 60 characters, control characters, NULL flags, recycler-only and no-role materials refused (22023); 60 characters accepted');
END $$;

-- 4: duplicates, by name (ignoring case and spacing) or by the code made from it
DO $$
DECLARE n_e BIGINT := t.mat_events();
BEGIN
  ASSERT t.as_admin($q$SELECT public.admin_create_material('pet', true, true, true)$q$) LIKE '23505%', 'same name, other case';
  ASSERT t.as_admin($q$SELECT public.admin_create_material('  Plastic   BAGS ', true, true, true)$q$) LIKE '23505%', 'other spacing';
  ASSERT t.as_admin($q$SELECT public.admin_create_material('Plastic-bags', true, true, true)$q$) LIKE '23505%code PLASTIC_BAGS%', 'same code from a different name';
  ASSERT t.mat_events() = n_e, 'a duplicate wrote an event';
  PERFORM t.pass('duplicates refused (23505): same name ignoring case and spaces, or a name that makes an existing code');
END $$;

-- 5: edit, and the edit rules
DO $$
DECLARE n_e BIGINT; e public.material_events;
BEGIN
  ASSERT t.as_admin($q$SELECT public.admin_update_material('POLYSTYRENE_PS', ' Polystyrene ', false, true, true, true)$q$) = 'ok', 'edit';
  ASSERT (t.mat('POLYSTYRENE_PS')).display_name = 'Polystyrene' AND NOT (t.mat('POLYSTYRENE_PS')).is_reportable, 'edited';
  SELECT * INTO STRICT e FROM public.material_events WHERE material_code = 'POLYSTYRENE_PS' AND action = 'updated';
  ASSERT e.actor_id = t.id('admin')
     AND e.old_values ->> 'display_name' = 'Polystyrene (PS)' AND (e.old_values ->> 'is_reportable')::boolean
     AND e.new_values ->> 'display_name' = 'Polystyrene' AND NOT (e.new_values ->> 'is_reportable')::boolean, 'updated event';
  ASSERT t.as_admin($q$SELECT public.admin_update_material('POLYSTYRENE_PS', 'POLYSTYRENE', false, true, true, true)$q$) = 'ok', 'own name in another case';

  n_e := t.mat_events();
  ASSERT t.as_admin($q$SELECT public.admin_update_material('POLYSTYRENE_PS', ' POLYSTYRENE ', false, true, true, true)$q$) LIKE '22023%Nothing to change%', 'nothing to change';
  ASSERT t.as_admin($q$SELECT public.admin_update_material('NOPE', 'Nope', true, true, true, true)$q$) LIKE 'P0002%', 'unknown';
  ASSERT t.as_admin($q$SELECT public.admin_update_material('MIXED', 'Mixed', true, true, false, true)$q$) LIKE '22023%Mixed can be reported but never%', 'Mixed verifiable';
  ASSERT t.as_admin($q$SELECT public.admin_update_material('PET', 'PET', true, false, true, true)$q$) LIKE '22023%Recyclers only see verified%', 'recycler-visible, not verifiable';
  ASSERT t.as_admin($q$SELECT public.admin_update_material('PET', 'PET', false, false, false, true)$q$) LIKE '22023%', 'no role';
  ASSERT t.as_admin($q$SELECT public.admin_update_material('PET', 'PET', true, true, true, NULL)$q$) LIKE '22023%', 'NULL active';
  ASSERT t.as_admin($q$SELECT public.admin_update_material('PET', 'hdpe', true, true, true, true)$q$) LIKE '23505%', 'another material''s name';
  ASSERT t.mat_events() = n_e, 'a refused edit wrote an event';
  ASSERT (t.mat('MIXED')).is_reportable AND NOT (t.mat('MIXED')).is_verifiable, 'Mixed changed';
  PERFORM t.pass('admin_update_material edits name and flags (one updated event, old and new values); refuses no change, unknown codes, a verifiable Mixed, bad flags and duplicate names');
END $$;

-- 6: what deactivating means
DO $$
DECLARE v_id UUID;
BEGIN
  ASSERT position('PP' IN t.recycler_codes()) > 0, 'PP missing from recycler totals before';
  ASSERT t.set_active('PP', false) = 'ok', 'deactivate PP';

  -- Collectors can no longer report it...
  BEGIN
    PERFORM t.submit(t.id('c1'), 'PP');
    RAISE EXCEPTION 'an inactive material was reported';
  EXCEPTION WHEN check_violation THEN
    ASSERT SQLERRM = 'Material PP cannot be reported', SQLERRM;
  END;

  -- ...managers can no longer verify it...
  v_id := t.submit(t.id('c1'), 'PET');
  PERFORM t.add_evidence(v_id);
  ASSERT t.run('authenticated', t.id('m1'), format(
    'SELECT public.review_collection(%L, true, %L::jsonb, NULL)', v_id,
    '[{"material_code":"PP","weight_kg":1}]')) LIKE '%PP cannot be used in a verified breakdown%', 'PP verified while inactive';
  ASSERT t.run('authenticated', t.id('m1'), format(
    'SELECT public.review_collection(%L, true, %L::jsonb, NULL)', v_id,
    '[{"material_code":"PET","weight_kg":4}]')) = 'ok', 'approve with PET';

  -- ...and recyclers' totals leave it out until it is reactivated.
  ASSERT position(',PP,' IN ',' || t.recycler_codes() || ',') = 0, 'inactive PP in recycler totals';
  ASSERT t.set_active('PP', true) = 'ok', 'reactivate PP';
  ASSERT position(',PP,' IN ',' || t.recycler_codes() || ',') > 0, 'reactivated PP missing from recycler totals';
  PERFORM t.pass('an inactive material cannot be reported or verified and leaves recycler totals; reactivating brings it back');
END $$;

-- 7: at least one active reportable and one active verifiable material
DO $$
DECLARE codes TEXT[]; c TEXT; i INT; r TEXT;
BEGIN
  -- Verifiable: deactivate all but the last; the last is refused.
  SELECT array_agg(code ORDER BY sort_order, code) INTO codes FROM public.materials WHERE is_active AND is_verifiable;
  FOR i IN 1 .. array_length(codes, 1) - 1 LOOP
    ASSERT t.set_active(codes[i], false) = 'ok', 'deactivate ' || codes[i];
  END LOOP;
  c := codes[array_length(codes, 1)];
  r := t.set_active(c, false);
  ASSERT r LIKE '22023%stay verifiable by managers%', 'last verifiable: ' || r;
  ASSERT (t.mat(c)).is_active, 'the last verifiable material was deactivated';
  ASSERT t.as_admin(format('SELECT public.admin_update_material(%L, %L, true, false, false, true)', c, (t.mat(c)).display_name))
         LIKE '22023%stay verifiable by managers%', 'last verifiable made unverifiable';
  FOR i IN 1 .. array_length(codes, 1) - 1 LOOP
    ASSERT t.set_active(codes[i], true) = 'ok', 'reactivate ' || codes[i];
  END LOOP;

  -- Reportable: the same.
  SELECT array_agg(code ORDER BY sort_order, code) INTO codes FROM public.materials WHERE is_active AND is_reportable;
  FOR i IN 1 .. array_length(codes, 1) - 1 LOOP
    ASSERT t.set_active(codes[i], false) = 'ok', 'deactivate ' || codes[i];
  END LOOP;
  c := codes[array_length(codes, 1)];
  r := t.set_active(c, false);
  ASSERT r LIKE '22023%stay reportable by collectors%', 'last reportable: ' || r;
  ASSERT (t.mat(c)).is_active, 'the last reportable material was deactivated';
  FOR i IN 1 .. array_length(codes, 1) - 1 LOOP
    ASSERT t.set_active(codes[i], true) = 'ok', 'reactivate ' || codes[i];
  END LOOP;
  PERFORM t.pass('the last active verifiable and the last active reportable material cannot be deactivated or lose that role (22023)');
END $$;

-- 8: move up and down
DO $$
DECLARE a INT := (t.mat('POLYSTYRENE_PS')).sort_order; b INT := (t.mat('M_3D_FILM')).sort_order; n_e BIGINT := t.mat_events();
BEGIN
  ASSERT a < b, 'fixture order';
  ASSERT t.as_admin($q$SELECT public.admin_move_material('M_3D_FILM', 'up')$q$) = 'ok', 'move up';
  ASSERT (t.mat('M_3D_FILM')).sort_order = a AND (t.mat('POLYSTYRENE_PS')).sort_order = b, 'not swapped';
  ASSERT t.mat_events() = n_e + 2, 'expected two moved events';
  ASSERT (SELECT count(*) FROM public.material_events WHERE action = 'moved'
          AND material_code IN ('M_3D_FILM', 'POLYSTYRENE_PS')) = 2, 'moved events';
  ASSERT t.as_admin($q$SELECT public.admin_move_material('M_3D_FILM', 'down')$q$) = 'ok', 'move back down';
  ASSERT (t.mat('M_3D_FILM')).sort_order = b, 'not moved back';

  n_e := t.mat_events();
  ASSERT t.as_admin($q$SELECT public.admin_move_material('PET', 'up')$q$) LIKE '22023%already first%', 'first up';
  ASSERT t.as_admin(format('SELECT public.admin_move_material(%L, %L)',
           (SELECT code FROM public.materials ORDER BY sort_order DESC, code DESC LIMIT 1), 'down')) LIKE '22023%already last%', 'last down';
  ASSERT t.as_admin($q$SELECT public.admin_move_material('PET', 'sideways')$q$) LIKE '22023%', 'bad direction';
  ASSERT t.as_admin($q$SELECT public.admin_move_material('NOPE', 'up')$q$) LIKE 'P0002%', 'unknown';
  ASSERT t.mat_events() = n_e, 'a refused move wrote an event';
  PERFORM t.pass('admin_move_material swaps places with the neighbour (two moved events); first-up, last-down, bad directions and unknown codes refused');
END $$;

-- 9: delete only unused materials, never Mixed
DO $$
DECLARE e public.material_events; n_e BIGINT;
BEGIN
  ASSERT t.as_admin($q$SELECT public.admin_delete_material('M_3D_FILM')$q$) = 'ok', 'delete unused';
  ASSERT (t.mat('M_3D_FILM')).code IS NULL, 'still there';
  SELECT * INTO STRICT e FROM public.material_events WHERE material_code = 'M_3D_FILM' AND action = 'deleted';
  ASSERT e.actor_id = t.id('admin') AND e.new_values IS NULL AND e.old_values ->> 'display_name' = '3D film', 'deleted event';
  ASSERT (SELECT count(*) FROM public.material_events WHERE material_code = 'M_3D_FILM') >= 2, 'history of a deleted material lost';

  n_e := t.mat_events();
  ASSERT t.as_admin($q$SELECT public.admin_delete_material('PET')$q$) LIKE '23503%deactivate it instead%', 'used (delivery and verified line)';
  ASSERT t.as_admin($q$SELECT public.admin_delete_material('MIXED')$q$) LIKE '22023%Mixed cannot be deleted%', 'Mixed';
  ASSERT t.as_admin($q$SELECT public.admin_delete_material('NOPE')$q$) LIKE 'P0002%', 'unknown';
  ASSERT (t.mat('PET')).code = 'PET' AND (t.mat('MIXED')).code = 'MIXED', 'deleted anyway';
  ASSERT t.mat_events() = n_e, 'a refused delete wrote an event';
  PERFORM t.pass('admin_delete_material deletes an unused material (deleted event, history kept); a used material (23503), Mixed and unknown codes are refused');
END $$;

-- 10: no direct writes; only active admins read the audit trail
DO $$
DECLARE n BIGINT;
BEGIN
  ASSERT t.as_admin($q$INSERT INTO public.material_events (material_code, actor_id, action, new_values) VALUES ('X', auth.uid(), 'created', '{}')$q$) LIKE '42501%', 'admin INSERT';
  ASSERT t.as_admin('DELETE FROM public.material_events') LIKE '42501%', 'admin DELETE';
  ASSERT t.as_admin($q$UPDATE public.materials SET is_active = false WHERE code = 'PET'$q$) LIKE '42501%', 'admin UPDATE materials';
  ASSERT t.run('service_role', NULL, 'SELECT 1 FROM public.material_events') LIKE '42501%', 'service_role SELECT';
  ASSERT t.run('anon', NULL, 'SELECT 1 FROM public.material_events') LIKE '42501%', 'anon SELECT';

  PERFORM t.as_user(t.id('admin'));
  SELECT count(*) INTO n FROM public.material_events;
  PERFORM t.become('postgres');
  ASSERT n = t.mat_events() AND n > 0, 'admin sees ' || n || ' of ' || t.mat_events();
  PERFORM t.as_user(t.id('c1'));
  SELECT count(*) INTO n FROM public.material_events;
  PERFORM t.become('postgres');
  ASSERT n = 0, 'collector saw material events';
  PERFORM t.as_user(t.id('admin_off'));
  SELECT count(*) INTO n FROM public.material_events;
  PERFORM t.become('postgres');
  ASSERT n = 0, 'inactive admin saw material events';
  PERFORM t.pass('no direct writes to materials or material_events; only active admins read material_events');
END $$;

-- 11: the constraints and index guard writes that bypass the functions
DO $$
BEGIN
  ASSERT t.run('postgres', NULL, $q$INSERT INTO public.materials (code, display_name) VALUES ('ZZ_A', ' Padded')$q$) LIKE '23514%', 'padded name';
  ASSERT t.run('postgres', NULL, $q$INSERT INTO public.materials (code, display_name) VALUES ('ZZ_B', 'Two  spaces')$q$) LIKE '23514%', 'double space';
  ASSERT t.run('postgres', NULL, $q$INSERT INTO public.materials (code, display_name) VALUES ('ZZ_C', 'pet')$q$) LIKE '23505%', 'case duplicate';
  ASSERT t.run('postgres', NULL, $q$UPDATE public.materials SET is_verifiable = true WHERE code = 'MIXED'$q$) LIKE '23514%', 'verifiable Mixed';
  ASSERT t.run('postgres', NULL, $q$INSERT INTO public.material_events (material_code, actor_id, action, old_values, new_values)
           VALUES ('X', (SELECT id FROM public.profiles LIMIT 1), 'created', '{}', '{}')$q$) LIKE '23514%', 'created event with old values';
  ASSERT t.run('postgres', NULL, $q$INSERT INTO public.material_events (material_code, actor_id, action, old_values, new_values)
           VALUES ('X', (SELECT id FROM public.profiles LIMIT 1), 'deleted', '{}', '{}')$q$) LIKE '23514%', 'deleted event with new values';
  PERFORM t.pass('owner writes are still held to the name format, Mixed rule and event shape (23514) and case-insensitive name uniqueness (23505)');
END $$;
