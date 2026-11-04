-- ACCESS REQUESTS: public submission, column grants, validation, admin
-- review permissions and the reviewer trigger (migration 003).
SET client_min_messages = notice;

DO $$ BEGIN
  PERFORM t.mkuser('admin', 'admin@example.test', true);
  PERFORM public.bootstrap_first_admin('admin@example.test');
  PERFORM t.mkuser('admin_off', 'admin-off@example.test', true);
  PERFORM t.set_profile(t.id('admin_off'), 'admin', false);
  PERFORM t.mkuser('collector', 'collector@example.test', true);
  PERFORM t.set_profile(t.id('collector'), 'collector', true);
END $$;

-- 1
DO $$
DECLARE r public.access_requests;
BEGIN
  PERFORM t.become('anon');
  INSERT INTO public.access_requests
    (full_name, email, phone, role, site_name, referral_source)
  VALUES ('Jane Wanjiru', 'jane@example.test', '+254 712 345-678',
          'site_manager', 'Site A', 'A friend');
  PERFORM t.become('postgres');
  SELECT * INTO STRICT r FROM public.access_requests WHERE email = 'jane@example.test';
  ASSERT r.status = 'submitted', 'status';
  ASSERT r.reviewed_by IS NULL AND r.reviewed_at IS NULL AND r.notes IS NULL;
  ASSERT r.created_at IS NOT NULL AND r.id IS NOT NULL;
  ASSERT r.role = 'site_manager';
  PERFORM t.pass('anon can submit with the six allowed columns; status defaults to submitted');
END $$;

-- 2
DO $$
DECLARE c TEXT; v TEXT;
BEGIN
  FOREACH c IN ARRAY ARRAY['status', 'notes', 'reviewed_by', 'reviewed_at', 'id', 'created_at'] LOOP
    v := CASE c
      WHEN 'status' THEN '''approved'''
      WHEN 'notes' THEN '''x'''
      WHEN 'reviewed_by' THEN quote_literal(t.id('admin'))
      WHEN 'id' THEN 'gen_random_uuid()'
      ELSE 'now()' END;
    BEGIN
      PERFORM t.become('anon');
      EXECUTE format(
        'INSERT INTO public.access_requests (full_name, email, %I) VALUES (''X Y'', ''xy@example.test'', %s)',
        c, v);
      RAISE EXCEPTION 'anon could set %', c;
    EXCEPTION WHEN insufficient_privilege THEN NULL;
    END;
  END LOOP;
  PERFORM t.pass('anon cannot supply status, notes, reviewed_by, reviewed_at, id or created_at');
END $$;

-- 3
DO $$
BEGIN
  BEGIN
    PERFORM t.become('anon');
    INSERT INTO public.access_requests (full_name, email, role)
    VALUES ('Eve Admin', 'eve@example.test', 'admin');
    RAISE EXCEPTION 'admin role accepted';
  EXCEPTION WHEN insufficient_privilege OR check_violation THEN NULL;
  END;
  BEGIN
    PERFORM t.become('authenticated', t.id('collector'));
    INSERT INTO public.access_requests (full_name, email, role)
    VALUES ('Eve Admin', 'eve@example.test', 'admin');
    RAISE EXCEPTION 'admin role accepted from authenticated';
  EXCEPTION WHEN insufficient_privilege OR check_violation THEN NULL;
  END;
  ASSERT NOT EXISTS (SELECT 1 FROM public.access_requests WHERE email = 'eve@example.test');
  PERFORM t.pass('a public request can never ask for the admin role');
END $$;

-- 4
DO $$
DECLARE
  ok_phones TEXT[] := ARRAY['+254712345678', '254712345678', '0712345678',
                            '+254 712 345 678', '(0712) 345-678'];
  bad_phones TEXT[] := ARRAY['abc', '12345', '+2547123456789012345', '0712-345-678x'];
  bad_emails TEXT[] := ARRAY['no-at-sign', 'a@b', 'a b@example.test', 'a@@example.test'];
  x TEXT; n INTEGER := 0;
