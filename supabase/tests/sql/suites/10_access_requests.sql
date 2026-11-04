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
