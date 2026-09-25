-- Match HWAI-frontend's latest model and give the database conventional PostgreSQL names.
--   * Term gains term 3; values are stored as '1' / '2' / '3' / 'summer' instead of 'T1' / 'T2' / 'SUMMER'
--   * students no longer have a cohort (removed on the frontend)
--   * tables: managed_teachers -> teachers, cohort_students -> students, teacher_courses -> course_teachers
--   * columns, enum types, indexes and constraints: snake_case
-- Everything is a rename, so existing rows are kept (except the dropped cohort column).

-- ── Enum types ───────────────────────────────────────────────────────────────
ALTER TYPE "Program"       RENAME TO "program";
ALTER TYPE "AccountStatus" RENAME TO "account_status";
ALTER TYPE "TeacherRole"   RENAME TO "teacher_role";
ALTER TYPE "CourseStatus"  RENAME TO "course_status";
ALTER TYPE "GradingSource" RENAME TO "grading_source";
ALTER TYPE "PublishMode"   RENAME TO "publish_mode";
ALTER TYPE "CourseIcon"    RENAME TO "course_icon";
ALTER TYPE "Term"          RENAME TO "term";

ALTER TYPE "term" RENAME VALUE 'T1' TO '1';
ALTER TYPE "term" RENAME VALUE 'T2' TO '2';
ALTER TYPE "term" RENAME VALUE 'SUMMER' TO 'summer';
ALTER TYPE "term" ADD VALUE '3' BEFORE 'summer';

-- ── curriculum_versions ──────────────────────────────────────────────────────
ALTER TABLE "curriculum_versions" RENAME COLUMN "effectiveFrom" TO "effective_from";
ALTER TABLE "curriculum_versions" RENAME COLUMN "effectiveTo"   TO "effective_to";
ALTER TABLE "curriculum_versions" RENAME COLUMN "createdAt"     TO "created_at";
ALTER TABLE "curriculum_versions" RENAME COLUMN "updatedAt"     TO "updated_at";

-- ── course_templates ─────────────────────────────────────────────────────────
ALTER TABLE "course_templates" RENAME COLUMN "curriculumVersionId" TO "curriculum_version_id";
ALTER TABLE "course_templates" RENAME COLUMN "createdAt"           TO "created_at";
ALTER TABLE "course_templates" RENAME COLUMN "updatedAt"           TO "updated_at";
ALTER INDEX "course_templates_curriculumVersionId_idx" RENAME TO "course_templates_curriculum_version_id_idx";
ALTER TABLE "course_templates" RENAME CONSTRAINT "course_templates_curriculumVersionId_fkey" TO "course_templates_curriculum_version_id_fkey";

-- ── courses ──────────────────────────────────────────────────────────────────
ALTER TABLE "courses" RENAME COLUMN "coverColor"       TO "cover_color";
ALTER TABLE "courses" RENAME COLUMN "courseTemplateId" TO "course_template_id";
ALTER TABLE "courses" RENAME COLUMN "academicYear"     TO "academic_year";
ALTER TABLE "courses" RENAME COLUMN "sectionNumber"    TO "section_number";
ALTER TABLE "courses" RENAME COLUMN "gradingSource"    TO "grading_source";
ALTER TABLE "courses" RENAME COLUMN "publishMode"      TO "publish_mode";
ALTER TABLE "courses" RENAME COLUMN "createdAt"        TO "created_at";
ALTER TABLE "courses" RENAME COLUMN "updatedAt"        TO "updated_at";
ALTER INDEX "courses_courseTemplateId_idx" RENAME TO "courses_course_template_id_idx";
ALTER TABLE "courses" RENAME CONSTRAINT "courses_courseTemplateId_fkey" TO "courses_course_template_id_fkey";

-- ── managed_teachers -> teachers ─────────────────────────────────────────────
ALTER TABLE "managed_teachers" RENAME TO "teachers";
ALTER TABLE "teachers" RENAME COLUMN "createdAt" TO "created_at";
ALTER TABLE "teachers" RENAME COLUMN "updatedAt" TO "updated_at";
ALTER TABLE "teachers" RENAME CONSTRAINT "managed_teachers_pkey" TO "teachers_pkey";
ALTER INDEX "managed_teachers_email_key" RENAME TO "teachers_email_key";

-- ── teacher_courses -> course_teachers (primary key now leads with course_id) ──
ALTER TABLE "teacher_courses" RENAME TO "course_teachers";
ALTER TABLE "course_teachers" RENAME COLUMN "teacherId"  TO "teacher_id";
ALTER TABLE "course_teachers" RENAME COLUMN "courseId"   TO "course_id";
ALTER TABLE "course_teachers" RENAME COLUMN "assignedAt" TO "assigned_at";
ALTER TABLE "course_teachers" DROP CONSTRAINT "teacher_courses_pkey";
ALTER TABLE "course_teachers" ADD CONSTRAINT "course_teachers_pkey" PRIMARY KEY ("course_id", "teacher_id");
DROP INDEX "teacher_courses_courseId_idx";
CREATE INDEX "course_teachers_teacher_id_idx" ON "course_teachers"("teacher_id");
ALTER TABLE "course_teachers" RENAME CONSTRAINT "teacher_courses_teacherId_fkey" TO "course_teachers_teacher_id_fkey";
ALTER TABLE "course_teachers" RENAME CONSTRAINT "teacher_courses_courseId_fkey"  TO "course_teachers_course_id_fkey";

-- ── cohort_students -> students (cohort removed) ─────────────────────────────
DROP INDEX "cohort_students_cohort_idx";
ALTER TABLE "cohort_students" DROP COLUMN "cohort";
ALTER TABLE "cohort_students" RENAME TO "students";
ALTER TABLE "students" RENAME COLUMN "studentId"           TO "student_id";
ALTER TABLE "students" RENAME COLUMN "firstName"           TO "first_name";
ALTER TABLE "students" RENAME COLUMN "lastName"            TO "last_name";
ALTER TABLE "students" RENAME COLUMN "curriculumVersionId" TO "curriculum_version_id";
ALTER TABLE "students" RENAME COLUMN "createdAt"           TO "created_at";
ALTER TABLE "students" RENAME COLUMN "updatedAt"           TO "updated_at";
ALTER TABLE "students" RENAME CONSTRAINT "cohort_students_pkey" TO "students_pkey";
ALTER INDEX "cohort_students_studentId_key" RENAME TO "students_student_id_key";
ALTER TABLE "students" RENAME CONSTRAINT "cohort_students_curriculumVersionId_fkey" TO "students_curriculum_version_id_fkey";
