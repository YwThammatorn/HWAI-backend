import { Router } from "express";
import { z } from "zod";
import { prisma } from "../lib/prisma.js";
import { parse } from "../lib/http.js";
import { requireAdmin } from "../lib/access.js";
import { toCourseTemplate, toCurriculumVersion } from "../lib/serialize.js";

export const curriculumRouter = Router();

const programSchema = z.enum(["CECS", "CEI", "CE"]);
const year = z.number().int();

const versionFields = z.object({
  id: z.string().min(1).optional(),
  program: programSchema,
  label: z.string().trim().min(1),
  effectiveFrom: year,
  effectiveTo: year.nullish(), // null = still in use
});
const endsAfterStart = (v: { effectiveFrom?: number; effectiveTo?: number | null }) =>
  v.effectiveFrom === undefined || v.effectiveTo == null || v.effectiveTo >= v.effectiveFrom;
const endsAfterStartIssue = { message: "effectiveTo can't be before effectiveFrom", path: ["effectiveTo"] };
// One version per program and start year (409); a PATCH that only moves one end is checked by the database.
export const versionCreate = versionFields.refine(endsAfterStart, endsAfterStartIssue);
export const versionUpdate = versionFields.omit({ id: true }).partial().refine(endsAfterStart, endsAfterStartIssue);

const templateFields = z.object({
  code: z.string().trim().min(1),
  name: z.string().trim().min(1),
  description: z.string().nullish(),
});
export const templateCreate = templateFields.extend({
  id: z.string().min(1).optional(),
  curriculumVersionId: z.string().min(1).optional(), // path param wins; accepted so the frontend can send its full object
});
export const templateUpdate = templateFields.partial();

// ── Curriculum versions ─────────────────────────────────────────────────────

curriculumRouter.get("/curriculum-versions", async (_req, res) => {
  const rows = await prisma.curriculumVersion.findMany({ orderBy: [{ program: "asc" }, { effectiveFrom: "asc" }] });
  res.json(rows.map(toCurriculumVersion));
});

curriculumRouter.post("/curriculum-versions", async (req, res) => {
  requireAdmin(req);
  const data = parse(versionCreate, req.body);
  const row = await prisma.curriculumVersion.create({ data });
  res.status(201).json(toCurriculumVersion(row));
});

curriculumRouter.patch("/curriculum-versions/:id", async (req, res) => {
  requireAdmin(req);
  const data = parse(versionUpdate, req.body);
  const row = await prisma.curriculumVersion.update({ where: { id: req.params.id }, data });
  res.json(toCurriculumVersion(row));
});

// Course templates cascade-delete via the FK (onDelete: Cascade).
curriculumRouter.delete("/curriculum-versions/:id", async (req, res) => {
  requireAdmin(req);
  await prisma.curriculumVersion.delete({ where: { id: req.params.id } });
  res.status(204).end();
});

// ── Course templates ────────────────────────────────────────────────────────

// All templates across every version — the frontend's CurriculumProvider keeps one flat list.
curriculumRouter.get("/course-templates", async (_req, res) => {
  const rows = await prisma.courseTemplate.findMany({ orderBy: [{ curriculumVersionId: "asc" }, { code: "asc" }] });
  res.json(rows.map(toCourseTemplate));
});

curriculumRouter.get("/curriculum-versions/:id/course-templates", async (req, res) => {
  const rows = await prisma.courseTemplate.findMany({
    where: { curriculumVersionId: req.params.id },
    orderBy: { code: "asc" },
  });
  res.json(rows.map(toCourseTemplate));
});

curriculumRouter.post("/curriculum-versions/:id/course-templates", async (req, res) => {
  requireAdmin(req);
  const { curriculumVersionId: _ignored, ...data } = parse(templateCreate, req.body);
  const row = await prisma.courseTemplate.create({ data: { ...data, curriculumVersionId: req.params.id } });
  res.status(201).json(toCourseTemplate(row));
});

curriculumRouter.patch("/course-templates/:id", async (req, res) => {
  requireAdmin(req);
  const data = parse(templateUpdate, req.body);
  const row = await prisma.courseTemplate.update({ where: { id: req.params.id }, data });
  res.json(toCourseTemplate(row));
});

curriculumRouter.delete("/course-templates/:id", async (req, res) => {
  requireAdmin(req);
  await prisma.courseTemplate.delete({ where: { id: req.params.id } });
  res.status(204).end();
});