BEGIN
  FOREACH x IN ARRAY ok_phones LOOP
    PERFORM t.become('anon');
    INSERT INTO public.access_requests (full_name, phone) VALUES ('Phone Ok', x);
    n := n + 1;
  END LOOP;
  FOREACH x IN ARRAY bad_phones LOOP
    BEGIN
      PERFORM t.become('anon');
      INSERT INTO public.access_requests (full_name, phone) VALUES ('Phone Bad', x);
      RAISE EXCEPTION 'bad phone accepted: %', x;
    EXCEPTION WHEN check_violation THEN NULL;
    END;
  END LOOP;
  FOREACH x IN ARRAY bad_emails LOOP
    BEGIN
      PERFORM t.become('anon');
      INSERT INTO public.access_requests (full_name, email) VALUES ('Email Bad', x);
      RAISE EXCEPTION 'bad email accepted: %', x;
    EXCEPTION WHEN check_violation THEN NULL;
    END;
  END LOOP;
  BEGIN
    PERFORM t.become('anon');
    INSERT INTO public.access_requests (full_name) VALUES ('No Contact');
    RAISE EXCEPTION 'no contact accepted';
  EXCEPTION WHEN check_violation THEN NULL;
  END;
  BEGIN
    PERFORM t.become('anon');
    INSERT INTO public.access_requests (full_name, phone, email) VALUES ('Blank Contact', '  ', NULL);
    RAISE EXCEPTION 'blank contact accepted';
  EXCEPTION WHEN check_violation THEN NULL;
  END;
  BEGIN
    PERFORM t.become('anon');
    INSERT INTO public.access_requests (full_name, email) VALUES ('A', 'short@example.test');
    RAISE EXCEPTION 'one-letter name accepted';
  EXCEPTION WHEN check_violation THEN NULL;
  END;
  PERFORM t.become('postgres');
  ASSERT (SELECT count(*) FROM public.access_requests WHERE full_name = 'Phone Ok') = n;
  ASSERT NOT EXISTS (SELECT 1 FROM public.access_requests
                     WHERE full_name IN ('Phone Bad', 'Email Bad', 'No Contact', 'Blank Contact', 'A'));
  PERFORM t.pass('validation: Kenyan phone formats accepted; bad phone/email, missing contact and short name rejected');
END $$;

-- 5
DO $$
DECLARE n BIGINT; v_total BIGINT;
BEGIN
  SELECT count(*) INTO v_total FROM public.access_requests;
  ASSERT v_total > 0;
  BEGIN
    PERFORM t.become('anon');
    PERFORM 1 FROM public.access_requests;
    RAISE EXCEPTION 'anon could read';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;
  PERFORM t.become('authenticated', t.id('collector'));
  SELECT count(*) INTO n FROM public.access_requests;
  ASSERT n = 0, 'non-admin saw ' || n;
  PERFORM t.become('authenticated', t.id('admin_off'));
  SELECT count(*) INTO n FROM public.access_requests;
  ASSERT n = 0, 'inactive admin saw ' || n;
  PERFORM t.become('authenticated', NULL);
  SELECT count(*) INTO n FROM public.access_requests;
  ASSERT n = 0, 'no-JWT authenticated saw ' || n;
  PERFORM t.become('authenticated', t.id('admin'));
  SELECT count(*) INTO n FROM public.access_requests;
  ASSERT n = v_total, 'admin saw ' || n || ' of ' || v_total;
  PERFORM t.pass('reads: anon denied; non-admin, inactive admin and no-JWT see 0 rows; active admin sees all');
END $$;

-- 6
DO $$
DECLARE n BIGINT;
BEGIN
  BEGIN
    PERFORM t.become('anon');
    UPDATE public.access_requests SET status = 'approved';
    RAISE EXCEPTION 'anon could update';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;
  BEGIN
    PERFORM t.become('anon');
    DELETE FROM public.access_requests;
    RAISE EXCEPTION 'anon could delete';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;
  PERFORM t.become('authenticated', t.id('collector'));
  UPDATE public.access_requests SET status = 'approved';
  GET DIAGNOSTICS n = ROW_COUNT;
  ASSERT n = 0, 'non-admin updated ' || n;
  BEGIN
    DELETE FROM public.access_requests;
    RAISE EXCEPTION 'non-admin could delete';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;
  PERFORM t.become('postgres');
  ASSERT NOT EXISTS (SELECT 1 FROM public.access_requests WHERE status <> 'submitted');
  PERFORM t.pass('anon cannot update/delete; non-admin updates hit 0 rows and cannot delete');
