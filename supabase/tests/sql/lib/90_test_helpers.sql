-- Shared test helpers. Applied to the template database after the
-- migrations and seed. Everything lives in schema t, outside public, so it
-- cannot affect what the migrations grant.
--
-- Conventions
--   * Each test is one top-level DO block ending in PERFORM t.pass('...').
--     run.sh counts the t.pass calls in a suite file as the plan, and the
--     PASS notices as passed tests.
--   * Fixture and ground-truth helpers are SECURITY DEFINER (owner
--     postgres) so they work whatever role the test is acting as, and read
--     the real state without RLS.
--   * Role helpers (t.become, t.as_user, t.revoke_as) use SET LOCAL ROLE, so
--     they last until the end of the current (sub)transaction.
--   * Peer helpers open a second database session through dblink, for
--     deterministic lock tests: the test session holds a lock, the peer is
--     either refused by lock_timeout or observed blocked (pg_blocking_pids)
--     before the test commits or rolls back.

CREATE SCHEMA t;
CREATE EXTENSION dblink WITH SCHEMA t;
GRANT USAGE ON SCHEMA t TO anon, authenticated, service_role;

CREATE TABLE t.ctx (k TEXT PRIMARY KEY, v UUID NOT NULL);
CREATE TABLE t.peers (name TEXT PRIMARY KEY, pid INTEGER NOT NULL);

-- ------------------------------------------------------------ reporting
CREATE FUNCTION t.pass(p_name TEXT) RETURNS VOID
LANGUAGE plpgsql AS $$
BEGIN
  RAISE NOTICE 'PASS: %', p_name;
END $$;

-- ------------------------------------------------------------ fixtures
CREATE FUNCTION t.put(p_k TEXT, p_v UUID) RETURNS UUID
LANGUAGE sql SECURITY DEFINER SET search_path = pg_catalog AS $$
  INSERT INTO t.ctx (k, v) VALUES (p_k, p_v)
  ON CONFLICT (k) DO UPDATE SET v = EXCLUDED.v
  RETURNING v
$$;

CREATE FUNCTION t.id(p_k TEXT) RETURNS UUID
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = pg_catalog AS $$
DECLARE v_id UUID;
BEGIN
  SELECT c.v INTO v_id FROM t.ctx AS c WHERE c.k = p_k;
  IF v_id IS NULL THEN
    RAISE EXCEPTION 'test fixture "%" is not set', p_k;
  END IF;
  RETURN v_id;
END $$;

-- Run arbitrary SQL as the owner (ground-truth setup and tampering).
CREATE FUNCTION t.as_owner(p_sql TEXT) RETURNS VOID
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog AS $$
BEGIN
  EXECUTE p_sql;
END $$;

CREATE FUNCTION t.mkuser(
  p_k TEXT, p_email TEXT, p_confirmed BOOLEAN DEFAULT FALSE
) RETURNS UUID
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog AS $$
DECLARE v_id UUID;
BEGIN
  INSERT INTO auth.users (email, email_confirmed_at)
  VALUES (p_email, CASE WHEN p_confirmed THEN now() END)
  RETURNING id INTO v_id;
  RETURN t.put(p_k, v_id);
END $$;

CREATE FUNCTION t.confirm(p_user UUID) RETURNS VOID
LANGUAGE sql SECURITY DEFINER SET search_path = pg_catalog AS $$
  UPDATE auth.users SET email_confirmed_at = now() WHERE id = p_user
$$;

CREATE FUNCTION t.set_profile(
  p_user UUID, p_role public.user_role, p_active BOOLEAN
) RETURNS VOID
LANGUAGE sql SECURITY DEFINER SET search_path = pg_catalog AS $$
  UPDATE public.profiles SET role = p_role, is_active = p_active
  WHERE id = p_user
$$;

CREATE FUNCTION t.assign(p_user UUID, p_site UUID) RETURNS VOID
LANGUAGE sql SECURITY DEFINER SET search_path = pg_catalog AS $$
  INSERT INTO public.user_sites (user_id, site_id) VALUES (p_user, p_site)
$$;

CREATE FUNCTION t.site(p_n INTEGER) RETURNS UUID
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = pg_catalog AS $$
DECLARE v_id UUID;
BEGIN
  SELECT s.id INTO v_id FROM public.sites AS s
  WHERE s.name = 'TEST Site ' || p_n;
  IF v_id IS NULL THEN
    RAISE EXCEPTION 'seed site % is missing', p_n;
  END IF;
  RETURN v_id;
END $$;

