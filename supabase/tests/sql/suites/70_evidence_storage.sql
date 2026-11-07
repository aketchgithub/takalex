-- EVIDENCE STORAGE POLICIES (migration 006) against the storage stand-in.
-- storage.objects here is a stub table (lib/00_supabase_stubs.sql), but the
-- RLS policies on it are the real ones and PostgreSQL evaluates them. The
-- Storage API itself (MIME and size limits, signed URLs, upsert, delete) is
-- not covered here; see supabase/tests/local-stack/functions.mjs.
SET client_min_messages = notice;

DO $$ BEGIN
  PERFORM t.mkuser('admin', 'admin@example.test', true);
  PERFORM public.bootstrap_first_admin('admin@example.test');
  PERFORM t.mkuser('c1', 'c1@example.test', true);      -- collector, site 1
  PERFORM t.set_profile(t.id('c1'), 'collector', true);
  PERFORM t.assign(t.id('c1'), t.site(1));
  PERFORM t.mkuser('c2', 'c2@example.test', true);      -- collector, site 1
  PERFORM t.set_profile(t.id('c2'), 'collector', true);
  PERFORM t.assign(t.id('c2'), t.site(1));
  PERFORM t.mkuser('m1', 'm1@example.test', true);      -- manager, site 1
  PERFORM t.set_profile(t.id('m1'), 'site_manager', true);
  PERFORM t.assign(t.id('m1'), t.site(1));
  PERFORM t.mkuser('m2', 'm2@example.test', true);      -- manager, site 2
  PERFORM t.set_profile(t.id('m2'), 'site_manager', true);
  PERFORM t.assign(t.id('m2'), t.site(2));
  PERFORM t.mkuser('m_off', 'moff@example.test', true); -- inactive manager, site 1
  PERFORM t.set_profile(t.id('m_off'), 'site_manager', false);
  PERFORM t.assign(t.id('m_off'), t.site(1));
  PERFORM t.mkuser('r1', 'r1@example.test', true);      -- recycler, site 1
  PERFORM t.set_profile(t.id('r1'), 'recycler', true);
  PERFORM t.assign(t.id('r1'), t.site(1));
END $$;

-- A pending collection for p_user (as that user), returning its id; the
-- client_record_id is stored under p_key.
CREATE FUNCTION t.collect(p_user UUID, p_key TEXT) RETURNS UUID
LANGUAGE plpgsql AS $$
DECLARE v_rec UUID := gen_random_uuid(); v_id UUID;
BEGIN
  PERFORM t.as_user(p_user);
  INSERT INTO public.collection_logs (client_record_id, site_id, material_code, reported_weight_kg)
  VALUES (v_rec, t.site(1), 'PET', 2);
  PERFORM t.become('postgres');
  SELECT id INTO STRICT v_id FROM public.collection_logs
  WHERE collector_id = p_user AND client_record_id = v_rec;
  PERFORM t.put(p_key, v_rec);
  RETURN t.put(p_key || '_id', v_id);
END $$;

-- Upload as p_user (an INSERT into storage.objects under RLS). Returns
-- 'ok' or 'denied'.
CREATE FUNCTION t.upload_as(p_user UUID, p_name TEXT, p_bucket TEXT DEFAULT 'collection-evidence')
RETURNS TEXT LANGUAGE plpgsql AS $$
BEGIN
  BEGIN
    IF p_user IS NULL THEN
      PERFORM t.become('anon');
    ELSE
      PERFORM t.as_user(p_user);
    END IF;
    INSERT INTO storage.objects (bucket_id, name, owner_id) VALUES (p_bucket, p_name, p_user::text);
    PERFORM t.become('postgres');
    RETURN 'ok';
  EXCEPTION WHEN insufficient_privilege THEN
    RETURN 'denied';
  END;
END $$;

-- How many of the given object names p_user can see (NULL = anon).
CREATE FUNCTION t.visible_as(p_user UUID, p_names TEXT[]) RETURNS BIGINT
LANGUAGE plpgsql AS $$
DECLARE n BIGINT;
BEGIN
  IF p_user IS NULL THEN
    PERFORM t.become('anon');
  ELSE
    PERFORM t.as_user(p_user);
  END IF;
  SELECT count(*) INTO n FROM storage.objects
  WHERE bucket_id = 'collection-evidence' AND name = ANY (p_names);
  PERFORM t.become('postgres');
  RETURN n;
END $$;

-- 1: the bucket
DO $$
DECLARE b storage.buckets;
BEGIN
  SELECT * INTO STRICT b FROM storage.buckets WHERE id = 'collection-evidence';
  ASSERT b.name = 'collection-evidence' AND b.public = false, 'not private';
  ASSERT b.file_size_limit = 2097152, 'size limit ' || b.file_size_limit;
  ASSERT b.allowed_mime_types = ARRAY['image/jpeg'], 'mime types ' || b.allowed_mime_types::text;
  PERFORM t.pass('bucket collection-evidence: private, 2 MB (2097152 bytes), image/jpeg only');
