-- One table for a course's staff (11/11/2569): course_teachers (the teachers an admin assigned to a section)
-- becomes section_roles rows with role 'teacher', next to the co-teachers and TAs. And a teacher account is
-- just a teacher: teachers.role and the teacher_role enum go.
--
-- - Stops if a teacher account still has role 'ta' (left over from an old screen): once course_teachers is a
--   'teacher' section role, that person would get a teacher's full access — fix the account first.
-- - A course_teachers row whose person already has a role in that course (a co-teacher, say) turns that row
--   into 'teacher' — the assigned teacher wins; its stored permissions are dropped (a teacher has them all).
--   How many is reported as a NOTICE.
-- - Every other course_teachers row becomes a new section role (created_at = assigned_at).

DO $$
DECLARE upgraded integer;
BEGIN
  IF EXISTS (SELECT 1 FROM "teachers" WHERE "role" = 'ta') THEN
    RAISE EXCEPTION 'teachers: an account still has role ''ta'' — a teacher account is a teacher; fix it (or make the person a student TA) first';
  END IF;

  UPDATE "section_roles" sr
  SET "role" = 'teacher', "permissions" = NULL, "updated_at" = CURRENT_TIMESTAMP
  FROM "course_teachers" ct
  WHERE sr."course_id" = ct."course_id" AND sr."user_id" = ct."teacher_id" AND sr."role" <> 'teacher';
  GET DIAGNOSTICS upgraded = ROW_COUNT;
  RAISE NOTICE 'section_roles: % role(s) of an assigned teacher in the same course became ''teacher''', upgraded;
END $$;

INSERT INTO "section_roles" ("id", "course_id", "user_id", "role", "permissions", "created_at", "updated_at")
SELECT gen_random_uuid()::text, ct."course_id", ct."teacher_id", 'teacher', NULL, ct."assigned_at", ct."assigned_at"
FROM "course_teachers" ct
WHERE NOT EXISTS (
  SELECT 1 FROM "section_roles" sr WHERE sr."course_id" = ct."course_id" AND sr."user_id" = ct."teacher_id"
);

DROP TABLE "course_teachers";

ALTER TABLE "teachers" DROP COLUMN "role";
DROP TYPE "teacher_role";
