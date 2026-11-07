-- COLLECTION EVIDENCE STORAGE (docs/demo-plan.md, section 2)
--
-- Photos live in the private collection-evidence bucket, one object per
-- photo, at exactly
--
--   {collector_uid}/{client_record_id}/{photo_uuid}.jpg
--
-- with every UUID in lowercase canonical form (as Postgres prints it) and
-- no other segments, so ".." or extra folders can never match. The
-- collection row must exist (and be pending) before its photo is uploaded;
-- the collection_evidence row is inserted after the upload.
--
--   upload (INSERT)  only an active collector, into their own folder, for
--                    their own pending collection
--   read (SELECT)    the owning collector, and reviewers who pass
--                    can_review_site() for the collection's site (site
--                    managers, active admins). Recyclers never.
--   update, delete   nobody (no policies). Overwrites (upsert) are refused
--                    because they need UPDATE.
--
-- The bucket enforces JPEG only and a 2 MB limit in the Storage API; the
-- policies enforce the .jpg name. Managers view photos through short-lived
-- signed URLs (which require SELECT).

-- BUCKET
-- Upsert so a hand-created bucket of the same id is brought to this
-- configuration.
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES ('collection-evidence', 'collection-evidence', false, 2097152, ARRAY['image/jpeg'])
ON CONFLICT (id) DO UPDATE
SET
  name = EXCLUDED.name,
  public = EXCLUDED.public,
  file_size_limit = EXCLUDED.file_size_limit,
  allowed_mime_types = EXCLUDED.allowed_mime_types;

-- PATH CHECK
-- True only for exactly {p_collector_id}/{p_client_record_id}/{uuid}.jpg.
-- The two ids come from a collection_logs row, never from the path, so they
-- are canonical lowercase UUIDs and contain no regex metacharacters. Pure
-- function (no table access): the callers check ownership and status.
CREATE OR REPLACE FUNCTION public.is_evidence_object_path(
  p_path TEXT,
  p_collector_id UUID,
  p_client_record_id UUID
)
RETURNS BOOLEAN
LANGUAGE sql
IMMUTABLE
SET search_path = ''
AS $$
  SELECT COALESCE(
    p_path ~ (
      '^' || p_collector_id::text
      || '/' || p_client_record_id::text
      || '/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.jpg$'
    ),
    false
  );
$$;

-- Called from RLS policies, which run as the signed-in user.
REVOKE ALL ON FUNCTION public.is_evidence_object_path(TEXT, UUID, UUID)
  FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.is_evidence_object_path(TEXT, UUID, UUID)
  TO authenticated;

-- STORAGE OBJECT POLICIES
-- Every policy on storage.objects applies to all buckets, so each one is
-- limited to this bucket first. Policies run as the caller: the
-- collection_logs and profiles lookups are also limited by their own RLS
-- (a collector sees only their own collections and profile).

-- Upload: the path's first two segments must be the caller's own id and the
-- client_record_id of one of the caller's pending collections, and the
-- caller must be an active collector.
CREATE POLICY collection_evidence_objects_insert
  ON storage.objects FOR INSERT TO authenticated
  WITH CHECK (
    bucket_id = 'collection-evidence'
    AND EXISTS (
      SELECT 1
      FROM public.collection_logs AS c
      JOIN public.profiles AS p ON p.id = c.collector_id
      WHERE c.collector_id = (SELECT auth.uid())
        AND c.client_record_id::text = split_part(objects.name, '/', 2)
        AND c.status = 'pending'::public.collection_status
        AND p.role = 'collector'::public.user_role
        AND p.is_active
        AND public.is_evidence_object_path(objects.name, c.collector_id, c.client_record_id)
    )
  );

-- Read (download, signed URLs, listing): the owning collector, or a
-- reviewer of the collection's site. Text comparisons, not UUID casts, so
-- an object name of any shape can never raise an error here.
CREATE POLICY collection_evidence_objects_select
  ON storage.objects FOR SELECT TO authenticated
  USING (
    bucket_id = 'collection-evidence'
    AND EXISTS (
      SELECT 1
      FROM public.collection_logs AS c
      WHERE c.collector_id::text = split_part(objects.name, '/', 1)
        AND c.client_record_id::text = split_part(objects.name, '/', 2)
        AND public.is_evidence_object_path(objects.name, c.collector_id, c.client_record_id)
        AND (
          c.collector_id = (SELECT auth.uid())
          OR public.can_review_site(c.site_id)
        )
    )
  );

-- No UPDATE or DELETE policy for collection-evidence: objects cannot be
-- overwritten, moved or deleted by any client.

-- EVIDENCE ROWS
-- Same rules as the upload, plus: the object must already exist in the
-- bucket at exactly storage_path, and the row must say image/jpeg. The
-- object lookup runs as the collector, who can see their own objects
-- through collection_evidence_objects_select.
CREATE POLICY collectors_add_evidence
  ON public.collection_evidence FOR INSERT TO authenticated
  WITH CHECK (
    content_type = 'image/jpeg'
    AND EXISTS (
      SELECT 1
      FROM public.collection_logs AS c
      JOIN public.profiles AS p ON p.id = c.collector_id
      WHERE c.id = collection_id
        AND c.collector_id = (SELECT auth.uid())
        AND c.status = 'pending'::public.collection_status
        AND p.role = 'collector'::public.user_role
        AND p.is_active
        AND public.is_evidence_object_path(storage_path, c.collector_id, c.client_record_id)
    )
    AND EXISTS (
      SELECT 1
      FROM storage.objects AS o
      WHERE o.bucket_id = 'collection-evidence'
        AND o.name = storage_path
    )
  );
