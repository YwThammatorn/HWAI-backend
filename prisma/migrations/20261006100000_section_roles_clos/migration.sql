-- Course staff and outcomes: section roles (TA = a student, co-teacher = a teacher) and CLOs.
-- A role points at exactly one of teacher_id / student_id (CHECK below), and goes when that person does.

-- CreateEnum
CREATE TYPE "section_role_type" AS ENUM ('teacher', 'ta', 'co-teacher');

-- CreateTable
CREATE TABLE "section_roles" (
    "id" TEXT NOT NULL,
    "course_id" TEXT NOT NULL,
    "teacher_id" TEXT,
    "student_id" TEXT,
    "role" "section_role_type" NOT NULL,
    "permissions" JSONB,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "section_roles_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "clos" (
    "id" TEXT NOT NULL,
    "course_id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "text" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "clos_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "section_roles_teacher_id_idx" ON "section_roles"("teacher_id");

-- CreateIndex
CREATE INDEX "section_roles_student_id_idx" ON "section_roles"("student_id");

-- CreateIndex
CREATE UNIQUE INDEX "section_roles_course_id_teacher_id_key" ON "section_roles"("course_id", "teacher_id");

-- CreateIndex
CREATE UNIQUE INDEX "section_roles_course_id_student_id_key" ON "section_roles"("course_id", "student_id");

-- CreateIndex
CREATE INDEX "clos_course_id_idx" ON "clos"("course_id");

-- AddForeignKey
ALTER TABLE "section_roles" ADD CONSTRAINT "section_roles_course_id_fkey" FOREIGN KEY ("course_id") REFERENCES "courses"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "section_roles" ADD CONSTRAINT "section_roles_teacher_id_fkey" FOREIGN KEY ("teacher_id") REFERENCES "teachers"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "section_roles" ADD CONSTRAINT "section_roles_student_id_fkey" FOREIGN KEY ("student_id") REFERENCES "students"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "clos" ADD CONSTRAINT "clos_course_id_fkey" FOREIGN KEY ("course_id") REFERENCES "courses"("id") ON DELETE CASCADE ON UPDATE CASCADE;


-- Exactly one of teacher_id / student_id (Prisma can't express this, so it's added by hand)
ALTER TABLE "section_roles" ADD CONSTRAINT "section_roles_one_account_check" CHECK (("teacher_id" IS NULL) <> ("student_id" IS NULL));
