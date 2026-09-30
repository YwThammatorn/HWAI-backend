// Course rosters — `Student` on the frontend (src/lib/students.ts), `enrollments` in the database.
import { Router } from "express";
import { z } from "zod";
import { prisma } from "../lib/prisma.js";
import { parse } from "../lib/http.js";
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

// Takes an array (single enrol and CSV import share it). Numbering continues after the current roster
// and a student added to a non-empty roster counts as "added-midterm" — unless the client says otherwise
// (the same rule as the frontend's StudentProvider). All-or-nothing: one duplicate rejects the batch (409).
enrollmentsRouter.post("/courses/:courseId/students", async (req, res) => {
  const courseId = req.params.courseId;
  const items = parse(z.array(enrollmentCreate), req.body);
  const rows = await prisma.$transaction(async (tx) => {
    const existing = await tx.enrollment.count({ where: { courseId } });
    let nextSeq = existing + 1;
    const created = [];
    for (const item of items) {
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
    return created;
  });
  res.status(201).json(rows.map(toEnrollment));
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
