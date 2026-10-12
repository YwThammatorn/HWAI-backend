-- Match HWAI-frontend's rubric round: assignments.grading_mode, submissions.ai_criterion_scores, rubrics.ai_offsets,
-- plus the rubric reuse library and AI calibration runs. Only adds things — no existing data changes.

-- CreateEnum
CREATE TYPE "grading_mode" AS ENUM ('ai', 'manual');

-- AlterTable
ALTER TABLE "assignments" ADD COLUMN     "grading_mode" "grading_mode";

-- AlterTable
ALTER TABLE "rubrics" ADD COLUMN     "ai_offsets" JSONB;

-- AlterTable
ALTER TABLE "submissions" ADD COLUMN     "ai_criterion_scores" JSONB;

-- CreateTable
CREATE TABLE "rubric_library_entries" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "course_template_id" TEXT,
    "criteria" JSONB NOT NULL,
    "source_assignment_id" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "rubric_library_entries_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "calibration_runs" (
    "id" TEXT NOT NULL,
    "assignment_id" TEXT NOT NULL,
    "sample_ids" TEXT[],
    "teacher_levels" JSONB NOT NULL,
    "completed_at" TIMESTAMP(3),
    "applied_at" TIMESTAMP(3),
    "applied_offsets" JSONB,
    "created_at" TIMESTAMP(3) NOT NULL,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "calibration_runs_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "rubric_library_entries_course_template_id_idx" ON "rubric_library_entries"("course_template_id");

-- CreateIndex
CREATE INDEX "calibration_runs_assignment_id_idx" ON "calibration_runs"("assignment_id");

-- AddForeignKey
ALTER TABLE "rubric_library_entries" ADD CONSTRAINT "rubric_library_entries_course_template_id_fkey" FOREIGN KEY ("course_template_id") REFERENCES "course_templates"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "rubric_library_entries" ADD CONSTRAINT "rubric_library_entries_source_assignment_id_fkey" FOREIGN KEY ("source_assignment_id") REFERENCES "assignments"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "calibration_runs" ADD CONSTRAINT "calibration_runs_assignment_id_fkey" FOREIGN KEY ("assignment_id") REFERENCES "assignments"("id") ON DELETE CASCADE ON UPDATE CASCADE;

