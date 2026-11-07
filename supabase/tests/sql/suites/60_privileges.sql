-- PRIVILEGES CATALOG: the exact grant and EXECUTE matrix for every table
-- and function in schema public. Any object that is not listed here, or
-- whose effective access differs, fails, so new objects cannot slip in
-- without updating this file.
--
-- Effective access is computed with has_table_privilege /
-- has_column_privilege / has_function_privilege, which include PUBLIC and
-- role membership. Raw ACL entries, ownership, RLS and default privileges
-- are checked separately. Lines starting "MATRIX" are the report
-- (run with VERBOSE=1 to see them).
SET client_min_messages = notice;

-- "<table-level privileges> | <column-only privileges>", columns sorted.
CREATE FUNCTION t.table_privs(p_rel REGCLASS, p_role TEXT) RETURNS TEXT
LANGUAGE plpgsql STABLE AS $$
DECLARE
  v_table TEXT[] := '{}';
  v_cols TEXT[] := '{}';
  p TEXT;
  v_list TEXT;
BEGIN
  FOREACH p IN ARRAY ARRAY['SELECT', 'INSERT', 'UPDATE', 'DELETE', 'TRUNCATE', 'REFERENCES', 'TRIGGER'] LOOP
    IF has_table_privilege(p_role, p_rel, p) THEN
      v_table := v_table || p;
    END IF;
  END LOOP;
  FOREACH p IN ARRAY ARRAY['SELECT', 'INSERT', 'UPDATE', 'REFERENCES'] LOOP
    IF NOT (p = ANY (v_table)) THEN
      SELECT string_agg(a.attname::text, ',' ORDER BY a.attname::text) INTO v_list
      FROM pg_attribute AS a
      WHERE a.attrelid = p_rel AND a.attnum > 0 AND NOT a.attisdropped
        AND has_column_privilege(p_role, p_rel, a.attnum, p);
      IF v_list IS NOT NULL THEN
        v_cols := v_cols || (p || '(' || v_list || ')');
      END IF;
    END IF;
  END LOOP;
  RETURN COALESCE(NULLIF(array_to_string(v_table, ','), ''), '-')
      || ' | ' || COALESCE(NULLIF(array_to_string(v_cols, ' '), ''), '-');
END $$;

CREATE TABLE t.expected_tables (tbl TEXT, role TEXT, privs TEXT, PRIMARY KEY (tbl, role));
INSERT INTO t.expected_tables VALUES
  ('access_requests', 'public',        '- | -'),
  ('access_requests', 'anon',          '- | INSERT(email,full_name,phone,referral_source,role,site_id)'),
  ('access_requests', 'authenticated', 'SELECT | INSERT(email,full_name,phone,referral_source,role,site_id) UPDATE(notes,status)'),
  ('access_requests', 'service_role',  '- | SELECT(email,full_name,id,phone,role,site_id,status) UPDATE(status)'),
  ('collection_events', 'public',        '- | -'),
  ('collection_events', 'anon',          '- | -'),
  ('collection_events', 'authenticated', 'SELECT | -'),
  ('collection_events', 'service_role',  '- | -'),
  ('collection_evidence', 'public',        '- | -'),
  ('collection_evidence', 'anon',          '- | -'),
  ('collection_evidence', 'authenticated', 'SELECT | INSERT(captured_at,collection_id,content_type,storage_path)'),
  ('collection_evidence', 'service_role',  '- | -'),
  ('collection_logs', 'public',        '- | -'),
  ('collection_logs', 'anon',          '- | -'),
  ('collection_logs', 'authenticated', 'SELECT | INSERT(captured_at,client_record_id,device_accuracy_m,device_latitude,device_longitude,material_code,reported_weight_kg,site_id)'),
  ('collection_logs', 'service_role',  '- | -'),
  ('collection_verified_items', 'public',        '- | -'),
  ('collection_verified_items', 'anon',          '- | -'),
  ('collection_verified_items', 'authenticated', 'SELECT | -'),
  ('collection_verified_items', 'service_role',  '- | -'),
  ('invitations', 'public',        '- | -'),
  ('invitations', 'anon',          '- | -'),
  ('invitations', 'authenticated', '- | SELECT(accepted_at,auth_user_id,created_at,email,expires_at,failed_attempts,id,invited_by,revoked_at,revoked_by,role,status,superseded_by)'),
  ('invitations', 'service_role',  '- | SELECT(accepted_at,auth_user_id,created_at,email,expires_at,failed_attempts,id,invited_by,revoked_at,revoked_by,role,status,superseded_by)'),
  ('materials', 'public',        '- | -'),
  ('materials', 'anon',          '- | -'),
  ('materials', 'authenticated', 'SELECT | -'),
  ('materials', 'service_role',  '- | -'),
  ('profiles', 'public',        '- | -'),
  ('profiles', 'anon',          '- | -'),
  ('profiles', 'authenticated', 'SELECT | -'),
  ('profiles', 'service_role',  'SELECT | -'),
  ('sites', 'public',        '- | -'),
  ('sites', 'anon',          '- | -'),
  ('sites', 'authenticated', 'SELECT | -'),
  ('sites', 'service_role',  'SELECT | -'),
  ('user_sites', 'public',        '- | -'),
  ('user_sites', 'anon',          '- | -'),
  ('user_sites', 'authenticated', 'SELECT | -'),
  ('user_sites', 'service_role',  'SELECT | -');

