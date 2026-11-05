// Course rosters — `Student` on the frontend (src/lib/students.ts), `enrollments` in the database.
// A roster row points at an existing student (students.student_id, a FK): name and email are the
// student's own, read at serialization.
import { Router } from "express";
import { z } from "zod";
import { prisma } from "../lib/prisma.js";
import { HttpError, parse } from "../lib/http.js";
import type { Prisma } from "../generated/prisma/client.js";
import { enrollmentStatus, idOverride, toEnrollment, withStudent } from "../lib/content.js";
import { courseFilter, requireMember, requireStaff, visibleCourses } from "../lib/access.js";
import { principalOf } from "../lib/auth.js";

export const enrollmentsRouter = Router();

const statusSchema = z.enum(["enrolled", "withdrawn", "added-midterm"]);
// Accepted for older clients and ignored: a roster row shows the student's own name and email.
const ignored = {
  firstName: z.string().optional(),
  lastName: z.string().optional(),
  email: z.string().optional(),
};
export const enrollmentCreate = z.object({
  ...idOverride,
  studentId: z.string().trim().min(1),
  ...ignored,
  sequenceNumber: z.number().int().positive().nullish(),
  enrollmentStatus: statusSchema.nullish(),
});
// What a roster row can change: its number and status. (studentId is accepted and ignored too — moving
// a row to another student is enrolling someone else.)
export const enrollmentUpdate = z.object({
  studentId: z.string().optional(),
  ...ignored,
  sequenceNumber: z.number().int().positive().nullish(),
  enrollmentStatus: statusSchema.nullish(),
});

const toDbStatus = (s: z.infer<typeof statusSchema> | null | undefined) =>
  s === undefined ? undefined : s === null ? null : enrollmentStatus.toDb(s);

const order = [{ courseId: "asc" as const }, { sequenceNumber: "asc" as const }, { createdAt: "asc" as const }];

// Every roster the caller can see (their courses' — classmates included, for forming teams); the
// frontend's StudentProvider keeps one flat list.
enrollmentsRouter.get("/students", async (req, res) => {
  const courseId = courseFilter(await visibleCourses(principalOf(req)));
  const rows = await prisma.enrollment.findMany({ where: courseId && { courseId }, include: withStudent, orderBy: order });
  res.json(rows.map(toEnrollment));
});

enrollmentsRouter.get("/courses/:courseId/students", async (req, res) => {
  await requireMember(req, req.params.courseId);
  const rows = await prisma.enrollment.findMany({ where: { courseId: req.params.courseId }, include: withStudent, orderBy: order });
  res.json(rows.map(toEnrollment));
});

// ── One section = one program (CE / CECS / CEI) ──────────────────────────────
// Same rule as HWAI-frontend/src/lib/sectionProgram.ts: a section's program is its curriculum's
// (course → course template → curriculum version); a section with no curriculum takes the program of
// the first non-withdrawn student on its roster. An empty section without a curriculum takes the first
// student of a batch, who then pins it for the rest.

type Tx = Prisma.TransactionClient;

async function programsOf(tx: Tx, studentIds: string[]) {
  const rows = await tx.student.findMany({ where: { studentId: { in: studentIds } }, select: { studentId: true, program: true } });
  return new Map<string, string>(rows.map((s) => [s.studentId, s.program]));
}

async function sectionProgram(tx: Tx, courseId: string): Promise<string | null> {
  const course = await tx.course.findUnique({
    where: { id: courseId },
    select: { courseTemplate: { select: { curriculumVersion: { select: { program: true } } } } },
  });
  if (!course) throw new HttpError(404, "Course not found");
  const fromCurriculum = course.courseTemplate?.curriculumVersion.program;
  if (fromCurriculum) return fromCurriculum;
  const first = await tx.enrollment.findFirst({
    // A missing status counts as enrolled (as on the frontend) — plain NOT would drop NULLs too.
    where: { courseId, OR: [{ enrollmentStatus: null }, { enrollmentStatus: { not: "withdrawn" } }] },
    orderBy: order,
    select: { student: { select: { program: true } } },
  });
  return first?.student.program ?? null;
}

