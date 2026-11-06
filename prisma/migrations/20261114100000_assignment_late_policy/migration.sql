-- Two assignment fields from the frontend (21–22/10/2569, API_CONTRACT "Late policy / deduction" and
-- "Assignment.rubricRestartedAt"): late_policy (what late work costs and until when it is accepted; the
-- frontend computes the deduction) and rubric_restarted_at (the rubric's scoring changed mid-grading; the
-- frontend clears it after its AI re-grade). Adds only.

-- AlterTable
ALTER TABLE "assignments" ADD COLUMN     "late_policy" JSONB,
ADD COLUMN     "rubric_restarted_at" TIMESTAMPTZ(3);

