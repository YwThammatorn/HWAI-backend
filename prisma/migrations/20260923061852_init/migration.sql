-- CreateEnum
CREATE TYPE "Program" AS ENUM ('CECS', 'CEI', 'CE');

-- CreateEnum
CREATE TYPE "AccountStatus" AS ENUM ('active', 'inactive');

-- CreateEnum
CREATE TYPE "TeacherRole" AS ENUM ('teacher', 'ta');

-- CreateEnum
CREATE TYPE "CourseStatus" AS ENUM ('active', 'archived');

-- CreateEnum
CREATE TYPE "CourseSource" AS ENUM ('manual', 'google', 'teams');

-- CreateEnum
CREATE TYPE "GradingSource" AS ENUM ('ta', 'ai', 'blind');

-- CreateEnum
CREATE TYPE "PublishMode" AS ENUM ('auto', 'manual');

-- CreateEnum
CREATE TYPE "Term" AS ENUM ('T1', 'T2', 'SUMMER');

-- CreateTable
CREATE TABLE "curriculum_versions" (
    "id" TEXT NOT NULL,
    "program" "Program" NOT NULL,
    "label" TEXT NOT NULL,
    "effectiveFrom" INTEGER NOT NULL,
    "effectiveTo" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "curriculum_versions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "course_templates" (
    "id" TEXT NOT NULL,
    "curriculumVersionId" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "course_templates_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "courses" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT NOT NULL DEFAULT '',
    "status" "CourseStatus" NOT NULL DEFAULT 'active',
    "source" "CourseSource" NOT NULL DEFAULT 'manual',
    "coverColor" TEXT NOT NULL,
    "iconColor" TEXT NOT NULL,
    "icon" TEXT,
    "code" TEXT,
    "courseTemplateId" TEXT,
    "academicYear" INTEGER,
    "term" "Term",
    "sectionNumber" TEXT,
    "gradingSource" "GradingSource",
    "publishMode" "PublishMode",
    "schedule" TEXT,
    "room" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "courses_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "managed_teachers" (
    "id" TEXT NOT NULL,
    "title" TEXT,
    "name" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "role" "TeacherRole" NOT NULL DEFAULT 'teacher',
    "status" "AccountStatus" NOT NULL DEFAULT 'active',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "managed_teachers_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "teacher_courses" (
    "teacherId" TEXT NOT NULL,
    "courseId" TEXT NOT NULL,
    "assignedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "teacher_courses_pkey" PRIMARY KEY ("teacherId","courseId")
);

-- CreateTable
CREATE TABLE "cohort_students" (
    "id" TEXT NOT NULL,
    "studentId" TEXT NOT NULL,
    "title" TEXT,
    "firstName" TEXT NOT NULL,
    "lastName" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "cohort" TEXT NOT NULL,
    "program" TEXT NOT NULL,
    "status" "AccountStatus" NOT NULL DEFAULT 'active',
    "curriculumVersionId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "cohort_students_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "course_templates_curriculumVersionId_idx" ON "course_templates"("curriculumVersionId");

-- CreateIndex
CREATE INDEX "courses_courseTemplateId_idx" ON "courses"("courseTemplateId");

-- CreateIndex
CREATE UNIQUE INDEX "managed_teachers_email_key" ON "managed_teachers"("email");

-- CreateIndex
CREATE INDEX "teacher_courses_courseId_idx" ON "teacher_courses"("courseId");

-- CreateIndex
CREATE UNIQUE INDEX "cohort_students_studentId_key" ON "cohort_students"("studentId");

-- CreateIndex
CREATE INDEX "cohort_students_cohort_idx" ON "cohort_students"("cohort");

-- AddForeignKey
ALTER TABLE "course_templates" ADD CONSTRAINT "course_templates_curriculumVersionId_fkey" FOREIGN KEY ("curriculumVersionId") REFERENCES "curriculum_versions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "courses" ADD CONSTRAINT "courses_courseTemplateId_fkey" FOREIGN KEY ("courseTemplateId") REFERENCES "course_templates"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "teacher_courses" ADD CONSTRAINT "teacher_courses_teacherId_fkey" FOREIGN KEY ("teacherId") REFERENCES "managed_teachers"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "teacher_courses" ADD CONSTRAINT "teacher_courses_courseId_fkey" FOREIGN KEY ("courseId") REFERENCES "courses"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "cohort_students" ADD CONSTRAINT "cohort_students_curriculumVersionId_fkey" FOREIGN KEY ("curriculumVersionId") REFERENCES "curriculum_versions"("id") ON DELETE SET NULL ON UPDATE CASCADE;
