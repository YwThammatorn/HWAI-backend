-- submissions.student_id is a FK to students.student_id (ON UPDATE / ON DELETE CASCADE): every submission
-- belongs to an existing student; deleting the account deletes their work (admins deactivate to keep it).
--
-- Stops if a submission's student has no account. The seed adds [21]'s past students (6499xxxx / 6599xxxx)
-- as inactive accounts: run it before this migration on a database seeded earlier.

-- AddForeignKey
ALTER TABLE "submissions" ADD CONSTRAINT "submissions_student_id_fkey" FOREIGN KEY ("student_id") REFERENCES "students"("student_id") ON DELETE CASCADE ON UPDATE CASCADE;

