-- Course: drop iconColor (it was only ever a copy of coverColor) and store which icon the course uses
-- as an enum matching HWAI-frontend's COURSE_ICON_KEYS. Existing/unknown values fall back to "book",
-- the same fallback the frontend uses when icon is unset.

-- CreateEnum
CREATE TYPE "CourseIcon" AS ENUM ('book', 'chart', 'flask', 'code', 'palette', 'laptop', 'graduation', 'globe');

-- AlterTable
ALTER TABLE "courses" DROP COLUMN "iconColor";

UPDATE "courses" SET "icon" = 'book'
WHERE "icon" IS NULL OR "icon" NOT IN ('book', 'chart', 'flask', 'code', 'palette', 'laptop', 'graduation', 'globe');

ALTER TABLE "courses"
  ALTER COLUMN "icon" TYPE "CourseIcon" USING ("icon"::"CourseIcon"),
  ALTER COLUMN "icon" SET DEFAULT 'book',
  ALTER COLUMN "icon" SET NOT NULL;
