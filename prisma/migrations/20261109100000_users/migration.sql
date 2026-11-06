-- One users table for everyone who signs in (9/11/2569): the columns admins, teachers and students shared
-- (email, title, name, status, timestamps) move to users; admins / teachers / students become subtypes keyed by
-- user_id (= users.id). Sessions and section roles point at users.
--
-- Ids are kept: a teacher's user id is their teachers.id, a student's is their students.id, and an admin who is
-- no one else keeps admins.id — the frontend uses these ids (ManagedTeacher.id, CohortStudent.id, a section
-- role's accountId, URLs).
--
-- People with the same email in several tables become one user. Whose id (and title / name / status) the user
-- takes: teachers first, then students, then admins. Admins had no title or status: an admin who is no one else
-- gets no title and status "active"; for an admin who is also a teacher or student, the admin's own name is
-- dropped in favour of theirs (each such case is listed as a NOTICE when this runs).
--
-- Stops (does not merge) if an email belongs to both a teacher and a student, or if an admin's id is already
-- another person's id. section_roles.user_id = teacher_id or student_id; a session whose email has no user is
-- deleted.

DO $$
DECLARE r record;
BEGIN
  IF EXISTS (SELECT 1 FROM "teachers" t JOIN "students" s ON s."email" = t."email") THEN
    RAISE EXCEPTION 'users: an email belongs to both a teacher and a student — a teacher is never also a student; fix the accounts first';
  END IF;
  IF EXISTS (SELECT 1 FROM "teachers" t JOIN "students" s ON s."id" = t."id") THEN
    RAISE EXCEPTION 'users: a teacher and a student share an id — fix the accounts first';
  END IF;
  IF EXISTS (
    SELECT 1 FROM "admins" a
    WHERE NOT EXISTS (SELECT 1 FROM "teachers" t WHERE t."email" = a."email")
      AND NOT EXISTS (SELECT 1 FROM "students" s WHERE s."email" = a."email")
      AND (EXISTS (SELECT 1 FROM "teachers" t WHERE t."id" = a."id") OR EXISTS (SELECT 1 FROM "students" s WHERE s."id" = a."id"))
  ) THEN
    RAISE EXCEPTION 'users: an admin''s id is already another person''s id — fix the accounts first';
  END IF;
  FOR r IN
    SELECT a."email", a."name" AS admin_name, coalesce(t."name", s."name") AS kept_name
    FROM "admins" a
    LEFT JOIN "teachers" t ON t."email" = a."email"
    LEFT JOIN "students" s ON s."email" = a."email"
    WHERE coalesce(t."name", s."name") IS NOT NULL AND coalesce(t."name", s."name") <> a."name"
  LOOP
    RAISE NOTICE 'users: admin % — name "%" dropped, kept "%"', r."email", r.admin_name, r.kept_name;
  END LOOP;
END $$;

-- users
CREATE TABLE "users" (
    "id" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "title" TEXT,
    "name" TEXT NOT NULL,
    "status" "account_status" NOT NULL DEFAULT 'active',
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "users_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "users_email_key" ON "users"("email");

INSERT INTO "users" ("id", "email", "title", "name", "status", "created_at", "updated_at")
SELECT "id", "email", "title", "name", "status", "created_at", "updated_at" FROM "teachers";
INSERT INTO "users" ("id", "email", "title", "name", "status", "created_at", "updated_at")
SELECT "id", "email", "title", "name", "status", "created_at", "updated_at" FROM "students";
INSERT INTO "users" ("id", "email", "title", "name", "status", "created_at", "updated_at")
SELECT a."id", a."email", NULL, a."name", 'active', a."created_at", a."created_at"
FROM "admins" a WHERE NOT EXISTS (SELECT 1 FROM "users" u WHERE u."email" = a."email");

-- Moved to users (the old e-mail / name checks go with their columns)
ALTER TABLE "users" ADD CONSTRAINT "users_email_lower_check" CHECK ("email" = lower("email"));
ALTER TABLE "users" ADD CONSTRAINT "users_name_check" CHECK (btrim("name") <> '');

-- Foreign keys into the old ids go first; they come back pointing at user_id
ALTER TABLE "course_teachers" DROP CONSTRAINT "course_teachers_teacher_id_fkey";
ALTER TABLE "section_roles" DROP CONSTRAINT "section_roles_teacher_id_fkey";
ALTER TABLE "section_roles" DROP CONSTRAINT "section_roles_student_id_fkey";

-- admins: keyed by the user with their email
ALTER TABLE "admins" ADD COLUMN "user_id" TEXT;
UPDATE "admins" a SET "user_id" = u."id" FROM "users" u WHERE u."email" = a."email";
ALTER TABLE "admins" DROP CONSTRAINT "admins_pkey",
DROP COLUMN "id",
DROP COLUMN "email",
DROP COLUMN "name",
DROP COLUMN "created_at",
ALTER COLUMN "user_id" SET NOT NULL,
ADD CONSTRAINT "admins_pkey" PRIMARY KEY ("user_id");

-- teachers / students: their id is the user id
ALTER TABLE "teachers" RENAME COLUMN "id" TO "user_id";
ALTER TABLE "teachers" DROP COLUMN "email",
DROP COLUMN "title",
DROP COLUMN "name",
DROP COLUMN "status",
DROP COLUMN "created_at",
DROP COLUMN "updated_at";
ALTER TABLE "students" RENAME COLUMN "id" TO "user_id";
ALTER TABLE "students" DROP COLUMN "email",
DROP COLUMN "title",
DROP COLUMN "name",
DROP COLUMN "status",
DROP COLUMN "created_at",
DROP COLUMN "updated_at";

-- section roles: one user column (a TA is a student, a co-teacher a teacher — checked by the API)
ALTER TABLE "section_roles" ADD COLUMN "user_id" TEXT;
UPDATE "section_roles" SET "user_id" = coalesce("teacher_id", "student_id");
ALTER TABLE "section_roles" DROP CONSTRAINT "section_roles_one_account_check";
ALTER TABLE "section_roles" DROP COLUMN "teacher_id",
DROP COLUMN "student_id",
ALTER COLUMN "user_id" SET NOT NULL;
CREATE UNIQUE INDEX "section_roles_course_id_user_id_key" ON "section_roles"("course_id", "user_id");
CREATE INDEX "section_roles_user_id_idx" ON "section_roles"("user_id");

-- sessions: by user (deleting the account signs them out)
ALTER TABLE "sessions" ADD COLUMN "user_id" TEXT;
UPDATE "sessions" s SET "user_id" = u."id" FROM "users" u WHERE u."email" = s."email";
DELETE FROM "sessions" WHERE "user_id" IS NULL;
ALTER TABLE "sessions" DROP COLUMN "email",
ALTER COLUMN "user_id" SET NOT NULL;
CREATE INDEX "sessions_user_id_idx" ON "sessions"("user_id");

ALTER TABLE "admins" ADD CONSTRAINT "admins_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "teachers" ADD CONSTRAINT "teachers_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "students" ADD CONSTRAINT "students_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "course_teachers" ADD CONSTRAINT "course_teachers_teacher_id_fkey" FOREIGN KEY ("teacher_id") REFERENCES "teachers"("user_id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "section_roles" ADD CONSTRAINT "section_roles_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "sessions" ADD CONSTRAINT "sessions_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