END $$;

-- 7
DO $$
DECLARE r public.access_requests; c TEXT;
BEGIN
  PERFORM t.become('authenticated', t.id('admin'));
  UPDATE public.access_requests SET status = 'reviewed', notes = 'Called back'
  WHERE email = 'jane@example.test';
  PERFORM t.become('postgres');
  SELECT * INTO STRICT r FROM public.access_requests WHERE email = 'jane@example.test';
  ASSERT r.status = 'reviewed' AND r.notes = 'Called back';
  ASSERT r.reviewed_by = t.id('admin'), 'reviewed_by';
  ASSERT r.reviewed_at IS NOT NULL, 'reviewed_at';
  PERFORM t.put('jane', r.id);

  FOREACH c IN ARRAY ARRAY['full_name', 'email', 'phone', 'role', 'site_name',
                           'referral_source', 'reviewed_by', 'reviewed_at', 'created_at', 'id'] LOOP
    BEGIN
      PERFORM t.become('authenticated', t.id('admin'));
      EXECUTE format('UPDATE public.access_requests SET %I = %I', c, c);
      RAISE EXCEPTION 'admin could update %', c;
    EXCEPTION WHEN insufficient_privilege THEN NULL;
    END;
  END LOOP;
  BEGIN
    PERFORM t.become('authenticated', t.id('admin'));
    DELETE FROM public.access_requests;
    RAISE EXCEPTION 'admin could delete';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;
  PERFORM t.pass('admin may update only status and notes; no other column, no DELETE');
END $$;

-- 8: the trigger overrides whatever reviewer fields are written.
DO $$
DECLARE r public.access_requests;
BEGIN
  PERFORM set_config('request.jwt.claim.sub', t.id('admin')::text, true);
  UPDATE public.access_requests
  SET status = 'approved', reviewed_by = t.id('collector'), reviewed_at = '2000-01-01'
  WHERE id = t.id('jane');
  SELECT * INTO STRICT r FROM public.access_requests WHERE id = t.id('jane');
  ASSERT r.reviewed_by = t.id('admin'), 'forged reviewer kept';
  ASSERT r.reviewed_at = now(), 'forged timestamp kept';
  PERFORM t.pass('reviewer trigger: reviewed_by = auth.uid() and reviewed_at = now(), whatever is supplied');
END $$;

-- 9: no auth.uid() (service-side update) keeps the previous reviewer.
DO $$
DECLARE r public.access_requests; v_before TIMESTAMPTZ;
BEGIN
  SELECT reviewed_at INTO v_before FROM public.access_requests WHERE id = t.id('jane');
  PERFORM set_config('request.jwt.claim.sub', '', true);
  UPDATE public.access_requests SET status = 'invited', reviewed_by = NULL
  WHERE id = t.id('jane');
  SELECT * INTO STRICT r FROM public.access_requests WHERE id = t.id('jane');
  ASSERT r.status = 'invited';
  ASSERT r.reviewed_by = t.id('admin'), 'previous reviewer erased';
  ASSERT r.reviewed_at >= v_before;

  UPDATE public.access_requests SET notes = 'auto'
  WHERE full_name = 'Phone Ok' AND phone = '0712345678';
  SELECT * INTO STRICT r FROM public.access_requests
  WHERE full_name = 'Phone Ok' AND phone = '0712345678';
  ASSERT r.reviewed_by IS NULL AND r.reviewed_at IS NOT NULL;
  PERFORM t.pass('reviewer trigger without auth.uid(): previous reviewer kept (NULL stays NULL), reviewed_at set');
END $$;

-- 10
DO $$ BEGIN
  ASSERT NOT has_function_privilege('anon', 'public.set_access_request_reviewer()', 'EXECUTE');
  ASSERT NOT has_function_privilege('authenticated', 'public.set_access_request_reviewer()', 'EXECUTE');
  ASSERT NOT has_table_privilege('anon', 'public.access_requests', 'SELECT');
  ASSERT NOT has_table_privilege('anon', 'public.access_requests', 'UPDATE');
  ASSERT NOT has_table_privilege('authenticated', 'public.access_requests', 'DELETE');
  ASSERT has_column_privilege('anon', 'public.access_requests', 'full_name', 'INSERT');
  ASSERT NOT has_column_privilege('anon', 'public.access_requests', 'status', 'INSERT');
  ASSERT has_column_privilege('authenticated', 'public.access_requests', 'notes', 'UPDATE');
  ASSERT NOT has_column_privilege('authenticated', 'public.access_requests', 'reviewed_by', 'UPDATE');
  PERFORM t.pass('catalog: trigger function and table/column grants are as intended');
