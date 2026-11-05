import { Router } from "express";
import { z } from "zod";
import { prisma } from "../lib/prisma.js";
import { HttpError, parse } from "../lib/http.js";
import { isStaffAnywhere, requireAdmin } from "../lib/access.js";
import { principalOf } from "../lib/auth.js";
import { toCohortStudent } from "../lib/serialize.js";

export const cohortStudentsRouter = Router();

const studentFields = z.object({
  studentId: z.string().trim().min(1),
  title: z.string().trim().nullish(),
  firstName: z.string().trim().min(1),
  lastName: z.string().trim().min(1),
  email: z.string().trim().toLowerCase().pipe(z.email()),
  // CE / CECS / CEI — spacing and case are forgiven (CSV imports), anything else is a 400
  program: z.preprocess((v) => (typeof v === "string" ? v.trim().toUpperCase() : v), z.enum(["CE", "CECS", "CEI"])),
  status: z.enum(["active", "inactive"]).optional(),
  curriculumVersionId: z.string().nullish(),
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
    where: everyone ? undefined : { id: p.student?.id ?? "" },
    orderBy: { studentId: "asc" },
  });
  res.json(rows.map(toCohortStudent));
});

// Takes an array (single add and CSV import share this endpoint). All-or-nothing: one duplicate
// studentId rejects the whole batch with 409.
cohortStudentsRouter.post("/cohort-students", async (req, res) => {
  requireAdmin(req);
  const items = parse(z.array(studentCreate), req.body);
  const rows = await prisma.$transaction(items.map((data) => prisma.student.create({ data })));
  res.status(201).json(rows.map(toCohortStudent));
});

// All-or-nothing: if any id doesn't exist, nothing is changed and the response is 404.
cohortStudentsRouter.patch("/cohort-students", async (req, res) => {
  requireAdmin(req);
  const { ids, data } = parse(studentBulkUpdate, req.body);
  const unique = [...new Set(ids)];
  const rows = await prisma.$transaction(async (tx) => {
    const { count } = await tx.student.updateMany({ where: { id: { in: unique } }, data });
    if (count !== unique.length) throw new HttpError(404, `${unique.length - count} student(s) not found`);
    return tx.student.findMany({ where: { id: { in: unique } }, orderBy: { studentId: "asc" } });
  });
  res.json(rows.map(toCohortStudent));
});

cohortStudentsRouter.patch("/cohort-students/:id", async (req, res) => {
  requireAdmin(req);
  const data = parse(studentUpdate, req.body);
  const row = await prisma.student.update({ where: { id: req.params.id }, data });
  res.json(toCohortStudent(row));
});

/** The uploaded file ids (attachments with source "upload") of some submissions' stored JSON. */
function uploadRefs(attachments: unknown): string[] {
  if (!Array.isArray(attachments)) return [];
  return attachments.flatMap((a) =>
    a && typeof a === "object" && a.source === "upload" && typeof a.ref === "string" ? [a.ref] : [],
  );
}

// Deleting an account is for good (admins deactivate to keep someone's work): the database removes them
// from every roster and deletes their submissions (FK cascades), and their uploaded files go too — except a
// file a teammate's submission still points at (a team hands in the same files). One transaction.
cohortStudentsRouter.delete("/cohort-students/:id", async (req, res) => {
  requireAdmin(req);
  await prisma.$transaction(async (tx) => {
    const student = await tx.student.findUniqueOrThrow({ where: { id: req.params.id }, select: { studentId: true } });
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
    await tx.student.delete({ where: { id: req.params.id } });
    if (refs.size > 0) await tx.storedFile.deleteMany({ where: { id: { in: [...refs] } } });
  });
  res.status(204).end();
});
