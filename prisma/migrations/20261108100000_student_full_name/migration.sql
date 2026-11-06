-- A student's name is one field (8/11/2569), like teachers (title + name): students.first_name and
-- last_name become students.name = btrim(first_name || ' ' || last_name). The API's CohortStudent and
-- roster rows carry `name`; Submission.studentName is this name.

ALTER TABLE "students" ADD COLUMN "name" TEXT;
UPDATE "students" SET "name" = btrim("first_name" || ' ' || "last_name");
ALTER TABLE "students" ALTER COLUMN "name" SET NOT NULL;
ALTER TABLE "students" DROP COLUMN "first_name",
DROP COLUMN "last_name";

-- Not blank (Prisma doesn't model CHECK constraints; the API validates the same first)
ALTER TABLE "students" ADD CONSTRAINT "students_name_check" CHECK (btrim("name") <> '');