END $$;

-- ============================================================ round 3 additions
DO $$ BEGIN
  PERFORM t.mkuser('admin_b', 'admin-b@example.test', true);   -- second active admin
  PERFORM t.set_profile(t.id('admin_b'), 'admin', true);
END $$;

-- 11
DO $$
DECLARE n BIGINT; v_id UUID;
BEGIN
  PERFORM t.become('anon');
  INSERT INTO public.access_requests
    (full_name, email, phone, role, site_name, referral_source)
  VALUES ('No Readback', 'noreadback@example.test', '0712345678', 'recycler', 'Site B', 'Radio');
  BEGIN
    INSERT INTO public.access_requests (full_name, email)
    VALUES ('Read Back', 'readback@example.test') RETURNING id INTO v_id;
    RAISE EXCEPTION 'anon could read the inserted row back';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;
  BEGIN
    SELECT count(*) INTO n FROM public.access_requests;
    RAISE EXCEPTION 'anon SELECT returned % rows instead of being denied', n;
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;
  PERFORM t.become('postgres');
  ASSERT EXISTS (SELECT 1 FROM public.access_requests WHERE email = 'noreadback@example.test'
                 AND role = 'recycler' AND site_name = 'Site B' AND referral_source = 'Radio');
  ASSERT NOT EXISTS (SELECT 1 FROM public.access_requests WHERE email = 'readback@example.test');
  PERFORM t.pass('anon inserts all 6 columns without RETURNING; RETURNING and SELECT are denied (0 rows readable)');
END $$;

-- 12
DO $$
DECLARE
  v_email_254 TEXT := repeat('a', 254 - length('@example.test')) || '@example.test';
  v_ok TEXT[][] := ARRAY[
    ['full_name', repeat('n', 2)], ['full_name', repeat('n', 150)],
    ['site_name', repeat('s', 120)], ['referral_source', repeat('r', 200)]];
  v_bad TEXT[][] := ARRAY[
    ['full_name', 'n'], ['full_name', '  n  '], ['full_name', repeat('n', 151)],
    ['site_name', repeat('s', 121)], ['site_name', ''], ['site_name', '   '],
    ['referral_source', repeat('r', 201)], ['referral_source', ''], ['referral_source', '  ']];
  i INTEGER;
BEGIN
  FOR i IN 1 .. array_length(v_ok, 1) LOOP
    PERFORM t.become('anon');
    IF v_ok[i][1] = 'full_name' THEN
      EXECUTE 'INSERT INTO public.access_requests (full_name, email) VALUES ($1, ''len-ok@example.test'')'
        USING v_ok[i][2];
    ELSE
      EXECUTE format('INSERT INTO public.access_requests (full_name, email, %I) VALUES (''Len Ok'', ''len-ok@example.test'', $1)',
                     v_ok[i][1]) USING v_ok[i][2];
    END IF;
  END LOOP;
  FOR i IN 1 .. array_length(v_bad, 1) LOOP
    BEGIN
      PERFORM t.become('anon');
      IF v_bad[i][1] = 'full_name' THEN
        EXECUTE 'INSERT INTO public.access_requests (full_name, email) VALUES ($1, ''len-bad@example.test'')'
          USING v_bad[i][2];
      ELSE
        EXECUTE format('INSERT INTO public.access_requests (full_name, email, %I) VALUES (''Len Bad'', ''len-bad@example.test'', $1)',
                       v_bad[i][1]) USING v_bad[i][2];
      END IF;
      RAISE EXCEPTION '% of length % accepted', v_bad[i][1], length(v_bad[i][2]);
    EXCEPTION WHEN check_violation THEN NULL;
    END;
  END LOOP;
  PERFORM t.become('anon');
  INSERT INTO public.access_requests (full_name, email) VALUES ('Long Email', v_email_254);
  BEGIN
    INSERT INTO public.access_requests (full_name, email) VALUES ('Long Email', 'a' || v_email_254);
    RAISE EXCEPTION '255-character email accepted';
  EXCEPTION WHEN check_violation THEN NULL;
  END;
  PERFORM t.become('postgres');
  ASSERT (SELECT count(*) FROM public.access_requests WHERE email = 'len-ok@example.test') = 4;
  ASSERT NOT EXISTS (SELECT 1 FROM public.access_requests WHERE email = 'len-bad@example.test');
  PERFORM t.pass('length CHECKs: name 2-150 (trimmed), site_name 1-120, referral_source 1-200, email <= 254');