-- kind: trigger | rls_helper | rpc | owner_only
CREATE TABLE t.expected_functions (
  sig TEXT PRIMARY KEY, kind TEXT NOT NULL, definer BOOLEAN NOT NULL,
  anon BOOLEAN NOT NULL, authn BOOLEAN NOT NULL, service BOOLEAN NOT NULL);
INSERT INTO t.expected_functions VALUES
  ('public.enforce_collection_insert()',                       'trigger',    false, false, false, false),
  ('public.protect_collection_update()',                       'trigger',    false, false, false, false),
  ('public.record_collection_submitted()',                     'trigger',    true,  false, false, false),
  ('public.protect_collection_verified_item()',                'trigger',    false, false, false, false),
  ('public.enforce_collection_evidence_insert()',              'trigger',    false, false, false, false),
  ('public.handle_new_auth_user()',                            'trigger',    true,  false, false, false),
  ('public.sync_auth_user_profile()',                          'trigger',    true,  false, false, false),
  ('public.set_access_request_reviewer()',                     'trigger',    false, false, false, false),
  ('public.is_active_admin()',                                 'rls_helper', true,  false, true,  false),
  ('public.is_active_site_member(uuid)',                       'rls_helper', true,  false, true,  false),
  ('public.can_review_site(uuid)',                             'rls_helper', true,  false, true,  false),
  ('public.is_evidence_object_path(text,uuid,uuid)',           'rls_helper', false, false, true,  false),
  ('public.public_site_options()',                             'rpc',        true,  true,  true,  false),
  ('public.review_collection(uuid,boolean,jsonb,text)',        'rpc',        true,  false, true,  false),
  ('public.revoke_invitation(uuid)',                           'rpc',        true,  false, true,  false),
  ('public.register_invitation(uuid,text,text,public.user_role,uuid[],uuid,text)', 'rpc', true, false, false, true),
  ('public.verify_invitation_code(text,text)',                 'rpc',        true,  false, false, true),
  ('public.claim_invitation(uuid)',                            'rpc',        true,  false, false, true),
  ('public.release_invitation_claim(uuid,uuid)',               'rpc',        true,  false, false, true),
  ('public.consume_invitation(uuid,uuid)',                     'rpc',        true,  false, false, true),
  ('public.reissue_invitation(uuid,uuid,text,text,public.user_role,uuid[])', 'rpc', true, false, false, true),
  ('public.bootstrap_first_admin(text)',                       'owner_only', true,  false, false, false);

DO $$ BEGIN
  PERFORM t.mkuser('admin', 'admin@example.test', true);
  PERFORM public.bootstrap_first_admin('admin@example.test');
END $$;

-- 1: no unexpected kinds of object in public
DO $$
DECLARE v_bad TEXT;
BEGIN
  SELECT string_agg(c.relname || ' (relkind ' || c.relkind || ')', ', ') INTO v_bad
  FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
  WHERE n.nspname = 'public' AND c.relkind NOT IN ('r', 'i');
  ASSERT v_bad IS NULL, 'unexpected views/sequences/other relations in public: ' || v_bad;
  PERFORM t.pass('public contains only tables and indexes (no views, sequences or other relations)');
