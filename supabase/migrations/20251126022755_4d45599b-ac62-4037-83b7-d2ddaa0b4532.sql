-- Create storage bucket for avatars
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'avatars',
  'avatars',
  true,
  5242880, -- 5MB limit
  ARRAY['image/jpeg', 'image/png', 'image/webp', 'image/jpg']
);

-- Storage policies for avatars
CREATE POLICY "Avatar images are publicly accessible"
ON storage.objects
FOR SELECT
USING (bucket_id = 'avatars');

CREATE POLICY "Users can upload their own avatar"
ON storage.objects
FOR INSERT
WITH CHECK (
  bucket_id = 'avatars' 
  AND auth.uid()::text = (storage.foldername(name))[1]
);

CREATE POLICY "Users can update their own avatar"
ON storage.objects
FOR UPDATE
USING (
  bucket_id = 'avatars' 
  AND auth.uid()::text = (storage.foldername(name))[1]
);

CREATE POLICY "Users can delete their own avatar"
ON storage.objects
FOR DELETE
USING (
  bucket_id = 'avatars' 
  AND auth.uid()::text = (storage.foldername(name))[1]
);

-- Add notification preferences columns to profiles
ALTER TABLE public.profiles
ADD COLUMN IF NOT EXISTS notify_position_opened boolean DEFAULT true,
ADD COLUMN IF NOT EXISTS notify_position_closed boolean DEFAULT true,
ADD COLUMN IF NOT EXISTS notify_daily_summary boolean DEFAULT false,
ADD COLUMN IF NOT EXISTS notify_loss_alerts boolean DEFAULT true,
ADD COLUMN IF NOT EXISTS notify_bot_status boolean DEFAULT true;

-- Add index for faster queries
CREATE INDEX IF NOT EXISTS idx_profiles_notifications ON public.profiles(
  notify_position_opened, 
  notify_position_closed, 
  notify_daily_summary, 
  notify_loss_alerts, 
  notify_bot_status
);