END $$;

-- 13: phone parity with apps/mobile/src/lib/access.ts
DO $$
DECLARE
  v_accept TEXT[] := ARRAY['0712345678', '0110123456', '+254712345678', '254712345678',
    '+254 712 345 678', '0712-345-678', '(0712) 345678', '020 1234567', '1234567',
    '+123456789012345'];
  v_reject TEXT[] := ARRAY['abc', '0712abc678', '07I2345678', '+254.712.345.678',
    '254+712345678', '123456', '+2547123456789012', '+', '( ) -',
    '+254 712 345 678' || repeat(' ', 17)];   -- 33 chars, 12 digits: rejected by length only
  x TEXT;
BEGIN
  ASSERT length(v_reject[10]) = 33 AND length(regexp_replace(v_reject[10], '[^0-9]', '', 'g')) = 12;
  FOREACH x IN ARRAY v_accept LOOP
    BEGIN
      PERFORM t.become('anon');
      INSERT INTO public.access_requests (full_name, phone) VALUES ('Parity Ok', x);
    EXCEPTION WHEN check_violation THEN
      RAISE EXCEPTION 'valid phone rejected: "%"', x;
    END;
  END LOOP;
  FOREACH x IN ARRAY v_reject LOOP
    BEGIN
      PERFORM t.become('anon');
      INSERT INTO public.access_requests (full_name, phone) VALUES ('Parity Bad', x);
      RAISE EXCEPTION 'invalid phone accepted: "%"', x;
    EXCEPTION WHEN check_violation THEN NULL;
    END;
  END LOOP;
  PERFORM t.become('postgres');
  ASSERT (SELECT count(*) FROM public.access_requests WHERE full_name = 'Parity Ok') = 10;
  ASSERT NOT EXISTS (SELECT 1 FROM public.access_requests WHERE full_name = 'Parity Bad');
  PERFORM t.pass('phone parity: the 10 client-accepted forms pass and the 10 client-rejected forms fail');
END $$;

-- 14
DO $$
DECLARE r public.access_requests; v_id UUID;
BEGIN
  SELECT id INTO STRICT v_id FROM public.access_requests WHERE email = 'noreadback@example.test';
  PERFORM t.put('noreadback', v_id);
  PERFORM t.as_user(t.id('admin'));
  UPDATE public.access_requests SET notes = 'Notes only' WHERE id = v_id;
  PERFORM t.become('postgres');
  SELECT * INTO STRICT r FROM public.access_requests WHERE id = v_id;
  ASSERT r.notes = 'Notes only' AND r.status = 'submitted', 'notes-only update';
  ASSERT r.reviewed_by = t.id('admin') AND r.reviewed_at = now();
  PERFORM t.pass('an admin can update notes alone; status untouched; reviewer stamped');
END $$;

-- 15
DO $$
DECLARE r public.access_requests;
BEGIN
  PERFORM t.as_user(t.id('admin_b'));
  UPDATE public.access_requests SET status = 'reviewed', notes = 'Second look' WHERE id = t.id('noreadback');
  PERFORM t.become('postgres');
  SELECT * INTO STRICT r FROM public.access_requests WHERE id = t.id('noreadback');
  ASSERT r.reviewed_by = t.id('admin_b'), 'reviewer did not follow the second admin';
  ASSERT r.reviewed_at = now(), 'reviewed_at did not follow the second admin';
  ASSERT r.status = 'reviewed' AND r.notes = 'Second look';
  PERFORM t.pass('reviewed_by/reviewed_at follow a second admin''s later edit');
END $$;

