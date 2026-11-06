-- section_roles.permissions goes (13/11/2569): nothing ever set it (the frontend never called the endpoint, the
-- mock has none) — what a role may do comes from the role alone: a course's teacher and a co-teacher everything,
-- a TA none of the three permissions.
--
-- Stops (drops nothing) if any row has permissions set — someone's setting would be lost.

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM "section_roles" WHERE "permissions" IS NOT NULL) THEN
    RAISE EXCEPTION 'section_roles: % row(s) have permissions set — they would be lost; clear them deliberately first',
      (SELECT count(*) FROM "section_roles" WHERE "permissions" IS NOT NULL);
  END IF;
END $$;

ALTER TABLE "section_roles" DROP COLUMN "permissions";
