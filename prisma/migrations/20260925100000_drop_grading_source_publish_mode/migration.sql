-- Course.gradingSource / publishMode were never wired into the UI; score publishing is now the
-- per-assignment "Finish & announce" flow on the frontend.

-- AlterTable
ALTER TABLE "courses" DROP COLUMN "grading_source",
DROP COLUMN "publish_mode";

-- DropEnum
DROP TYPE "grading_source";

-- DropEnum
DROP TYPE "publish_mode";
