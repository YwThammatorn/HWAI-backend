import { Router } from "express";
import { z } from "zod";
import { prisma } from "../lib/prisma.js";
import { parse } from "../lib/http.js";
import { toManagedTeacher } from "../lib/serialize.js";

export const managedTeachersRouter = Router();

const include = { courses: { select: { courseId: true }, orderBy: { assignedAt: "asc" } } } as const;

const status = z.enum(["active", "inactive"]);
const teacherFields = z.object({
  title: z.string().trim().nullish(),
  name: z.string().trim().min(1),
  email: z.string().trim().toLowerCase().pipe(z.email()),
  role: z.enum(["teacher", "ta"]),
});
export const teacherCreate = teacherFields.extend({ id: z.string().min(1).optional() });
export const teacherUpdate = teacherFields.partial().extend({
  status: status.optional(),
  courseIds: z.array(z.string().min(1)).optional(),
});

managedTeachersRouter.get("/managed-teachers", async (_req, res) => {
  const rows = await prisma.teacher.findMany({ include, orderBy: { createdAt: "asc" } });
  res.json(rows.map(toManagedTeacher));
});

managedTeachersRouter.post("/managed-teachers", async (req, res) => {
  const data = parse(teacherCreate, req.body);
  const row = await prisma.teacher.create({ data, include });
  res.status(201).json(toManagedTeacher(row));
});

// All-or-nothing: one duplicate email rejects the whole batch with 409.
managedTeachersRouter.post("/managed-teachers/import", async (req, res) => {
  const items = parse(z.array(teacherCreate), req.body);
  const rows = await prisma.$transaction(items.map((data) => prisma.teacher.create({ data, include })));
  res.status(201).json(rows.map(toManagedTeacher));
});

managedTeachersRouter.patch("/managed-teachers/:id", async (req, res) => {
  const { courseIds, ...data } = parse(teacherUpdate, req.body);
  const row = await prisma.teacher.update({
    where: { id: req.params.id },
    data: {
      ...data,
      ...(courseIds && {
        courses: { deleteMany: {}, create: [...new Set(courseIds)].map((courseId) => ({ courseId })) },
      }),
    },
    include,
  });
  res.json(toManagedTeacher(row));
});

managedTeachersRouter.patch("/managed-teachers/:id/status", async (req, res) => {
  const body = parse(z.object({ status }), req.body);
  await prisma.teacher.update({ where: { id: req.params.id }, data: { status: body.status } });
  res.status(204).end();
});

// Course assignments (course_teachers) cascade-delete via the FK. Section roles / grading assignments still live in
// frontend localStorage and are cascaded there.
managedTeachersRouter.delete("/managed-teachers/:id", async (req, res) => {
  await prisma.teacher.delete({ where: { id: req.params.id } });
  res.status(204).end();
});

// Idempotent — assigning twice is a no-op.
managedTeachersRouter.post("/managed-teachers/:id/courses/:courseId", async (req, res) => {
  const { id: teacherId, courseId } = req.params;
  await prisma.courseTeacher.upsert({
    where: { courseId_teacherId: { courseId, teacherId } },
    create: { teacherId, courseId },
    update: {},
  });
  res.status(204).end();
});

managedTeachersRouter.delete("/managed-teachers/:id/courses/:courseId", async (req, res) => {
  await prisma.courseTeacher.deleteMany({ where: { teacherId: req.params.id, courseId: req.params.courseId } });
  res.status(204).end();
});
