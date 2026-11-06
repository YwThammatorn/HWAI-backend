-- Columns nothing used (7/11/2569):
--
-- - students.curriculum_version_id: never set or read — a section's program comes from its course's
--   curriculum (course → course template → curriculum version), not from the student.
-- - sessions.last_seen_at: written every few minutes, never read (no idle timeout, no session list).
-- - submissions.file_url: the old single-link field. New hand-ins already put the link in attachments too;
--   it was only read for rows from before attachments existed. Those rows get their link moved into
--   attachments first (same shape the frontend built for them: kind "link", source "url", id
--   "legacy-<submission id>"); a non-http(s) value (an old blob: URL) could never be reopened and is dropped.

DO $$
DECLARE moved integer;
BEGIN
  UPDATE "submissions"
  SET "attachments" = jsonb_build_array(jsonb_build_object(
        'id', 'legacy-' || "id", 'kind', 'link', 'name', "file_url", 'source', 'url', 'ref', "file_url"))
  WHERE "file_url" ~* '^https?://'
    AND ("attachments" IS NULL OR "attachments" = 'null'::jsonb OR "attachments" = '[]'::jsonb);
  GET DIAGNOSTICS moved = ROW_COUNT;
  RAISE NOTICE 'submissions: moved % legacy file_url link(s) into attachments', moved;
END $$;

ALTER TABLE "submissions" DROP COLUMN "file_url";

ALTER TABLE "students" DROP CONSTRAINT IF EXISTS "students_curriculum_version_id_fkey";
ALTER TABLE "students" DROP COLUMN "curriculum_version_id";

ALTER TABLE "sessions" DROP COLUMN "last_seen_at";