CREATE FUNCTION t.sorted(p UUID[]) RETURNS UUID[]
LANGUAGE sql IMMUTABLE AS $$
  SELECT COALESCE(array_agg(x ORDER BY x), '{}') FROM unnest(p) AS x
$$;

CREATE FUNCTION t.sites_of(p_user UUID) RETURNS UUID[]
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog AS $$
  SELECT COALESCE(array_agg(site_id ORDER BY site_id), '{}')
  FROM public.user_sites WHERE user_id = p_user
$$;

CREATE FUNCTION t.profile(p_user UUID) RETURNS public.profiles
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog AS $$
  SELECT * FROM public.profiles WHERE id = p_user
$$;

-- ------------------------------------------------------------ invitations
CREATE FUNCTION t.h(p_code TEXT) RETURNS TEXT
LANGUAGE sql IMMUTABLE AS $$
  SELECT encode(sha256(convert_to(p_code, 'UTF8')), 'hex')
$$;

CREATE FUNCTION t.inv(p_id UUID) RETURNS public.invitations
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog AS $$
  SELECT * FROM public.invitations WHERE id = p_id
$$;

CREATE FUNCTION t.status(p_id UUID) RETURNS TEXT
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog AS $$
  SELECT status FROM public.invitations WHERE id = p_id
$$;

CREATE FUNCTION t.attempts(p_id UUID) RETURNS INTEGER
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog AS $$
  SELECT failed_attempts FROM public.invitations WHERE id = p_id
$$;

CREATE FUNCTION t.pending_count(p_user UUID) RETURNS BIGINT
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog AS $$
  SELECT count(*) FROM public.invitations
  WHERE auth_user_id = p_user AND status = 'pending'
$$;

CREATE FUNCTION t.inv_count(p_user UUID) RETURNS BIGINT
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog AS $$
  SELECT count(*) FROM public.invitations WHERE auth_user_id = p_user
$$;

CREATE FUNCTION t.inv_by_hash(p_hash TEXT) RETURNS UUID
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog AS $$
  SELECT id FROM public.invitations WHERE code_hash = p_hash
$$;

CREATE FUNCTION t.max_pending_per_user() RETURNS BIGINT
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog AS $$
  SELECT COALESCE(max(n), 0) FROM (
    SELECT count(*) AS n FROM public.invitations
    WHERE status = 'pending' GROUP BY auth_user_id) AS s
$$;

CREATE FUNCTION t.expire(p_id UUID) RETURNS VOID
LANGUAGE sql SECURITY DEFINER SET search_path = pg_catalog AS $$
  UPDATE public.invitations SET expires_at = now() - interval '1 second'
  WHERE id = p_id
$$;

-- verify_invitation_code as the CURRENT role (not definer), as jsonb.
CREATE FUNCTION t.v(p_email TEXT, p_code TEXT) RETURNS JSONB
LANGUAGE sql AS $$
  SELECT to_jsonb(r)
  FROM public.verify_invitation_code(p_email, t.h(p_code)) AS r
$$;

-- ------------------------------------------------------------ acting roles
-- Switch the current transaction to a role. For 'authenticated' pass the
-- user id that auth.uid() should return (NULL = no JWT subject).
CREATE FUNCTION t.become(p_role TEXT, p_user UUID DEFAULT NULL) RETURNS VOID
LANGUAGE plpgsql AS $$
BEGIN
  PERFORM set_config('request.jwt.claim.sub', COALESCE(p_user::text, ''), true);
  EXECUTE format('SET LOCAL ROLE %I', p_role);
END $$;

CREATE FUNCTION t.as_user(p_user UUID) RETURNS VOID
LANGUAGE sql AS $$
  SELECT t.become('authenticated', p_user)
$$;

-- Call revoke_invitation as a signed-in user, then return to the caller's
-- role and JWT subject.
CREATE FUNCTION t.revoke_as(p_inv UUID, p_user UUID) RETURNS UUID
LANGUAGE plpgsql AS $$
DECLARE
  v_prev_role TEXT := current_user;
  v_prev_sub TEXT := current_setting('request.jwt.claim.sub', true);
  v_result UUID;
BEGIN
  PERFORM t.become('authenticated', p_user);
  v_result := public.revoke_invitation(p_inv);
  EXECUTE format('SET LOCAL ROLE %I', v_prev_role);
  PERFORM set_config('request.jwt.claim.sub', COALESCE(v_prev_sub, ''), true);
  RETURN v_result;
END $$;

