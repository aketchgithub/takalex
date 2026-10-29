CREATE TYPE public.access_status AS ENUM ('submitted', 'reviewed', 'approved', 'invited', 'rejected');

CREATE TABLE public.access_requests (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  full_name TEXT NOT NULL,
  email TEXT,
  phone TEXT,
  role public.user_role NOT NULL DEFAULT 'collector',
  site_name TEXT,
  referral_source TEXT,
  status public.access_status NOT NULL DEFAULT 'submitted',
  created_at TIMESTAMPTZ DEFAULT NOW(),
  reviewed_by UUID REFERENCES auth.users(id),
  reviewed_at TIMESTAMPTZ,
  notes TEXT
);

CREATE TABLE public.invitations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  email TEXT,
  phone TEXT,
  invited_by UUID REFERENCES auth.users(id),
  role public.user_role NOT NULL DEFAULT 'collector',
  site_name TEXT,
  status TEXT NOT NULL DEFAULT 'pending',
  created_at TIMESTAMPTZ DEFAULT NOW(),
  accepted_at TIMESTAMPTZ,
  token TEXT UNIQUE
);

ALTER TABLE public.access_requests ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.invitations ENABLE ROW LEVEL SECURITY;

CREATE INDEX access_requests_status_idx ON public.access_requests (status);
CREATE INDEX invitations_status_idx ON public.invitations (status);

CREATE POLICY "public_submit_access_requests" ON public.access_requests
  FOR INSERT TO anon, authenticated
  WITH CHECK (true);

CREATE POLICY "admin_manage_access_requests" ON public.access_requests
  FOR ALL TO authenticated
  USING ((SELECT public.is_active_admin()))
  WITH CHECK ((SELECT public.is_active_admin()));

CREATE POLICY "admin_manage_invitations" ON public.invitations
  FOR ALL TO authenticated
  USING ((SELECT public.is_active_admin()))
  WITH CHECK ((SELECT public.is_active_admin()));
