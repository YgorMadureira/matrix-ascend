ALTER TABLE public.collaborators ADD COLUMN IF NOT EXISTS is_onboarding BOOLEAN DEFAULT FALSE;
ALTER TABLE public.collaborators ADD COLUMN IF NOT EXISTS admission_date DATE;