-- 16
DO $$
DECLARE v_before JSONB; c TEXT; v TEXT;
BEGIN
  SELECT to_jsonb(a) INTO v_before FROM public.access_requests a WHERE id = t.id('noreadback');
  FOREACH c IN ARRAY ARRAY['reviewed_by', 'reviewed_at', 'full_name', 'email', 'phone',
                           'role', 'created_at', 'id'] LOOP
    v := CASE c
      WHEN 'reviewed_by' THEN quote_literal(t.id('collector'))
      WHEN 'reviewed_at' THEN '''2000-01-01'''
      WHEN 'full_name' THEN '''Hacked Name'''
      WHEN 'email' THEN '''hacked@example.test'''
      WHEN 'phone' THEN '''0799999999'''
      WHEN 'role' THEN '''site_manager'''
      WHEN 'created_at' THEN '''2000-01-01'''
      ELSE 'gen_random_uuid()' END;
    BEGIN
      PERFORM t.as_user(t.id('admin'));
      EXECUTE format('UPDATE public.access_requests SET %I = %s WHERE id = %L', c, v, t.id('noreadback'));
      RAISE EXCEPTION 'admin could set %', c;
    EXCEPTION WHEN insufficient_privilege THEN NULL;
    END;
  END LOOP;
  ASSERT (SELECT to_jsonb(a) FROM public.access_requests a WHERE id = t.id('noreadback')) = v_before,
    'row changed after denied updates';
  PERFORM t.pass('admin cannot set reviewer fields, identity, contact, role, created_at or id; row unchanged');
END $$;

-- 17 (service_role has UPDATE on status only, so forged reviewer values
-- are denied outright; a status update keeps the previous reviewer)
DO $$
DECLARE r public.access_requests; c TEXT;
BEGIN
  FOREACH c IN ARRAY ARRAY['reviewed_by', 'reviewed_at', 'notes'] LOOP
    BEGIN
      PERFORM t.become('service_role');
      EXECUTE format('UPDATE public.access_requests SET status = ''invited'', %I = %s WHERE id = %L',
        c, CASE c WHEN 'reviewed_by' THEN quote_literal(t.id('collector'))
                  WHEN 'reviewed_at' THEN '''2000-01-01''' ELSE '''forged''' END,
        t.id('noreadback'));
      RAISE EXCEPTION 'service_role could set %', c;
    EXCEPTION WHEN insufficient_privilege THEN NULL;
    END;
  END LOOP;
  PERFORM t.become('service_role');
  UPDATE public.access_requests SET status = 'invited' WHERE id = t.id('noreadback');
  PERFORM t.become('postgres');
  SELECT * INTO STRICT r FROM public.access_requests WHERE id = t.id('noreadback');
  ASSERT r.status = 'invited';
  ASSERT r.reviewed_by = t.id('admin_b'), 'service_role update replaced the reviewer';
  ASSERT r.reviewed_at = now(), 'reviewed_at not stamped';
  ASSERT r.notes = 'Second look', 'notes changed';
  PERFORM t.pass('service_role: forged reviewer/notes denied; status update keeps the previous reviewer and stamps reviewed_at');
END $$;

-- 18
DO $$
DECLARE u TEXT; v_count BIGINT;
BEGIN
  SELECT count(*) INTO v_count FROM public.access_requests;
  BEGIN
    PERFORM t.become('anon');
    DELETE FROM public.access_requests;
    RAISE EXCEPTION 'anon could delete';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;
  FOREACH u IN ARRAY ARRAY['collector', 'admin_off', 'admin', 'admin_b'] LOOP
    BEGIN
      PERFORM t.as_user(t.id(u));
      DELETE FROM public.access_requests WHERE id = t.id('noreadback');
      RAISE EXCEPTION '% could delete', u;
    EXCEPTION WHEN insufficient_privilege THEN NULL;
    END;
  END LOOP;
  BEGIN
    PERFORM t.become('authenticated', NULL);
    DELETE FROM public.access_requests;
    RAISE EXCEPTION 'no-JWT authenticated could delete';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;
  PERFORM t.become('postgres');
  ASSERT (SELECT count(*) FROM public.access_requests) = v_count;
  PERFORM t.pass('DELETE denied for anon, non-admin, inactive admin, both active admins and no-JWT');
END $$;

