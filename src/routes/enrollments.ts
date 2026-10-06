// Course rosters — `Student` on the frontend (src/lib/students.ts), `enrollments` in the database.
import { Router } from "express";
import { z } from "zod";
import { prisma } from "../lib/prisma.js";
import { HttpError, parse } from "../lib/http.js";
import type { Prisma } from "../generated/prisma/client.js";
import { enrollmentStatus, idOverride, toEnrollment } from "../lib/content.js";

export const enrollmentsRouter = Router();

const statusSchema = z.enum(["enrolled", "withdrawn", "added-midterm"]);
const fields = z.object({
  studentId: z.string().trim().min(1),
  firstName: z.string().trim().min(1),
  lastName: z.string().trim().min(1),
  email: z.string().trim(),
  sequenceNumber: z.number().int().positive().nullish(),
  enrollmentStatus: statusSchema.nullish(),
});
export const enrollmentCreate = fields.extend(idOverride);
export const enrollmentUpdate = fields.partial();

function mapStatus<T extends { enrollmentStatus?: z.infer<typeof statusSchema> | null }>(data: T) {
  const { enrollmentStatus: s, ...rest } = data;
  if (s === undefined) return rest;
  return { ...rest, enrollmentStatus: s === null ? null : enrollmentStatus.toDb(s) };
}

const order = [{ courseId: "asc" as const }, { sequenceNumber: "asc" as const }, { createdAt: "asc" as const }];

// Every roster — the frontend's StudentProvider keeps one flat list.
enrollmentsRouter.get("/students", async (_req, res) => {
  const rows = await prisma.enrollment.findMany({ orderBy: order });
  res.json(rows.map(toEnrollment));
});

enrollmentsRouter.get("/courses/:courseId/students", async (req, res) => {
  const rows = await prisma.enrollment.findMany({ where: { courseId: req.params.courseId }, orderBy: order });
  res.json(rows.map(toEnrollment));
});

// ── One section = one program (CE / CECS / CEI) ──────────────────────────────
// Same rule as HWAI-frontend/src/lib/sectionProgram.ts: a section's program is its curriculum's
// (course → course template → curriculum version); a section with no curriculum takes the program of
// the first non-withdrawn student on its roster. Until something pins it, the section takes anyone —
// and within one batch the first student with a program pins it for the rest.

type Tx = Prisma.TransactionClient;

async function programsOf(tx: Tx, studentIds: string[]) {
  const rows = await tx.student.findMany({ where: { studentId: { in: studentIds } }, select: { studentId: true, program: true } });
  return new Map(rows.map((s) => [s.studentId, s.program]));
}

async function sectionProgram(tx: Tx, courseId: string): Promise<string | null> {
  const course = await tx.course.findUnique({
    where: { id: courseId },
    select: { courseTemplate: { select: { curriculumVersion: { select: { program: true } } } } },
  });
  if (!course) throw new HttpError(404, "Course not found");
  const fromCurriculum = course.courseTemplate?.curriculumVersion.program;
  if (fromCurriculum) return fromCurriculum;
  const roster = await tx.enrollment.findMany({
    // A missing status counts as enrolled (as on the frontend) — plain NOT would drop NULLs too.
    where: { courseId, OR: [{ enrollmentStatus: null }, { enrollmentStatus: { not: "withdrawn" } }] },
    orderBy: order,
    select: { studentId: true },
  });
  const programs = await programsOf(tx, roster.map((e) => e.studentId));
  for (const e of roster) {
    const p = programs.get(e.studentId);
    if (p) return p;
  }
  return null;
}

// Takes an array (single enrol and CSV import share it). Numbering continues after the current roster
// and a student added to a non-empty roster counts as "added-midterm" — unless the client says otherwise
// (the same rule as the frontend's StudentProvider).
// Students from another program than the section's are not enrolled: the rest go in, and the response
// lists every refused row — 201 { enrolled, rejected } (rejected is [] when all went in), or 422 when
// nobody could be enrolled. A duplicate still rejects the whole batch (409).
enrollmentsRouter.post("/courses/:courseId/students", async (req, res) => {
  const courseId = req.params.courseId;
  const items = parse(z.array(enrollmentCreate), req.body);
  const { created, rejected } = await prisma.$transaction(async (tx) => {
    let pinned = await sectionProgram(tx, courseId);
    const programs = await programsOf(tx, items.map((i) => i.studentId));
    const existing = await tx.enrollment.count({ where: { courseId } });
    let nextSeq = existing + 1;
    const created = [];
    const rejected: { studentId: string; program: string; sectionProgram: string; reason: "wrong_program" }[] = [];
    for (const item of items) {
      const program = programs.get(item.studentId);
      if (pinned && program && program !== pinned) {
        rejected.push({ studentId: item.studentId, program, sectionProgram: pinned, reason: "wrong_program" });
        continue;
      }
      if (!pinned && program) pinned = program;
      created.push(
        await tx.enrollment.create({
          data: {
            ...mapStatus(item),
            courseId,
            sequenceNumber: item.sequenceNumber ?? nextSeq++,
            enrollmentStatus: item.enrollmentStatus
              ? enrollmentStatus.toDb(item.enrollmentStatus)
              : existing > 0 ? "addedMidterm" : "enrolled",
          },
        }),
      );
    }
    return { created, rejected };
  });
  if (created.length === 0 && rejected.length > 0) {
    res.status(422).json({
      error: `Every student is from another program than this section (${rejected[0].sectionProgram})`,
      rejected,
    });
    return;
  }
  res.status(201).json({ enrolled: created.map(toEnrollment), rejected });
});

enrollmentsRouter.patch("/students/:id", async (req, res) => {
  const data = parse(enrollmentUpdate, req.body);
  const row = await prisma.enrollment.update({ where: { id: req.params.id }, data: mapStatus(data) });
  res.json(toEnrollment(row));
});

enrollmentsRouter.delete("/students/:id", async (req, res) => {
  await prisma.enrollment.delete({ where: { id: req.params.id } });
  res.status(204).end();
});
