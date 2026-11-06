import { Router } from "express";
import { z } from "zod";
import { prisma } from "../lib/prisma.js";
import { HttpError, parse } from "../lib/http.js";
import { isStaffAnywhere, requireAdmin } from "../lib/access.js";
import { principalOf } from "../lib/auth.js";
import { removeKind, splitUserFields, userFor } from "../lib/accounts.js";
import { toCohortStudent } from "../lib/serialize.js";

// A CohortStudent is a user (title, name, email, status) who is a student (studentId, program, curriculum);
// its id is the user id.
const include = { user: true } as const;

export const cohortStudentsRouter = Router();

const studentFields = z.object({
  studentId: z.string().trim().min(1),
  title: z.string().trim().nullish(),
  name: z.string().trim().min(1), // full name
  email: z.string().trim().toLowerCase().pipe(z.email()),
  // CE / CECS / CEI — spacing and case are forgiven (CSV imports), anything else is a 400
  program: z.preprocess((v) => (typeof v === "string" ? v.trim().toUpperCase() : v), z.enum(["CE", "CECS", "CEI"])),
  status: z.enum(["active", "inactive"]).optional(),
});
export const studentCreate = studentFields.extend({ id: z.string().min(1).optional() });
export const studentUpdate = studentFields.partial();
// Same change for many students (e.g. deactivating a whole batch). studentId is unique per student,
// so it can't be set in bulk.
export const studentBulkUpdate = z.object({
  ids: z.array(z.string().min(1)).min(1),
  data: studentUpdate.omit({ studentId: true }),
});

// Staff (and admins) see the whole cohort — they enrol students and pick TAs from it. A student
// sees only their own record.
cohortStudentsRouter.get("/cohort-students", async (req, res) => {
  const p = principalOf(req);
  const everyone = await isStaffAnywhere(p);
  const rows = await prisma.student.findMany({
    where: everyone ? undefined : { userId: p.student?.id ?? "" },
    include,
    orderBy: { studentId: "asc" },
  });
  res.json(rows.map(toCohortStudent));
});

// Takes an array (single add and CSV import share this endpoint). All-or-nothing: one duplicate
// studentId (or a student / teacher already using the email) rejects the whole batch with 409. An email that
// is already a user (e.g. an admin) makes that user a student.
cohortStudentsRouter.post("/cohort-students", async (req, res) => {
  requireAdmin(req);
  const items = parse(z.array(studentCreate), req.body);
  const rows = await prisma.$transaction(async (tx) => {
    const out = [];
    for (const data of items) {
      const userId = await userFor(tx, "student", data);
      out.push(
        await tx.student.create({
          data: { userId, studentId: data.studentId, program: data.program },
          include,
        }),
      );
    }
    return out;
  });
  res.status(201).json(rows.map(toCohortStudent));
});

// All-or-nothing: if any id doesn't exist, nothing is changed and the response is 404.
cohortStudentsRouter.patch("/cohort-students", async (req, res) => {
  requireAdmin(req);
  const { ids, data } = parse(studentBulkUpdate, req.body);
  const unique = [...new Set(ids)];
  const { user, rest } = splitUserFields(data);
  const rows = await prisma.$transaction(async (tx) => {
    const count = await tx.student.count({ where: { userId: { in: unique } } });
    if (count !== unique.length) throw new HttpError(404, `${unique.length - count} student(s) not found`);
    if (Object.keys(user).length > 0) await tx.user.updateMany({ where: { id: { in: unique } }, data: user });
    if (Object.keys(rest).length > 0) await tx.student.updateMany({ where: { userId: { in: unique } }, data: rest });
    return tx.student.findMany({ where: { userId: { in: unique } }, include, orderBy: { studentId: "asc" } });
  });
  res.json(rows.map(toCohortStudent));
});

cohortStudentsRouter.patch("/cohort-students/:id", async (req, res) => {
  requireAdmin(req);
  // title / name / email / status are the user's; studentId, program and curriculum the student's.
  const { user, rest } = splitUserFields(parse(studentUpdate, req.body));
  const row = await prisma.$transaction(async (tx) => {
    await tx.student.findUniqueOrThrow({ where: { userId: req.params.id }, select: { userId: true } });
    if (Object.keys(user).length > 0) await tx.user.update({ where: { id: req.params.id }, data: user });
    return tx.student.update({ where: { userId: req.params.id }, data: rest, include });
  });
  res.json(toCohortStudent(row));
});

/** The uploaded file ids (attachments with source "upload") of some submissions' stored JSON. */
function uploadRefs(attachments: unknown): string[] {
  if (!Array.isArray(attachments)) return [];
  return attachments.flatMap((a) =>
    a && typeof a === "object" && a.source === "upload" && typeof a.ref === "string" ? [a.ref] : [],
  );
}

// Deleting a student is for good (admins deactivate to keep someone's work): the database removes them from
// every roster and team and deletes their submissions (FK cascades on students.student_id), their TA roles go,
// and their uploaded files too — except a file a teammate's submission still points at (a team hands in the
// same files). The user goes as well unless they are something else (an admin). One transaction.
cohortStudentsRouter.delete("/cohort-students/:id", async (req, res) => {
  requireAdmin(req);
  await prisma.$transaction(async (tx) => {
    const student = await tx.student.findUniqueOrThrow({ where: { userId: req.params.id }, select: { studentId: true } });
    const theirs = await tx.submission.findMany({
      where: { studentId: student.studentId },
      select: { assignmentId: true, attachments: true },
    });
    const refs = new Set(theirs.flatMap((s) => uploadRefs(s.attachments)));
    if (refs.size > 0) {
      // Files are only shared within an assignment (teammates), so that's where to look for other users.
      const others = await tx.submission.findMany({
        where: { assignmentId: { in: [...new Set(theirs.map((s) => s.assignmentId))] }, studentId: { not: student.studentId } },
        select: { attachments: true },
      });
      for (const s of others) for (const ref of uploadRefs(s.attachments)) refs.delete(ref);
    }
    await removeKind(tx, "student", req.params.id);
    if (refs.size > 0) await tx.storedFile.deleteMany({ where: { id: { in: [...refs] } } });
  });
  res.status(204).end();
});
