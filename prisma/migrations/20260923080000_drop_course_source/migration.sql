-- Course.source is gone: every course is created manually (no Google Classroom / Teams import).

-- AlterTable
ALTER TABLE "courses" DROP COLUMN "source";

-- DropEnum
DROP TYPE "CourseSource";
