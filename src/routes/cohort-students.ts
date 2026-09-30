import { Router } from "express";
import { z } from "zod";
import { prisma } from "../lib/prisma.js";
import { HttpError, parse } from "../lib/http.js";
import { toCohortStudent } from "../lib/serialize.js";

export const cohortStudentsRouter = Router();

const studentFields = z.object({
  studentId: z.string().trim().min(1),
  title: z.string().trim().nullish(),
  firstName: z.string().trim().min(1),
  lastName: z.string().trim().min(1),
  email: z.string().trim().min(1),
  program: z.string().trim().min(1),
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

cohortStudentsRouter.get("/cohort-students", async (_req, res) => {
  const rows = await prisma.student.findMany({ orderBy: { studentId: "asc" } });
  res.json(rows.map(toCohortStudent));
});

// Takes an array (single add and CSV import share this endpoint). All-or-nothing: one duplicate
// studentId rejects the whole batch with 409.
cohortStudentsRouter.post("/cohort-students", async (req, res) => {
  const items = parse(z.array(studentCreate), req.body);
  const rows = await prisma.$transaction(items.map((data) => prisma.student.create({ data })));
  res.status(201).json(rows.map(toCohortStudent));
});

// All-or-nothing: if any id doesn't exist, nothing is changed and the response is 404.
cohortStudentsRouter.patch("/cohort-students", async (req, res) => {
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
  const data = parse(studentUpdate, req.body);
  const row = await prisma.student.update({ where: { id: req.params.id }, data });
  res.json(toCohortStudent(row));
});

cohortStudentsRouter.delete("/cohort-students/:id", async (req, res) => {
  await prisma.student.delete({ where: { id: req.params.id } });
  res.status(204).end();
});