type Rejected =
  | { studentId: string; reason: "not_in_system" }
  | { studentId: string; program: string; sectionProgram: string; reason: "wrong_program" };

// Takes an array (single enrol and CSV import share it). Numbering continues after the highest number
// on the roster, and a student added to a non-empty roster counts as "added-midterm" — unless the client
// says otherwise (the same rule as the frontend's StudentProvider).
// Only students who have an account can be enrolled, and only into a section of their program. The rest
// go in and the response lists every refused row — 201 { enrolled, rejected } (rejected is [] when all
// went in), or 422 when nobody could be enrolled. Refused: "not_in_system" (no such student) or
// "wrong_program". A student already on the roster, or a number already taken, rejects the whole batch
// (409).
enrollmentsRouter.post("/courses/:courseId/students", async (req, res) => {
  const courseId = req.params.courseId;
  await requireStaff(req, courseId, "canManageRoster");
  const items = parse(z.array(enrollmentCreate), req.body);
  const { created, rejected } = await prisma.$transaction(async (tx) => {
    let pinned = await sectionProgram(tx, courseId);
    const programs = await programsOf(tx, items.map((i) => i.studentId));
    const existing = await tx.enrollment.count({ where: { courseId } });
    const max = await tx.enrollment.aggregate({ where: { courseId }, _max: { sequenceNumber: true } });
    let nextSeq = (max._max.sequenceNumber ?? 0) + 1;
    const created = [];
    const rejected: Rejected[] = [];
    for (const item of items) {
      const program = programs.get(item.studentId);
      if (!program) {
        rejected.push({ studentId: item.studentId, reason: "not_in_system" });
        continue;
      }
      if (pinned && program !== pinned) {
        rejected.push({ studentId: item.studentId, program, sectionProgram: pinned, reason: "wrong_program" });
        continue;
      }
      pinned ??= program;
      const sequenceNumber = item.sequenceNumber ?? nextSeq;
      nextSeq = Math.max(nextSeq, sequenceNumber + 1);
      created.push(
        await tx.enrollment.create({
          data: {
            ...(item.id && { id: item.id }),
            courseId,
            studentId: item.studentId,
            sequenceNumber,
            enrollmentStatus: toDbStatus(item.enrollmentStatus) ?? (existing > 0 ? "addedMidterm" : "enrolled"),
          },
          include: withStudent,
        }),
      );
    }
    return { created, rejected };
  });
  if (created.length === 0 && rejected.length > 0) {
    const wrong = rejected.find((r) => r.reason === "wrong_program");
    const error = rejected.every((r) => r.reason === "not_in_system")
      ? "None of these students has an account in HWAI"
      : wrong && rejected.every((r) => r.reason === "wrong_program")
        ? `Every student is from another program than this section (${wrong.sectionProgram})`
        : "None of these students could be enrolled";
    res.status(422).json({ error, rejected });
    return;
  }
  res.status(201).json({ enrolled: created.map(toEnrollment), rejected });
});

async function courseOfEnrollment(id: string) {
  const e = await prisma.enrollment.findUnique({ where: { id }, select: { courseId: true } });
  if (!e) throw new HttpError(404, "Enrollment not found");
  return e.courseId;
}

enrollmentsRouter.patch("/students/:id", async (req, res) => {
  await requireStaff(req, await courseOfEnrollment(req.params.id), "canManageRoster");
  const { sequenceNumber, enrollmentStatus: status } = parse(enrollmentUpdate, req.body);
  const row = await prisma.enrollment.update({
    where: { id: req.params.id },
    data: { sequenceNumber, enrollmentStatus: toDbStatus(status) },
    include: withStudent,
  });
  res.json(toEnrollment(row));
});

enrollmentsRouter.delete("/students/:id", async (req, res) => {
  await requireStaff(req, await courseOfEnrollment(req.params.id), "canManageRoster");
  await prisma.enrollment.delete({ where: { id: req.params.id } });
  res.status(204).end();
});
