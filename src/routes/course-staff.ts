// Course staff and outcomes: section roles ("Collaborators") and CLOs
// (HWAI-frontend/src/lib/section-roles.ts, src/lib/clo.ts).
import { Router } from "express";
import { z } from "zod";
import type { Clo, SectionRole } from "../generated/prisma/client.js";
import { Prisma } from "../generated/prisma/client.js";
import { prisma } from "../lib/prisma.js";
import { HttpError, parse } from "../lib/http.js";

export const courseStaffRouter = Router();

const iso = (d: Date) => d.toISOString();

// ── Section roles ────────────────────────────────────────────────────────────

const ROLE_TO_DB = { teacher: "teacher", ta: "ta", "co-teacher": "coTeacher" } as const;
const ROLE_TO_API = { teacher: "teacher", ta: "ta", coTeacher: "co-teacher" } as const;
type ApiRole = keyof typeof ROLE_TO_DB;

const permissionsSchema = z.object({
  canManageRoster: z.boolean(),
  canEditSettings: z.boolean(),
  canPublishScores: z.boolean(),
});

export const sectionRoleCreate = z.object({
  id: z.string().min(1).optional(),
  courseId: z.string().optional(), // the path's courseId wins
  /** A students.id (TA) or teachers.id (co-teacher) — the frontend's CohortStudent.id / ManagedTeacher.id. */
  accountId: z.string().min(1),
  role: z.enum(["teacher", "ta", "co-teacher"]),
});

/** `accountId` on the way out: whichever of teacher_id / student_id is set. */
function toSectionRole(r: SectionRole) {
  return {
    id: r.id,
    accountId: (r.teacherId ?? r.studentId)!,
    courseId: r.courseId,
    role: ROLE_TO_API[r.role],
    ...(r.permissions !== null && { permissions: r.permissions }),
  };
}

/** Which table `accountId` lives in, and whether that kind of account can hold `role`. */
async function resolveAccount(accountId: string, role: ApiRole) {
  const teacher = await prisma.teacher.findUnique({ where: { id: accountId }, select: { role: true } });
  if (teacher) {
    // A co-teacher gets full access, so only a teacher-role account may be one; a TA-role teacher
    // account can still be a TA (with TA's restricted defaults).
    if (role !== "ta" && teacher.role !== "teacher") throw new HttpError(400, "Only a teacher account can be a co-teacher");
    return { teacherId: accountId };
  }
  const student = await prisma.student.findUnique({ where: { id: accountId }, select: { id: true } });
  if (student) {
    if (role !== "ta") throw new HttpError(400, "A student can only be a TA");
    return { studentId: accountId };
  }
  throw new HttpError(400, "accountId is neither a teacher nor a student");
}

courseStaffRouter.get("/section-roles", async (_req, res) => {
  const rows = await prisma.sectionRole.findMany({ orderBy: { createdAt: "asc" } });
  res.json(rows.map(toSectionRole));
});

courseStaffRouter.get("/courses/:courseId/roles", async (req, res) => {
  const rows = await prisma.sectionRole.findMany({ where: { courseId: req.params.courseId }, orderBy: { createdAt: "asc" } });
  res.json(rows.map(toSectionRole));
});

// One role per person per course (409 on a second).
courseStaffRouter.post("/courses/:courseId/roles", async (req, res) => {
  const { id, accountId, role } = parse(sectionRoleCreate, req.body);
  const account = await resolveAccount(accountId, role);
  const row = await prisma.sectionRole.create({
    data: { ...(id && { id }), courseId: req.params.courseId, role: ROLE_TO_DB[role], ...account },
  });
  res.status(201).json(toSectionRole(row));
});

courseStaffRouter.patch("/section-roles/:id/permissions", async (req, res) => {
  const permissions = parse(permissionsSchema.nullable(), req.body);
  const row = await prisma.sectionRole.update({
    where: { id: req.params.id },
    data: { permissions: permissions === null ? Prisma.DbNull : permissions },
  });
  res.json(toSectionRole(row));
});

courseStaffRouter.delete("/section-roles/:id", async (req, res) => {
  await prisma.sectionRole.delete({ where: { id: req.params.id } });
  res.status(204).end();
});

// ── CLOs ─────────────────────────────────────────────────────────────────────

const cloFields = z.object({
  code: z.string().trim().min(1),
  text: z.string().trim().min(1),
});
export const cloCreate = cloFields.extend({ id: z.string().min(1).optional(), courseId: z.string().optional() });
export const cloUpdate = cloFields.partial();

function toClo(c: Clo) {
  return { id: c.id, courseId: c.courseId, code: c.code, text: c.text, createdAt: iso(c.createdAt), updatedAt: iso(c.updatedAt) };
}

courseStaffRouter.get("/clos", async (_req, res) => {
  const rows = await prisma.clo.findMany({ orderBy: [{ courseId: "asc" }, { createdAt: "asc" }] });
  res.json(rows.map(toClo));
});

courseStaffRouter.get("/courses/:courseId/clos", async (req, res) => {
  const rows = await prisma.clo.findMany({ where: { courseId: req.params.courseId }, orderBy: { createdAt: "asc" } });
  res.json(rows.map(toClo));
});

courseStaffRouter.post("/courses/:courseId/clos", async (req, res) => {
  const { courseId: _ignored, ...data } = parse(cloCreate, req.body);
  const row = await prisma.clo.create({ data: { ...data, courseId: req.params.courseId } });
  res.status(201).json(toClo(row));
});

courseStaffRouter.patch("/clos/:id", async (req, res) => {
  const data = parse(cloUpdate, req.body);
  const row = await prisma.clo.update({ where: { id: req.params.id }, data });
  res.json(toClo(row));
});

courseStaffRouter.delete("/clos/:id", async (req, res) => {
  await prisma.clo.delete({ where: { id: req.params.id } });
  res.status(204).end();
});
