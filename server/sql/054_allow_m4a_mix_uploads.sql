-- iPhone and Mac Safari record battle takes as MP4/AAC (.m4a). Let the private mix bucket accept them
-- alongside MP3, WAV and WebM. Safe to run more than once.
UPDATE storage.buckets
   SET allowed_mime_types = ARRAY['audio/mpeg','audio/wav','audio/x-wav','audio/webm','audio/mp4','audio/x-m4a','audio/m4a']
 WHERE id = 'battle-mixes';