-- ------------------------------------------------------------ peer sessions
CREATE FUNCTION t.peer_open(
  p_name TEXT, p_role TEXT DEFAULT 'postgres', p_user UUID DEFAULT NULL
) RETURNS INTEGER
LANGUAGE plpgsql AS $$
DECLARE v_pid INTEGER;
BEGIN
  PERFORM t.dblink_connect(p_name, format(
    'host=127.0.0.1 port=%s dbname=%s user=postgres application_name=%s',
    current_setting('port'), current_database(), 'takalex_peer_' || p_name));
  IF p_role <> 'postgres' THEN
    PERFORM t.dblink_exec(p_name, format('SET ROLE %I', p_role));
  END IF;
  IF p_user IS NOT NULL THEN
    PERFORM t.dblink_exec(p_name, format(
      'SET request.jwt.claim.sub = %L', p_user));
  END IF;
  SELECT x.pid INTO v_pid
  FROM t.dblink(p_name, 'SELECT pg_backend_pid()') AS x(pid INTEGER);
  INSERT INTO t.peers (name, pid) VALUES (p_name, v_pid)
  ON CONFLICT (name) DO UPDATE SET pid = EXCLUDED.pid;
  RETURN v_pid;
END $$;

CREATE FUNCTION t.peer_close(p_name TEXT) RETURNS VOID
LANGUAGE plpgsql AS $$
BEGIN
  PERFORM t.dblink_disconnect(p_name);
  DELETE FROM t.peers WHERE name = p_name;
END $$;

-- Send one statement returning a single text column (or nothing).
CREATE FUNCTION t.peer_send(p_name TEXT, p_sql TEXT) RETURNS VOID
LANGUAGE plpgsql AS $$
BEGIN
  IF t.dblink_send_query(p_name, p_sql) <> 1 THEN
    RAISE EXCEPTION 'could not send query to peer %', p_name;
  END IF;
END $$;

-- Wait until the peer is blocked by THIS session's locks. Polls live lock
-- state; correctness never depends on timing. The deadline only stops a
-- broken test from hanging forever. Fails if the peer finishes without
-- ever blocking (the test's premise was wrong).
CREATE FUNCTION t.peer_wait_blocked(
  p_name TEXT, p_safety_timeout INTERVAL DEFAULT '10 minutes'
) RETURNS VOID
LANGUAGE plpgsql AS $$
DECLARE
  v_pid INTEGER;
  v_deadline TIMESTAMPTZ := clock_timestamp() + p_safety_timeout;
BEGIN
  SELECT p.pid INTO STRICT v_pid FROM t.peers AS p WHERE p.name = p_name;
  LOOP
    IF pg_blocking_pids(v_pid) @> ARRAY[pg_backend_pid()] THEN
      RETURN;
    END IF;
    IF t.dblink_is_busy(p_name) = 0 THEN
      RAISE EXCEPTION 'peer % finished without waiting for our lock', p_name;
    END IF;
    IF clock_timestamp() > v_deadline THEN
      RAISE EXCEPTION 'peer % never blocked (safety timeout)', p_name;
    END IF;
    PERFORM pg_sleep(0.01);
  END LOOP;
END $$;

-- Collect the peer's result: 'OK:<value>' or 'ERROR:<sqlstate>:<message>'.
CREATE FUNCTION t.peer_result(p_name TEXT) RETURNS TEXT
LANGUAGE plpgsql
SET client_min_messages = warning
AS $$
DECLARE v_value TEXT;
BEGIN
  BEGIN
    SELECT x.v INTO v_value
    FROM t.dblink_get_result(p_name, true) AS x(v TEXT);
  EXCEPTION WHEN OTHERS THEN
    PERFORM 1 FROM t.dblink_get_result(p_name, false) AS x(v TEXT);
    RETURN 'ERROR:' || SQLSTATE || ':' || SQLERRM;
  END;
  PERFORM 1 FROM t.dblink_get_result(p_name, false) AS x(v TEXT);
  RETURN 'OK:' || COALESCE(v_value, '<null>');
END $$;

-- Run one statement on the peer with a lock_timeout and return its result.
CREATE FUNCTION t.peer_try(p_name TEXT, p_sql TEXT, p_lock_timeout TEXT)
RETURNS TEXT
LANGUAGE plpgsql AS $$
DECLARE v_result TEXT;
BEGIN
  PERFORM t.dblink_exec(p_name, format('SET lock_timeout = %L', p_lock_timeout));
  PERFORM t.peer_send(p_name, p_sql);
  v_result := t.peer_result(p_name);
  PERFORM t.dblink_exec(p_name, 'RESET lock_timeout');
  RETURN v_result;
END $$;
