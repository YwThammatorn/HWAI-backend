-- courses.code goes (12/11/2569): it was a copy of the course template's code (course → course_template_id →
-- code, a transitive dependency), copied when the section was made — so editing the code on the template left
-- old sections showing the old one. The API now reads the code from the template; a section without a
-- template has no code.
--
-- Stops (drops nothing) if a course's code differs from its template's, or a course without a template has a
-- code — that value exists nowhere else and would be lost.

DO $$
DECLARE r record;
BEGIN
  FOR r IN
    SELECT c."id", c."code", t."code" AS template_code
    FROM "courses" c LEFT JOIN "course_templates" t ON t."id" = c."course_template_id"
    WHERE c."code" IS NOT NULL AND (t."id" IS NULL OR c."code" IS DISTINCT FROM t."code")
    LIMIT 5
  LOOP
    RAISE NOTICE 'courses: % has code "%" but its template''s is "%"', r."id", r."code", coalesce(r.template_code, '(no template)');
  END LOOP;
  IF FOUND THEN
    RAISE EXCEPTION 'courses: a course''s code differs from its template''s (or it has a code but no template) — fix it before dropping courses.code';
  END IF;
END $$;

ALTER TABLE "courses" DROP COLUMN "code";
