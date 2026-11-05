-- Database design fixes (5/11/2569).
--
-- - enrollments.student_id is a FK to students.student_id (ON UPDATE / ON DELETE CASCADE): a roster
--   holds only existing students; first_name / last_name / email move out (read from students).
-- - students.program becomes the program enum; e-mails must be lower-case (CHECK).
-- - Unique: curriculum version per (program, effective_from); course template per
--   (curriculum_version_id, lower(code)); one ACTIVE section per (template, year, term, section number);
--   enrollment per (course_id, sequence_number).
-- - CHECKs on weights, points, team size, curriculum years and scores.
-- - Every timestamp becomes timestamptz (values were UTC); due_date stays a date.
-- - assignments.rubric_ids is dropped: the API derives rubricIds from the rubrics.
-- - sessions are indexed by expiry (expired ones are swept when a session starts).
--
-- Stops (does not repair) if existing rows break a new rule — e.g. an enrollment whose student does not
-- exist, two active sections with the same subject / year / term / section, or a repeated sequence number.

-- AlterTable
ALTER TABLE "curriculum_versions" ALTER COLUMN "created_at" SET DATA TYPE TIMESTAMPTZ(3) USING "created_at" AT TIME ZONE 'UTC',
ALTER COLUMN "updated_at" SET DATA TYPE TIMESTAMPTZ(3) USING "updated_at" AT TIME ZONE 'UTC';

-- AlterTable
ALTER TABLE "course_templates" ALTER COLUMN "created_at" SET DATA TYPE TIMESTAMPTZ(3) USING "created_at" AT TIME ZONE 'UTC',
ALTER COLUMN "updated_at" SET DATA TYPE TIMESTAMPTZ(3) USING "updated_at" AT TIME ZONE 'UTC';

-- AlterTable
ALTER TABLE "courses" ALTER COLUMN "created_at" SET DATA TYPE TIMESTAMPTZ(3) USING "created_at" AT TIME ZONE 'UTC',
ALTER COLUMN "updated_at" SET DATA TYPE TIMESTAMPTZ(3) USING "updated_at" AT TIME ZONE 'UTC';

-- AlterTable
ALTER TABLE "teachers" ALTER COLUMN "created_at" SET DATA TYPE TIMESTAMPTZ(3) USING "created_at" AT TIME ZONE 'UTC',
ALTER COLUMN "updated_at" SET DATA TYPE TIMESTAMPTZ(3) USING "updated_at" AT TIME ZONE 'UTC';

-- AlterTable
ALTER TABLE "course_teachers" ALTER COLUMN "assigned_at" SET DATA TYPE TIMESTAMPTZ(3) USING "assigned_at" AT TIME ZONE 'UTC';

-- AlterTable
ALTER TABLE "students" ALTER COLUMN "program" SET DATA TYPE "program" USING upper(trim("program"))::"program",
ALTER COLUMN "created_at" SET DATA TYPE TIMESTAMPTZ(3) USING "created_at" AT TIME ZONE 'UTC',
ALTER COLUMN "updated_at" SET DATA TYPE TIMESTAMPTZ(3) USING "updated_at" AT TIME ZONE 'UTC';

-- AlterTable
ALTER TABLE "enrollments" DROP COLUMN "email",
DROP COLUMN "first_name",
DROP COLUMN "last_name",
ALTER COLUMN "created_at" SET DATA TYPE TIMESTAMPTZ(3) USING "created_at" AT TIME ZONE 'UTC',
ALTER COLUMN "updated_at" SET DATA TYPE TIMESTAMPTZ(3) USING "updated_at" AT TIME ZONE 'UTC';

-- AlterTable
ALTER TABLE "grading_categories" ALTER COLUMN "created_at" SET DATA TYPE TIMESTAMPTZ(3) USING "created_at" AT TIME ZONE 'UTC',
ALTER COLUMN "updated_at" SET DATA TYPE TIMESTAMPTZ(3) USING "updated_at" AT TIME ZONE 'UTC';

-- AlterTable
ALTER TABLE "assignments" DROP COLUMN "rubric_ids",
ALTER COLUMN "created_at" SET DATA TYPE TIMESTAMPTZ(3) USING "created_at" AT TIME ZONE 'UTC',
ALTER COLUMN "updated_at" SET DATA TYPE TIMESTAMPTZ(3) USING "updated_at" AT TIME ZONE 'UTC';

-- AlterTable
ALTER TABLE "rubrics" ALTER COLUMN "created_at" SET DATA TYPE TIMESTAMPTZ(3) USING "created_at" AT TIME ZONE 'UTC',
ALTER COLUMN "updated_at" SET DATA TYPE TIMESTAMPTZ(3) USING "updated_at" AT TIME ZONE 'UTC';

-- AlterTable
ALTER TABLE "submissions" ALTER COLUMN "submitted_at" SET DATA TYPE TIMESTAMPTZ(3) USING "submitted_at" AT TIME ZONE 'UTC',
ALTER COLUMN "created_at" SET DATA TYPE TIMESTAMPTZ(3) USING "created_at" AT TIME ZONE 'UTC',
ALTER COLUMN "updated_at" SET DATA TYPE TIMESTAMPTZ(3) USING "updated_at" AT TIME ZONE 'UTC';

