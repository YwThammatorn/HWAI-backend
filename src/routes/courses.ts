import { Router } from "express";
import { z } from "zod";
import { prisma } from "../lib/prisma.js";
import { parse } from "../lib/http.js";
import { termFromApi, toCourse, toManagedTeacher } from "../lib/serialize.js";

export const coursesRouter = Router();

const courseFields = z.object({
  name: z.string().trim().min(1),
  description: z.string(),
  status: z.enum(["active", "archived"]),
  source: z.enum(["manual", "google", "teams"]),
  coverColor: z.string().min(1),
  icon: z.enum(["book", "chart", "flask", "code", "palette", "laptop", "graduation", "globe"]), // COURSE_ICON_KEYS in HWAI-frontend
  code: z.string().nullish(),
  courseTemplateId: z.string().nullish(),
  academicYear: z.number().int().nullish(),
  term: z.union([z.literal(1), z.literal(2), z.literal("summer")]).nullish(),
  sectionNumber: z.string().nullish(),
  gradingSource: z.enum(["ta", "ai", "blind"]).nullish(),
  publishMode: z.enum(["auto", "manual"]).nullish(),
  schedule: z.string().nullish(),
  room: z.string().nullish(),
});

export const courseCreate = courseFields.extend({
  id: z.string().min(1).optional(),
  description: courseFields.shape.description.default(""),
  status: courseFields.shape.status.default("active"),
  source: courseFields.shape.source.default("manual"),
  icon: courseFields.shape.icon.default("book"),
});
export const courseUpdate = courseFields.partial();

function mapTerm<T extends { term?: 1 | 2 | "summer" | null }>(data: T) {
  const { term, ...rest } = data;
  if (term === undefined) return rest;
  return { ...rest, term: term === null ? null : termFromApi(term) };
}

coursesRouter.get("/courses", async (_req, res) => {
  const rows = await prisma.course.findMany({ orderBy: { createdAt: "asc" } });
  res.json(rows.map(toCourse));
});

coursesRouter.get("/courses/:id", async (req, res) => {
  const row = await prisma.course.findUniqueOrThrow({ where: { id: req.params.id } });
  res.json(toCourse(row));
});

coursesRouter.post("/courses", async (req, res) => {
  const data = parse(courseCreate, req.body);
  const row = await prisma.course.create({ data: mapTerm(data) });
  res.status(201).json(toCourse(row));
});

coursesRouter.patch("/courses/:id", async (req, res) => {
  const data = parse(courseUpdate, req.body);
  const row = await prisma.course.update({ where: { id: req.params.id }, data: mapTerm(data) });
  res.json(toCourse(row));
});

// Teacher assignments (teacher_courses) cascade-delete via the FK.
coursesRouter.delete("/courses/:id", async (req, res) => {
  await prisma.course.delete({ where: { id: req.params.id } });
  res.status(204).end();
});

coursesRouter.get("/courses/:id/teachers", async (req, res) => {
  const rows = await prisma.managedTeacher.findMany({
    where: { courses: { some: { courseId: req.params.id } } },
    include: { courses: { select: { courseId: true } } },
    orderBy: { createdAt: "asc" },
  });
  res.json(rows.map(toManagedTeacher));
});
