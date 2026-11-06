import { Router } from "express";
import { z } from "zod";
import { prisma } from "../lib/prisma.js";
import { Prisma } from "../generated/prisma/client.js";
import { HttpError, parse } from "../lib/http.js";
import { requireAdmin } from "../lib/access.js";
import { removeKind, splitUserFields, userFor } from "../lib/accounts.js";
import { teacherInclude, toManagedTeacher } from "../lib/serialize.js";

export const managedTeachersRouter = Router();

// A ManagedTeacher is a user (title, name, email, status) who is a teacher; its id is the user id. courseIds are
// the sections they teach: section_roles with role "teacher", which only an admin assigns (here).

const status = z.enum(["active", "inactive"]);
const teacherFields = z.object({
  title: z.string().trim().nullish(),
  name: z.string().trim().min(1),
  email: z.string().trim().toLowerCase().pipe(z.email()),
  role: z.string().optional(), // accepted and ignored: a teacher account is a teacher
});
export const teacherCreate = teacherFields.extend({ id: z.string().min(1).optional(), status: status.optional() });
export const teacherUpdate = teacherFields.partial().extend({
  status: status.optional(),
  courseIds: z.array(z.string().min(1)).optional(),
});

const findTeacher = (tx: Pick<typeof prisma, "teacher">, userId: string) =>
  tx.teacher.findUniqueOrThrow({ where: { userId }, include: teacherInclude });

managedTeachersRouter.get("/managed-teachers", async (_req, res) => {
  const rows = await prisma.teacher.findMany({ include: teacherInclude, orderBy: { user: { createdAt: "asc" } } });
  res.json(rows.map(toManagedTeacher));
});

/** Makes `data` a teacher: a new user, or an existing one (e.g. an admin) who now teaches. */
async function createTeacher(tx: Parameters<Parameters<typeof prisma.$transaction>[0]>[0], data: z.infer<typeof teacherCreate>) {
  const userId = await userFor(tx, "teacher", data);
  await tx.teacher.create({ data: { userId } });
  return findTeacher(tx, userId);
}

managedTeachersRouter.post("/managed-teachers", async (req, res) => {
  requireAdmin(req);
  const data = parse(teacherCreate, req.body);
  const row = await prisma.$transaction((tx) => createTeacher(tx, data));
  res.status(201).json(toManagedTeacher(row));
});

// All-or-nothing: one duplicate email rejects the whole batch with 409.
managedTeachersRouter.post("/managed-teachers/import", async (req, res) => {
  requireAdmin(req);
  const items = parse(z.array(teacherCreate), req.body);
  const rows = await prisma.$transaction(async (tx) => {
    const out = [];
    for (const data of items) out.push(await createTeacher(tx, data));
    return out;
  });
  res.status(201).json(rows.map(toManagedTeacher));
});

type Tx = Parameters<Parameters<typeof prisma.$transaction>[0]>[0];

/** Makes them the teacher of `courseId` — over a co-teacher role they had there (the assigned teacher wins). */
async function assignCourse(tx: Tx, userId: string, courseId: string) {
  await tx.sectionRole.upsert({
    where: { courseId_userId: { courseId, userId } },
    create: { courseId, userId, role: "teacher" },
    update: { role: "teacher", permissions: Prisma.DbNull },
  });
}

// title / name / email / status are the user's; courseIds (replaces the courses they teach) section roles.
managedTeachersRouter.patch("/managed-teachers/:id", async (req, res) => {
  requireAdmin(req);
  const { courseIds, ...data } = parse(teacherUpdate, req.body);
  const { user, rest } = splitUserFields(data);
  const row = await prisma.$transaction(async (tx) => {
    await tx.teacher.findUniqueOrThrow({ where: { userId: req.params.id }, select: { userId: true } });
    void rest; // role: ignored
    if (Object.keys(user).length > 0) await tx.user.update({ where: { id: req.params.id }, data: user });
    if (courseIds) {
      const keep = [...new Set(courseIds)];
      await tx.sectionRole.deleteMany({ where: { userId: req.params.id, role: "teacher", courseId: { notIn: keep } } });
      for (const courseId of keep) await assignCourse(tx, req.params.id, courseId);
    }
    return findTeacher(tx, req.params.id);
  });
  res.json(toManagedTeacher(row));
});

// May they sign in at all — the user's status (it applies to everything they are).
managedTeachersRouter.patch("/managed-teachers/:id/status", async (req, res) => {
  requireAdmin(req);
  const body = parse(z.object({ status }), req.body);
  const teacher = await prisma.teacher.findUnique({ where: { userId: req.params.id }, select: { userId: true } });
  if (!teacher) throw new HttpError(404, "Not found");
  await prisma.user.update({ where: { id: req.params.id }, data: { status: body.status } });
  res.status(204).end();
});

// No longer a teacher: their course assignments and co-teacher roles go; so does the user when they are
// nothing else (an admin who also taught stays an admin).
managedTeachersRouter.delete("/managed-teachers/:id", async (req, res) => {
  requireAdmin(req);
  await prisma.$transaction((tx) => removeKind(tx, "teacher", req.params.id));
  res.status(204).end();
});

// Idempotent — assigning twice is a no-op.
managedTeachersRouter.post("/managed-teachers/:id/courses/:courseId", async (req, res) => {
  requireAdmin(req);
  const { id: userId, courseId } = req.params;
  await prisma.$transaction(async (tx) => {
    await tx.teacher.findUniqueOrThrow({ where: { userId }, select: { userId: true } });
    await assignCourse(tx, userId, courseId);
  });
  res.status(204).end();
});

managedTeachersRouter.delete("/managed-teachers/:id/courses/:courseId", async (req, res) => {
  requireAdmin(req);
  await prisma.sectionRole.deleteMany({ where: { userId: req.params.id, courseId: req.params.courseId, role: "teacher" } });
  res.status(204).end();
});