END $$;

-- 2: upload rules
DO $$
DECLARE v_rec UUID; v_dir TEXT; v_name TEXT; v_bad TEXT; v_r TEXT;
  v_c2_rec UUID; v_reviewed_rec UUID; v_reviewed UUID;
BEGIN
  PERFORM t.collect(t.id('c1'), 'c1_rec');
  v_rec := t.id('c1_rec');
  v_dir := t.id('c1') || '/' || v_rec || '/';
  PERFORM t.collect(t.id('c2'), 'c2_rec');
  v_c2_rec := t.id('c2_rec');
  v_reviewed := t.collect(t.id('c1'), 'c1_reviewed');
  v_reviewed_rec := t.id('c1_reviewed');
  PERFORM t.as_user(t.id('m1'));
  PERFORM public.review_collection(v_reviewed, false, NULL, 'unreadable');
  PERFORM t.become('postgres');

  -- the owning active collector, exact path, own pending collection
  v_name := v_dir || gen_random_uuid() || '.jpg';
  ASSERT t.upload_as(t.id('c1'), v_name) = 'ok', 'valid upload refused';
  CREATE TABLE t.ok_objects (name TEXT);
  INSERT INTO t.ok_objects VALUES (v_name);

  -- wrong shapes, other folders, other or reviewed collections
  FOREACH v_bad IN ARRAY ARRAY[
    gen_random_uuid() || '.jpg',
    v_rec || '/' || gen_random_uuid() || '.jpg',
    t.id('c1') || '/' || gen_random_uuid() || '.jpg',
    v_dir || 'thumbs/' || gen_random_uuid() || '.jpg',
    v_dir || '../' || v_rec || '/' || gen_random_uuid() || '.jpg',
    t.id('c1') || '/' || v_rec || '/../' || gen_random_uuid() || '.jpg',
    '/' || v_dir || gen_random_uuid() || '.jpg',
    upper(v_dir) || gen_random_uuid() || '.jpg',
    v_dir || upper(gen_random_uuid()::text) || '.jpg',
    v_dir || gen_random_uuid() || '.png',
    v_dir || gen_random_uuid() || '.jpeg',
    v_dir || gen_random_uuid() || '.jpg/',
    v_dir || 'photo.jpg',
    t.id('c2') || '/' || v_rec || '/' || gen_random_uuid() || '.jpg',        -- someone else's folder
    t.id('c1') || '/' || v_c2_rec || '/' || gen_random_uuid() || '.jpg',     -- c2's collection
    t.id('c1') || '/' || gen_random_uuid() || '/' || gen_random_uuid() || '.jpg',  -- no such collection
    t.id('c1') || '/' || v_reviewed_rec || '/' || gen_random_uuid() || '.jpg'      -- reviewed
  ] LOOP
    v_r := t.upload_as(t.id('c1'), v_bad);
    ASSERT v_r = 'denied', 'c1 uploaded ' || v_bad;
  END LOOP;

  -- nobody else may upload into c1's folder for c1's collection
  FOREACH v_bad IN ARRAY ARRAY['c2', 'm1', 'r1', 'admin'] LOOP
    ASSERT t.upload_as(t.id(v_bad), v_dir || gen_random_uuid() || '.jpg') = 'denied', v_bad || ' uploaded';
  END LOOP;
  ASSERT t.upload_as(NULL, v_dir || gen_random_uuid() || '.jpg') = 'denied', 'anon uploaded';
  ASSERT t.upload_as(NULL, gen_random_uuid() || '.jpg') = 'denied', 'anon uploaded (any path)';

  -- an inactive collector cannot upload, even to their own pending collection
  PERFORM t.set_profile(t.id('c1'), 'collector', false);
  ASSERT t.upload_as(t.id('c1'), v_dir || gen_random_uuid() || '.jpg') = 'denied', 'inactive collector uploaded';
  PERFORM t.set_profile(t.id('c1'), 'collector', true);
  -- a collector who became a manager is no longer a collector
  PERFORM t.set_profile(t.id('c1'), 'site_manager', true);
  ASSERT t.upload_as(t.id('c1'), v_dir || gen_random_uuid() || '.jpg') = 'denied', 'non-collector uploaded';
  PERFORM t.set_profile(t.id('c1'), 'collector', true);

  ASSERT (SELECT count(*) FROM storage.objects) = 1, 'objects stored: ' || (SELECT count(*) FROM storage.objects);
  PERFORM t.pass('upload: only the active owning collector, exact {uid}/{client_record_id}/{uuid}.jpg, own pending collection; every other shape, folder, collection, role and anon refused');
END $$;