END $$;

-- 2: the table list is exactly the expected one
DO $$
DECLARE v_extra TEXT; v_missing TEXT;
BEGIN
  SELECT string_agg(c.relname, ', ') INTO v_extra
  FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
  WHERE n.nspname = 'public' AND c.relkind = 'r'
    AND c.relname NOT IN (SELECT tbl FROM t.expected_tables);
  SELECT string_agg(DISTINCT e.tbl, ', ') INTO v_missing
  FROM t.expected_tables e WHERE to_regclass('public.' || e.tbl) IS NULL;
  ASSERT v_extra IS NULL, 'tables missing from the privilege matrix: ' || v_extra;
  ASSERT v_missing IS NULL, 'expected tables that do not exist: ' || v_missing;
  PERFORM t.pass('every table in public is in the privilege matrix, and every matrix table exists');
END $$;

-- 3: effective table and column privileges match the matrix exactly
DO $$
DECLARE r RECORD; v_actual TEXT; v_diffs TEXT := '';
BEGIN
  FOR r IN SELECT * FROM t.expected_tables ORDER BY tbl, role LOOP
    v_actual := t.table_privs(('public.' || r.tbl)::regclass, r.role);
    RAISE NOTICE '%', format('MATRIX table %-20s %-14s %s', r.tbl, r.role, v_actual);
    IF v_actual IS DISTINCT FROM r.privs THEN
      v_diffs := v_diffs || format(E'\n  %s / %s: expected [%s] got [%s]', r.tbl, r.role, r.privs, v_actual);
    END IF;
  END LOOP;
  ASSERT v_diffs = '', 'effective privileges differ:' || v_diffs;
  PERFORM t.pass('effective table/column privileges for PUBLIC, anon, authenticated, service_role match the matrix');
END $$;

