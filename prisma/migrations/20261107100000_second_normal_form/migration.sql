-- Second normal form (6/11/2569).
--
-- - submissions.student_name / email depended on student_id alone (the key is assignment_id + student_id):
--   dropped — the API reads them from the student's account (submissions.student_id is a FK already).
-- - student_groups.member_student_ids (an array) becomes the table student_group_members: one row per
--   member (the API lists them by student ID). A student is on at most one team per assignment
--   (UNIQUE assignment_id + student_id, with assignment_id tied to the team by a composite FK).
--
-- The members are copied out of the array before it is dropped. Stops (does not repair) when the arrays
-- break the new rules: a student on two teams of one assignment, twice on one team, or with no account.

-- submissions: name and email come from the account
ALTER TABLE "submissions" DROP COLUMN "email",
DROP COLUMN "student_name";

-- teams: the target of the members' composite FK
CREATE UNIQUE INDEX "student_groups_id_assignment_id_key" ON "student_groups"("id", "assignment_id");

CREATE TABLE "student_group_members" (
    "group_id" TEXT NOT NULL,
    "assignment_id" TEXT NOT NULL,
    "student_id" TEXT NOT NULL,

    CONSTRAINT "student_group_members_pkey" PRIMARY KEY ("group_id","student_id")
);
CREATE INDEX "student_group_members_student_id_idx" ON "student_group_members"("student_id");
CREATE UNIQUE INDEX "student_group_members_assignment_id_student_id_key" ON "student_group_members"("assignment_id", "student_id");

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM "student_groups" g, unnest(g."member_student_ids") AS m(student_id)
    GROUP BY g."assignment_id", m.student_id HAVING count(*) > 1
  ) THEN
    RAISE EXCEPTION 'student_groups: a student is on more than one team (or twice on one team) for the same assignment — fix the teams first';
  END IF;
  IF EXISTS (
    SELECT 1 FROM "student_groups" g, unnest(g."member_student_ids") AS m(student_id)
    LEFT JOIN "students" s ON s."student_id" = m.student_id
    WHERE s."id" IS NULL
  ) THEN
    RAISE EXCEPTION 'student_groups: a member has no student account — fix the teams (or add the student) first';
  END IF;
END $$;

INSERT INTO "student_group_members" ("group_id", "assignment_id", "student_id")
SELECT g."id", g."assignment_id", m.student_id
FROM "student_groups" g, unnest(g."member_student_ids") AS m(student_id);

ALTER TABLE "student_group_members" ADD CONSTRAINT "student_group_members_group_id_assignment_id_fkey" FOREIGN KEY ("group_id", "assignment_id") REFERENCES "student_groups"("id", "assignment_id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "student_group_members" ADD CONSTRAINT "student_group_members_student_id_fkey" FOREIGN KEY ("student_id") REFERENCES "students"("student_id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "student_groups" DROP COLUMN "member_student_ids";
