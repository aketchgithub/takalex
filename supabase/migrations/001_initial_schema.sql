CREATE SCHEMA IF NOT EXISTS extensions;
CREATE EXTENSION IF NOT EXISTS postgis WITH SCHEMA extensions;

CREATE TYPE public.user_role AS ENUM ('collector', 'admin', 'recycler');
CREATE TYPE public.material_type AS ENUM ('PET', 'HDPE', 'LDPE', 'MIXED');
CREATE TYPE public.collection_status AS ENUM ('pending', 'approved', 'paid');

CREATE TABLE public.sites (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  location extensions.geography(POINT, 4326) NOT NULL,
  active BOOLEAN DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE public.profiles (
  id UUID PRIMARY KEY REFERENCES auth.users(id),
  full_name TEXT,
  phone TEXT,
  role public.user_role NOT NULL DEFAULT 'collector',
  site_id UUID REFERENCES public.sites(id),
  group_id UUID,
  is_active BOOLEAN DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE public.sme_groups (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  site_id UUID REFERENCES public.sites(id),
  leader_id UUID REFERENCES public.profiles(id),
  member_count INT DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

ALTER TABLE public.profiles
  ADD CONSTRAINT profiles_group_id_fkey
  FOREIGN KEY (group_id) REFERENCES public.sme_groups(id);

CREATE TABLE public.collection_logs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  collector_id UUID REFERENCES public.profiles(id),
  group_id UUID REFERENCES public.sme_groups(id),
  site_id UUID REFERENCES public.sites(id),
  material public.material_type NOT NULL,
  weight_kg DECIMAL(10,2) NOT NULL,
  status public.collection_status DEFAULT 'pending',
  price_per_kg DECIMAL(8,2),
  total_payout DECIMAL(10,2)
    GENERATED ALWAYS AS (weight_kg * price_per_kg) STORED,
  logged_at TIMESTAMPTZ DEFAULT NOW(),
  synced_at TIMESTAMPTZ
);

ALTER TABLE public.sites ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.sme_groups ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.collection_logs ENABLE ROW LEVEL SECURITY;

CREATE FUNCTION public.is_active_admin()
RETURNS BOOLEAN
LANGUAGE SQL
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.profiles
    WHERE id = (SELECT auth.uid())
      AND role = 'admin'::public.user_role
      AND is_active
  );
$$;

REVOKE ALL ON FUNCTION public.is_active_admin() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.is_active_admin() TO authenticated;

CREATE POLICY "collector_own_logs" ON public.collection_logs
  FOR SELECT TO authenticated
  USING (
    collector_id = (SELECT auth.uid())
    OR (SELECT public.is_active_admin())
  );