-- 4: raw ACL entries: only the owner and the three API roles, never PUBLIC,
-- never WITH GRANT OPTION for a non-owner
DO $$
DECLARE v_bad TEXT;
BEGIN
  SELECT string_agg(DISTINCT format('%s: %s', obj, grantee), ', ') INTO v_bad FROM (
    SELECT c.relname AS obj, a.grantee, a.is_grantable, c.relowner AS owner
    FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace, aclexplode(c.relacl) a
    WHERE n.nspname = 'public' AND c.relkind = 'r'
    UNION ALL
    SELECT c.relname || '.' || att.attname, a.grantee, a.is_grantable, c.relowner
    FROM pg_attribute att JOIN pg_class c ON c.oid = att.attrelid
    JOIN pg_namespace n ON n.oid = c.relnamespace, aclexplode(att.attacl) a
    WHERE n.nspname = 'public' AND att.attnum > 0
    UNION ALL
    SELECT p.oid::regprocedure::text, a.grantee, a.is_grantable, p.proowner
    FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace, aclexplode(p.proacl) a
    WHERE n.nspname = 'public'
  ) AS acl(obj, grantee_oid, is_grantable, owner)
  CROSS JOIN LATERAL (SELECT CASE WHEN grantee_oid = 0 THEN 'PUBLIC'
                                  ELSE pg_get_userbyid(grantee_oid) END AS grantee) g
  WHERE grantee_oid = 0
     OR (grantee_oid <> owner AND (is_grantable
         OR pg_get_userbyid(grantee_oid) NOT IN ('anon', 'authenticated', 'service_role')));
  ASSERT v_bad IS NULL, 'unexpected ACL entries: ' || v_bad;
  ASSERT NOT EXISTS (
    SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public' AND p.proacl IS NULL), 'a function has a NULL ACL (default PUBLIC EXECUTE)';
  PERFORM t.pass('raw ACLs: no PUBLIC entries, no non-owner grant options, only anon/authenticated/service_role; no default function ACL');
END $$;

-- 5: ownership and RLS
DO $$
DECLARE v_bad TEXT;
BEGIN
  SELECT string_agg(obj, ', ') INTO v_bad FROM (
    SELECT c.relname AS obj FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public' AND c.relkind = 'r' AND pg_get_userbyid(c.relowner) <> 'postgres'
    UNION ALL
    SELECT p.oid::regprocedure::text FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public' AND pg_get_userbyid(p.proowner) <> 'postgres'
    UNION ALL
    SELECT t2.typname FROM pg_type t2 JOIN pg_namespace n ON n.oid = t2.typnamespace
    WHERE n.nspname = 'public' AND t2.typtype = 'e' AND pg_get_userbyid(t2.typowner) <> 'postgres') s;
  ASSERT v_bad IS NULL, 'objects not owned by postgres: ' || v_bad;
  SELECT string_agg(c.relname, ', ') INTO v_bad
  FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
  WHERE n.nspname = 'public' AND c.relkind = 'r' AND NOT c.relrowsecurity;
  ASSERT v_bad IS NULL, 'tables without RLS: ' || v_bad;
  PERFORM t.pass('every table, function and enum in public is owned by postgres; RLS is enabled on every table');
END $$;

-- 6: the API roles inherit nothing through membership
DO $$
DECLARE v_bad TEXT;
BEGIN
  SELECT string_agg(pg_get_userbyid(m.member) || ' in ' || pg_get_userbyid(m.roleid), ', ') INTO v_bad
  FROM pg_auth_members m
  WHERE pg_get_userbyid(m.member) IN ('anon', 'authenticated', 'service_role');
  ASSERT v_bad IS NULL, 'API roles are members of other roles: ' || v_bad;
  ASSERT (SELECT NOT rolsuper AND NOT rolcreaterole AND NOT rolcreatedb
          FROM pg_roles WHERE rolname = 'anon');
  ASSERT (SELECT NOT rolsuper AND NOT rolbypassrls FROM pg_roles WHERE rolname = 'authenticated');
  ASSERT (SELECT NOT rolsuper AND rolbypassrls FROM pg_roles WHERE rolname = 'service_role');
  PERFORM t.pass('anon/authenticated/service_role inherit no privileges via membership; only service_role bypasses RLS');
END $$;

-- The function checks are helpers so test 14 can run the same code against
-- a throwaway function.

-- Functions in public missing from the matrix, and matrix entries that do
-- not exist. NULL when the list matches exactly.
CREATE FUNCTION t.function_list_problems() RETURNS TEXT
LANGUAGE plpgsql STABLE AS $$
DECLARE v_extra TEXT; v_missing TEXT;
BEGIN
  SELECT string_agg(p.oid::regprocedure::text, ', ' ORDER BY p.oid::regprocedure::text) INTO v_extra
  FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
  WHERE n.nspname = 'public'
    AND p.oid NOT IN (SELECT to_regprocedure(sig) FROM t.expected_functions
                      WHERE to_regprocedure(sig) IS NOT NULL);
  SELECT string_agg(sig, ', ' ORDER BY sig) INTO v_missing
  FROM t.expected_functions WHERE to_regprocedure(sig) IS NULL;
  IF v_extra IS NULL AND v_missing IS NULL THEN
    RETURN NULL;
  END IF;
  RETURN concat_ws('; ',
    'functions missing from the EXECUTE matrix: ' || v_extra,
    'expected functions that do not exist: ' || v_missing);
END $$;

-- Matrix entries whose effective EXECUTE (incl. PUBLIC), SECURITY DEFINER or
-- search_path differ. NULL when all match. p_report emits MATRIX lines.
CREATE FUNCTION t.function_privilege_problems(p_report BOOLEAN DEFAULT FALSE) RETURNS TEXT
LANGUAGE plpgsql STABLE AS $$
DECLARE r RECORD; v_oid OID; v_diffs TEXT := ''; v_line TEXT;
BEGIN
  FOR r IN SELECT * FROM t.expected_functions ORDER BY kind, sig LOOP
    v_oid := to_regprocedure(r.sig);
    CONTINUE WHEN v_oid IS NULL;    -- reported by t.function_list_problems()
    v_line := format('PUBLIC=%s anon=%s authenticated=%s service_role=%s definer=%s',
      has_function_privilege('public', v_oid, 'EXECUTE'),
      has_function_privilege('anon', v_oid, 'EXECUTE'),
      has_function_privilege('authenticated', v_oid, 'EXECUTE'),
      has_function_privilege('service_role', v_oid, 'EXECUTE'),
      (SELECT prosecdef FROM pg_proc WHERE oid = v_oid));
    IF p_report THEN
      RAISE NOTICE '%', format('MATRIX function %-55s %-10s %s', r.sig, r.kind, v_line);
    END IF;
    IF has_function_privilege('public', v_oid, 'EXECUTE')
       OR has_function_privilege('anon', v_oid, 'EXECUTE') <> r.anon
       OR has_function_privilege('authenticated', v_oid, 'EXECUTE') <> r.authn
       OR has_function_privilege('service_role', v_oid, 'EXECUTE') <> r.service
       OR (SELECT prosecdef FROM pg_proc WHERE oid = v_oid) <> r.definer
       OR (SELECT proconfig FROM pg_proc WHERE oid = v_oid) IS DISTINCT FROM ARRAY['search_path=""']
    THEN
      v_diffs := v_diffs || E'\n  ' || r.sig || ': ' || v_line
        || ' search_path=' || COALESCE((SELECT array_to_string(proconfig, ',') FROM pg_proc WHERE oid = v_oid), '<unset>');
    END IF;
  END LOOP;
  RETURN NULLIF(v_diffs, '');
END $$;

-- 7: the function list is exactly the expected one
DO $$
DECLARE v_problems TEXT := t.function_list_problems();
BEGIN
  ASSERT v_problems IS NULL, v_problems;
  PERFORM t.pass('every function in public is in the EXECUTE matrix, and every matrix function exists');
END $$;

-- 8: effective EXECUTE, SECURITY DEFINER and search_path match
DO $$
DECLARE v_problems TEXT := t.function_privilege_problems(true);
BEGIN
  ASSERT v_problems IS NULL, 'function privileges differ:' || v_problems;
  PERFORM t.pass('effective EXECUTE for PUBLIC/anon/authenticated/service_role, SECURITY DEFINER and search_path match');
END $$;

-- 9: trigger functions are attached to triggers and executable by nobody;
-- every function with no API grants is a trigger or bootstrap_first_admin
DO $$
DECLARE v_bad TEXT;
BEGIN
  SELECT string_agg(sig, ', ') INTO v_bad FROM t.expected_functions e
  WHERE e.kind = 'trigger' AND (
    (SELECT prorettype FROM pg_proc WHERE oid = to_regprocedure(e.sig)) <> 'trigger'::regtype
    OR NOT EXISTS (SELECT 1 FROM pg_trigger tg WHERE tg.tgfoid = to_regprocedure(e.sig) AND NOT tg.tgisinternal));
  ASSERT v_bad IS NULL, 'trigger-kind functions not used by a trigger: ' || v_bad;
  SELECT string_agg(p.oid::regprocedure::text, ', ') INTO v_bad
  FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
  WHERE n.nspname = 'public' AND p.prorettype = 'trigger'::regtype
    AND (has_function_privilege('anon', p.oid, 'EXECUTE')
         OR has_function_privilege('authenticated', p.oid, 'EXECUTE')
         OR has_function_privilege('service_role', p.oid, 'EXECUTE'));
  ASSERT v_bad IS NULL, 'trigger functions executable by an API role: ' || v_bad;
  PERFORM t.pass('trigger functions are attached to triggers and executable by no API role');
END $$;

-- 10: triggers still fire for a role that has no EXECUTE on the function
DO $$
DECLARE v UUID := gen_random_uuid();
BEGIN
  BEGIN
    GRANT INSERT ON auth.users TO service_role;   -- stand-in for GoTrue's role
    PERFORM t.become('service_role');
    INSERT INTO auth.users (id, email) VALUES (v, 'trigger-probe@example.test');
    PERFORM t.become('postgres');
    ASSERT NOT has_function_privilege('service_role', 'public.handle_new_auth_user()', 'EXECUTE');
    ASSERT EXISTS (SELECT 1 FROM public.profiles WHERE id = v), 'auth trigger did not create the profile';
    RAISE EXCEPTION USING ERRCODE = 'T0001', MESSAGE = 'rollback';
  EXCEPTION WHEN SQLSTATE 'T0001' THEN NULL;
  END;
  ASSERT NOT has_table_privilege('service_role', 'auth.users', 'INSERT'), 'temporary grant leaked';
  PERFORM t.pass('handle_new_auth_user fires for an inserting role without EXECUTE on it (trigger EXECUTE is not checked)');
END $$;

-- 11: RLS helpers: authenticated can run them inside policies; the only
-- public function any anon/PUBLIC policy calls is public_site_options()
-- (the narrow, anon-executable site list), checked through pg_depend
DO $$
DECLARE n BIGINT; v_bad TEXT; v_total BIGINT;
BEGIN
  SELECT count(*) INTO v_total FROM public.sites;
  PERFORM t.as_user(t.id('admin'));
  SELECT count(*) INTO n FROM public.sites;              -- sites_read_assigned -> is_active_admin
  ASSERT n = v_total AND n > 0, 'admin saw ' || n || ' of ' || v_total || ' sites';
  SELECT count(*) INTO n FROM public.access_requests;    -- (SELECT is_active_admin())
  PERFORM t.become('postgres');

  SELECT string_agg(tablename || '.' || policyname, ', ') INTO v_bad
  FROM pg_policies
  WHERE schemaname = 'public'
    AND (roles && ARRAY['anon', 'public']::name[])
    AND (COALESCE(qual, '') || ' ' || COALESCE(with_check, '')) ~*
        '(is_active_admin|is_active_site_member|can_review_site|review_collection|invitation|bootstrap)';
  ASSERT v_bad IS NULL, 'policies for anon/PUBLIC call public functions: ' || v_bad;

  SELECT string_agg(DISTINCT pol.polname || ' -> ' || d.refobjid::regprocedure::text, ', ') INTO v_bad
  FROM pg_policy pol
  JOIN pg_depend d ON d.classid = 'pg_policy'::regclass AND d.objid = pol.oid
                  AND d.refclassid = 'pg_proc'::regclass
  JOIN pg_proc p ON p.oid = d.refobjid
  JOIN pg_namespace pn ON pn.oid = p.pronamespace
  WHERE (pol.polroles @> ARRAY[0::oid] OR pol.polroles @> ARRAY['anon'::regrole::oid])
    AND pn.nspname = 'public'
    AND d.refobjid <> 'public.public_site_options()'::regprocedure;
  ASSERT v_bad IS NULL, 'anon/PUBLIC policies depend on public functions: ' || v_bad;
  PERFORM t.pass('RLS helpers execute for authenticated inside policies; anon/PUBLIC policies call no public function but public_site_options()');
END $$;

-- 12: code_hash and the activation claim are unreadable by every API role
DO $$
DECLARE r TEXT; c TEXT; n BIGINT;
BEGIN
  FOREACH r IN ARRAY ARRAY['public', 'anon', 'authenticated', 'service_role'] LOOP
    FOREACH c IN ARRAY ARRAY['code_hash', 'claim_token', 'claim_expires_at'] LOOP
      ASSERT NOT has_column_privilege(r, 'public.invitations', c, 'SELECT,INSERT,UPDATE,REFERENCES'),
        r || ' has a privilege on ' || c;
    END LOOP;
    ASSERT NOT has_table_privilege(r, 'public.invitations', 'SELECT'), r || ' has table-level SELECT';
  END LOOP;
  FOREACH c IN ARRAY ARRAY['code_hash', 'claim_token', 'claim_expires_at'] LOOP
    BEGIN
      PERFORM t.become('service_role');
      EXECUTE format('SELECT %I FROM public.invitations', c);
      RAISE EXCEPTION 'service_role read %', c;
    EXCEPTION WHEN insufficient_privilege THEN NULL;
    END;
  END LOOP;
  PERFORM t.become('service_role');
  SELECT count(*) INTO n FROM (SELECT id FROM public.invitations WHERE status = 'pending') s;
  PERFORM t.become('postgres');
  PERFORM t.pass('code_hash, claim_token and claim_expires_at unreadable by PUBLIC, anon, authenticated and service_role; service_role can read the other columns');
END $$;

-- 13: bootstrap_first_admin is owner-only
DO $$
DECLARE r TEXT;
BEGIN
  FOREACH r IN ARRAY ARRAY['anon', 'authenticated', 'service_role'] LOOP
    BEGIN
      PERFORM t.become(r, t.id('admin'));
      PERFORM public.bootstrap_first_admin('admin@example.test');
      RAISE EXCEPTION '% executed bootstrap_first_admin', r;
    EXCEPTION WHEN insufficient_privilege THEN NULL;
    END;
  END LOOP;
  ASSERT (SELECT array_agg(pg_get_userbyid(a.grantee))
          FROM pg_proc p, aclexplode(p.proacl) a
          WHERE p.oid = 'public.bootstrap_first_admin(text)'::regprocedure) = ARRAY['postgres']::name[],
    'bootstrap_first_admin ACL is not owner-only';
  PERFORM t.pass('bootstrap_first_admin: ACL holds only the owner; anon, authenticated and service_role are denied');
END $$;

-- 14: a function added later without explicit grants.
-- Known, documented default: PostgreSQL gives new functions EXECUTE to
-- PUBLIC, and the schema-scoped ALTER DEFAULT PRIVILEGES in 001 cannot
-- override that (it only removes the schema-level anon/authenticated/
-- service_role grants). So the protection is the explicit REVOKE/GRANT
-- beside each definition, and this suite failing when one is missing.
-- Everything here runs in a rolled-back subtransaction.
DO $$
DECLARE
  v_line TEXT;
  v_acl TEXT;
  v_direct TEXT;
  v_list TEXT;
  v_priv TEXT;
  v_priv_fixed TEXT;
  f CONSTANT TEXT := 'public.zz_default_privilege_probe()';
BEGIN
  FOR v_line IN
    SELECT format('MATRIX default-acl %s %s %s', pg_get_userbyid(d.defaclrole), d.defaclobjtype,
                  array_to_string(d.defaclacl, ' '))
    FROM pg_default_acl d LEFT JOIN pg_namespace n ON n.oid = d.defaclnamespace
    WHERE n.nspname = 'public' OR d.defaclnamespace = 0
  LOOP
    RAISE NOTICE '%', v_line;
  END LOOP;

  BEGIN
    -- (a) a new function, created the way a careless migration would
    CREATE FUNCTION public.zz_default_privilege_probe() RETURNS INTEGER
      LANGUAGE sql AS 'SELECT 1';
    SELECT COALESCE(array_to_string(proacl, ' '), 'NULL = built-in default: owner + PUBLIC')
    INTO v_acl FROM pg_proc WHERE oid = f::regprocedure;
    SELECT string_agg(pg_get_userbyid(a.grantee), ',') INTO v_direct
    FROM pg_proc p, aclexplode(p.proacl) a
    WHERE p.oid = f::regprocedure AND a.grantee <> 0 AND a.grantee <> p.proowner;
    RAISE NOTICE '%', format('MATRIX probe acl=[%s] PUBLIC=%s anon=%s authenticated=%s service_role=%s',
      v_acl,
      has_function_privilege('public', f, 'EXECUTE'), has_function_privilege('anon', f, 'EXECUTE'),
      has_function_privilege('authenticated', f, 'EXECUTE'), has_function_privilege('service_role', f, 'EXECUTE'));

    -- documented default: PUBLIC can execute; anon/authenticated/service_role
    -- have no direct entries (the schema-scoped REVOKE did remove those) and
    -- reach it only through PUBLIC
    ASSERT has_function_privilege('public', f, 'EXECUTE'),
      'PostgreSQL default changed: PUBLIC no longer gets EXECUTE (update this test and CLAUDE.md)';
    ASSERT v_direct IS NULL, 'schema default privileges granted EXECUTE directly to: ' || v_direct;

    -- (b) the list check reports a function missing from the matrix
    v_list := t.function_list_problems();
    ASSERT v_list LIKE '%zz_default_privilege_probe()%', 'list check did not report the probe: ' || COALESCE(v_list, '<none>');

    -- (c) listed in the matrix (no callers) but without an explicit REVOKE:
    -- the privilege check reports it because PUBLIC can execute it
    INSERT INTO t.expected_functions VALUES (f, 'rpc', false, false, false, false);
    ASSERT t.function_list_problems() IS NULL, 'probe still unlisted';
    v_priv := t.function_privilege_problems();
    ASSERT v_priv LIKE '%zz_default_privilege_probe()%PUBLIC=t%',
      'privilege check did not report the probe''s PUBLIC EXECUTE: ' || COALESCE(v_priv, '<none>');

    -- (d) the required pattern (explicit REVOKE beside the definition, and
    -- search_path = '') clears both checks
    REVOKE ALL ON FUNCTION public.zz_default_privilege_probe() FROM PUBLIC, anon, authenticated, service_role;
    ALTER FUNCTION public.zz_default_privilege_probe() SET search_path = '';
    v_priv_fixed := t.function_privilege_problems();
    ASSERT v_priv_fixed IS NULL, 'explicit REVOKE did not satisfy the matrix: ' || v_priv_fixed;

    RAISE EXCEPTION USING ERRCODE = 'T0001', MESSAGE = 'rollback';
  EXCEPTION WHEN SQLSTATE 'T0001' THEN NULL;
  END;

  ASSERT to_regprocedure(f) IS NULL, 'probe function leaked';
  ASSERT NOT EXISTS (SELECT 1 FROM t.expected_functions WHERE sig = f), 'probe matrix row leaked';
  ASSERT t.function_list_problems() IS NULL AND t.function_privilege_problems() IS NULL,
    'matrix not clean after the probe';
  PERFORM t.pass('new function without grants: PUBLIC EXECUTE default documented; the matrix checks report it until REVOKE/GRANT is added');
END $$;

-- 15: tables and sequences created later by postgres in public get no
-- privileges for PUBLIC, anon, authenticated or service_role (the
-- ALTER DEFAULT PRIVILEGES ... ON TABLES / ON SEQUENCES in 001). Checked in
-- the catalog and with a probe table and sequence in a rolled-back
-- subtransaction.
DO $$
DECLARE
  v_bad TEXT;
  r TEXT;
  p TEXT;
BEGIN
  PERFORM t.become('postgres');

  SELECT string_agg(format('%s %s -> %s', pg_get_userbyid(d.defaclrole), d.defaclobjtype,
                           pg_get_userbyid(a.grantee)), ', ') INTO v_bad
  FROM pg_default_acl d JOIN pg_namespace n ON n.oid = d.defaclnamespace,
       aclexplode(d.defaclacl) a
  WHERE n.nspname = 'public' AND pg_get_userbyid(d.defaclrole) = 'postgres'
    AND d.defaclobjtype IN ('r', 'S')
    AND (a.grantee = 0 OR pg_get_userbyid(a.grantee) IN ('anon', 'authenticated', 'service_role'));
  ASSERT v_bad IS NULL, 'postgres default ACLs in public still grant tables/sequences to: ' || v_bad;

  BEGIN
    CREATE TABLE public.zz_default_privilege_probe_t (id INTEGER);
    CREATE SEQUENCE public.zz_default_privilege_probe_s;
    FOREACH r IN ARRAY ARRAY['public', 'anon', 'authenticated', 'service_role'] LOOP
      FOREACH p IN ARRAY ARRAY['SELECT', 'INSERT', 'UPDATE', 'DELETE', 'TRUNCATE', 'REFERENCES', 'TRIGGER'] LOOP
        ASSERT NOT has_table_privilege(r, 'public.zz_default_privilege_probe_t', p),
          format('%s has %s on a new table by default', r, p);
      END LOOP;
      ASSERT NOT has_any_column_privilege(r, 'public.zz_default_privilege_probe_t', 'SELECT,INSERT,UPDATE,REFERENCES'),
        format('%s has column privileges on a new table by default', r);
      FOREACH p IN ARRAY ARRAY['USAGE', 'SELECT', 'UPDATE'] LOOP
        ASSERT NOT has_sequence_privilege(r, 'public.zz_default_privilege_probe_s', p),
          format('%s has %s on a new sequence by default', r, p);
      END LOOP;
    END LOOP;
    RAISE EXCEPTION USING ERRCODE = 'T0001', MESSAGE = 'rollback';
  EXCEPTION WHEN SQLSTATE 'T0001' THEN NULL;
  END;

  ASSERT to_regclass('public.zz_default_privilege_probe_t') IS NULL
     AND to_regclass('public.zz_default_privilege_probe_s') IS NULL, 'probe table/sequence leaked';
  PERFORM t.pass('new tables and sequences in public get no privileges for PUBLIC, anon, authenticated or service_role by default');
END $$;