-- 3: read rules
DO $$
DECLARE v_names TEXT[]; u TEXT;
BEGIN
  SELECT array_agg(name) INTO v_names FROM t.ok_objects;
  -- also an object outside the policy's path shape (owner-inserted): never visible
  v_names := v_names || t.put_object(t.id('c1') || '/' || t.id('c1_rec') || '/stray.jpg');
  ASSERT t.visible_as(t.id('c1'), v_names) = 1, 'owner';
  ASSERT t.visible_as(t.id('m1'), v_names) = 1, 'site manager';
  ASSERT t.visible_as(t.id('admin'), v_names) = 1, 'admin';
  FOREACH u IN ARRAY ARRAY['c2', 'm2', 'm_off', 'r1'] LOOP
    ASSERT t.visible_as(t.id(u), v_names) = 0, u || ' sees evidence';
  END LOOP;
  ASSERT t.visible_as(NULL, v_names) = 0, 'anon sees evidence';
  -- once inactive, a manager loses access
  PERFORM t.set_profile(t.id('m1'), 'site_manager', false);
  ASSERT t.visible_as(t.id('m1'), v_names) = 0, 'inactive manager sees evidence';
  PERFORM t.set_profile(t.id('m1'), 'site_manager', true);
  PERFORM t.pass('read: owner, site manager of the site and admin only; other collector, other-site or inactive manager, recycler and anon see nothing; odd names never visible');
END $$;

-- 4: no update, no delete for anyone
DO $$
DECLARE u TEXT; n BIGINT; v_before JSONB;
BEGIN
  SELECT jsonb_agg(to_jsonb(o) ORDER BY id) INTO v_before FROM storage.objects o;
  FOREACH u IN ARRAY ARRAY['c1', 'm1', 'admin'] LOOP
    PERFORM t.as_user(t.id(u));
    UPDATE storage.objects SET name = name || '.moved' WHERE bucket_id = 'collection-evidence';
    GET DIAGNOSTICS n = ROW_COUNT;
    ASSERT n = 0, u || ' updated ' || n;
    DELETE FROM storage.objects WHERE bucket_id = 'collection-evidence';
    GET DIAGNOSTICS n = ROW_COUNT;
    ASSERT n = 0, u || ' deleted ' || n;
    PERFORM t.become('postgres');
  END LOOP;
  ASSERT (SELECT jsonb_agg(to_jsonb(o) ORDER BY id) FROM storage.objects o) = v_before, 'objects changed';
  PERFORM t.pass('no client can update (overwrite, move) or delete evidence objects');
END $$;

-- 5: the path check itself, and the policy catalogue
DO $$
DECLARE u UUID := gen_random_uuid(); r UUID := gen_random_uuid(); f UUID := gen_random_uuid();
  v_pols TEXT;
BEGIN
  ASSERT public.is_evidence_object_path(u || '/' || r || '/' || f || '.jpg', u, r);
  ASSERT NOT public.is_evidence_object_path(r || '/' || u || '/' || f || '.jpg', u, r), 'swapped ids';
  ASSERT NOT public.is_evidence_object_path(u || '/' || r || '/' || f || '.jpg' || E'\n', u, r), 'newline';
  ASSERT NOT public.is_evidence_object_path(u || '/' || r || '/' || f || 'x.jpg', u, r), 'suffix';
  ASSERT NOT public.is_evidence_object_path(NULL, u, r), 'NULL path';
  ASSERT NOT public.is_evidence_object_path(u || '/' || r || '/' || f || '.jpg', NULL, r), 'NULL collector';
  ASSERT NOT public.is_evidence_object_path(u || '/' || r || '/' || f || '.jpg', u, NULL), 'NULL record';

  SELECT string_agg(policyname || ':' || cmd || ':' || array_to_string(roles, ','), ' ' ORDER BY policyname)
  INTO v_pols FROM pg_policies WHERE schemaname = 'storage' AND tablename = 'objects';
  ASSERT v_pols = 'collection_evidence_objects_insert:INSERT:authenticated collection_evidence_objects_select:SELECT:authenticated',
    'storage.objects policies: ' || COALESCE(v_pols, '<none>');
  ASSERT NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'storage'
                     AND cmd IN ('UPDATE', 'DELETE', 'ALL')), 'update/delete policy on storage';
  SELECT string_agg(policyname || ':' || cmd, ' ' ORDER BY policyname) INTO v_pols
  FROM pg_policies WHERE schemaname = 'public' AND tablename = 'collection_evidence';
  ASSERT v_pols = 'collectors_add_evidence:INSERT evidence_read_permitted:SELECT', 'evidence policies: ' || v_pols;
  PERFORM t.pass('is_evidence_object_path matches only the exact shape (NULL-safe); storage.objects has exactly the INSERT and SELECT policies; collection_evidence has one INSERT and one SELECT policy');
END $$;