-- AlterTable
ALTER TABLE "student_groups" ALTER COLUMN "created_at" SET DATA TYPE TIMESTAMPTZ(3) USING "created_at" AT TIME ZONE 'UTC',
ALTER COLUMN "updated_at" SET DATA TYPE TIMESTAMPTZ(3) USING "updated_at" AT TIME ZONE 'UTC';

-- AlterTable
ALTER TABLE "files" ALTER COLUMN "created_at" SET DATA TYPE TIMESTAMPTZ(3) USING "created_at" AT TIME ZONE 'UTC';

-- AlterTable
ALTER TABLE "section_roles" ALTER COLUMN "created_at" SET DATA TYPE TIMESTAMPTZ(3) USING "created_at" AT TIME ZONE 'UTC',
ALTER COLUMN "updated_at" SET DATA TYPE TIMESTAMPTZ(3) USING "updated_at" AT TIME ZONE 'UTC';

-- AlterTable
ALTER TABLE "clos" ALTER COLUMN "created_at" SET DATA TYPE TIMESTAMPTZ(3) USING "created_at" AT TIME ZONE 'UTC',
ALTER COLUMN "updated_at" SET DATA TYPE TIMESTAMPTZ(3) USING "updated_at" AT TIME ZONE 'UTC';

-- AlterTable
ALTER TABLE "rubric_library_entries" ALTER COLUMN "created_at" SET DATA TYPE TIMESTAMPTZ(3) USING "created_at" AT TIME ZONE 'UTC',
ALTER COLUMN "updated_at" SET DATA TYPE TIMESTAMPTZ(3) USING "updated_at" AT TIME ZONE 'UTC';

-- AlterTable
ALTER TABLE "calibration_runs" ALTER COLUMN "completed_at" SET DATA TYPE TIMESTAMPTZ(3) USING "completed_at" AT TIME ZONE 'UTC',
ALTER COLUMN "applied_at" SET DATA TYPE TIMESTAMPTZ(3) USING "applied_at" AT TIME ZONE 'UTC',
ALTER COLUMN "created_at" SET DATA TYPE TIMESTAMPTZ(3) USING "created_at" AT TIME ZONE 'UTC',
ALTER COLUMN "updated_at" SET DATA TYPE TIMESTAMPTZ(3) USING "updated_at" AT TIME ZONE 'UTC';

-- AlterTable
ALTER TABLE "admins" ALTER COLUMN "created_at" SET DATA TYPE TIMESTAMPTZ(3) USING "created_at" AT TIME ZONE 'UTC';

-- AlterTable
ALTER TABLE "sessions" ALTER COLUMN "expires_at" SET DATA TYPE TIMESTAMPTZ(3) USING "expires_at" AT TIME ZONE 'UTC',
ALTER COLUMN "created_at" SET DATA TYPE TIMESTAMPTZ(3) USING "created_at" AT TIME ZONE 'UTC',
ALTER COLUMN "last_seen_at" SET DATA TYPE TIMESTAMPTZ(3) USING "last_seen_at" AT TIME ZONE 'UTC';

-- CreateIndex
CREATE UNIQUE INDEX "curriculum_versions_program_effective_from_key" ON "curriculum_versions"("program", "effective_from");

-- CreateIndex
CREATE UNIQUE INDEX "courses_active_section_key" ON "courses"("course_template_id", "academic_year", "term", "section_number") WHERE (status = 'active');

-- CreateIndex
CREATE UNIQUE INDEX "enrollments_course_id_sequence_number_key" ON "enrollments"("course_id", "sequence_number");

-- CreateIndex
CREATE INDEX "sessions_expires_at_idx" ON "sessions"("expires_at");

-- AddForeignKey
ALTER TABLE "enrollments" ADD CONSTRAINT "enrollments_student_id_fkey" FOREIGN KEY ("student_id") REFERENCES "students"("student_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Course template codes are unique per curriculum version regardless of case. An index on lower(code):
-- Prisma can't express it and leaves it alone.
CREATE UNIQUE INDEX "course_templates_version_code_key" ON "course_templates"("curriculum_version_id", lower("code"));

-- Checks (Prisma doesn't model CHECK constraints; the routes validate the same rules first)
ALTER TABLE "grading_categories" ADD CONSTRAINT "grading_categories_weight_check" CHECK ("weight" > 0 AND "weight" <= 100);
ALTER TABLE "assignments" ADD CONSTRAINT "assignments_max_points_check" CHECK ("max_points" > 0);
ALTER TABLE "assignments" ADD CONSTRAINT "assignments_max_group_size_check" CHECK ("max_group_size" IS NULL OR "max_group_size" BETWEEN 2 AND 20);
ALTER TABLE "curriculum_versions" ADD CONSTRAINT "curriculum_versions_effective_range_check" CHECK ("effective_to" IS NULL OR "effective_to" >= "effective_from");
ALTER TABLE "submissions" ADD CONSTRAINT "submissions_scores_check" CHECK (("ai_score" IS NULL OR "ai_score" >= 0) AND ("instructor_score" IS NULL OR "instructor_score" >= 0));
ALTER TABLE "students" ADD CONSTRAINT "students_email_lower_check" CHECK ("email" = lower("email"));
ALTER TABLE "teachers" ADD CONSTRAINT "teachers_email_lower_check" CHECK ("email" = lower("email"));
ALTER TABLE "admins" ADD CONSTRAINT "admins_email_lower_check" CHECK ("email" = lower("email"));