-- 19
DO $$
DECLARE n BIGINT; v_before JSONB;
BEGIN
  SELECT jsonb_agg(to_jsonb(a) ORDER BY id) INTO v_before FROM public.access_requests a;
  PERFORM t.as_user(t.id('admin_off'));
  SELECT count(*) INTO n FROM public.access_requests;
  ASSERT n = 0, 'inactive admin sees ' || n;
  UPDATE public.access_requests SET status = 'rejected', notes = 'inactive';
  GET DIAGNOSTICS n = ROW_COUNT;
  ASSERT n = 0, 'inactive admin updated ' || n;
  PERFORM t.as_user(t.id('collector'));
  UPDATE public.access_requests SET notes = 'collector';
  GET DIAGNOSTICS n = ROW_COUNT;
  ASSERT n = 0, 'non-admin updated ' || n;
  PERFORM t.become('postgres');
  ASSERT (SELECT jsonb_agg(to_jsonb(a) ORDER BY id) FROM public.access_requests a) = v_before;
  PERFORM t.pass('non-admins and inactive admins see 0 rows and update 0 rows');
END $$;

-- 20
DO $$
DECLARE
  col TEXT;
  v_insert TEXT[] := ARRAY['full_name', 'email', 'phone', 'role', 'site_name', 'referral_source'];
  v_update TEXT[] := ARRAY['status', 'notes'];
  v_qual TEXT; v_check TEXT;
  tg RECORD;
BEGIN
  FOR col IN SELECT attname FROM pg_attribute
             WHERE attrelid = 'public.access_requests'::regclass AND attnum > 0 AND NOT attisdropped LOOP
    ASSERT has_column_privilege('anon', 'public.access_requests', col, 'INSERT') = (col = ANY (v_insert)),
      'anon INSERT on ' || col;
    ASSERT has_column_privilege('authenticated', 'public.access_requests', col, 'INSERT') = (col = ANY (v_insert)),
      'authenticated INSERT on ' || col;
    ASSERT has_column_privilege('authenticated', 'public.access_requests', col, 'UPDATE') = (col = ANY (v_update)),
      'authenticated UPDATE on ' || col;
    ASSERT NOT has_column_privilege('anon', 'public.access_requests', col, 'SELECT'), 'anon SELECT on ' || col;
    ASSERT NOT has_column_privilege('anon', 'public.access_requests', col, 'UPDATE'), 'anon UPDATE on ' || col;
    ASSERT has_column_privilege('authenticated', 'public.access_requests', col, 'SELECT'), 'authenticated SELECT ' || col;
  END LOOP;
  ASSERT NOT has_table_privilege('anon', 'public.access_requests', 'DELETE, TRUNCATE, REFERENCES, TRIGGER');
  ASSERT NOT has_table_privilege('authenticated', 'public.access_requests', 'DELETE, TRUNCATE, REFERENCES, TRIGGER');

  SELECT qual, with_check INTO STRICT v_qual, v_check FROM pg_policies
  WHERE schemaname = 'public' AND tablename = 'access_requests'
    AND policyname = 'admin_manage_access_requests';
  ASSERT v_qual ~ '\(\s*SELECT\s+(public\.)?is_active_admin\(\)', 'USING not wrapped in SELECT: ' || v_qual;
  ASSERT v_check ~ '\(\s*SELECT\s+(public\.)?is_active_admin\(\)', 'WITH CHECK not wrapped in SELECT: ' || v_check;

  SELECT * INTO STRICT tg FROM pg_trigger
  WHERE tgrelid = 'public.access_requests'::regclass AND NOT tgisinternal;
  ASSERT tg.tgname = 'access_requests_set_reviewer';
  ASSERT tg.tgfoid = 'public.set_access_request_reviewer()'::regprocedure;
  ASSERT tg.tgenabled = 'O', 'trigger disabled';
  ASSERT (tg.tgtype & 1) = 1, 'not FOR EACH ROW';
  ASSERT (tg.tgtype & 2) = 2, 'not BEFORE';
  ASSERT (tg.tgtype & 16) = 16, 'not ON UPDATE';
  ASSERT (tg.tgtype & (4 | 8 | 32)) = 0, 'also fires on INSERT/DELETE/TRUNCATE';
  PERFORM t.pass('catalog: exact column grants, (SELECT is_active_admin()) in USING and WITH CHECK, single BEFORE UPDATE row trigger');
END $$;
