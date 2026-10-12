// Rubric tools: the reuse library (RubricLibraryEntry) and AI calibration runs (CalibrationRun) —
// HWAI-frontend/src/lib/rubricLibrary.ts and src/lib/calibration.ts.
import { Router } from "express";
import { z } from "zod";
import type { CalibrationRun, RubricLibraryEntry } from "../generated/prisma/client.js";
import { Prisma } from "../generated/prisma/client.js";
import { prisma } from "../lib/prisma.js";
import { parse } from "../lib/http.js";
import { criterionSchema } from "../lib/content.js";

export const rubricToolsRouter = Router();

const iso = (d: Date) => d.toISOString();
const json = <T>(v: T | null | undefined) =>
  v === undefined ? undefined : v === null ? Prisma.DbNull : (v as Prisma.InputJsonValue);

// ── Rubric library ───────────────────────────────────────────────────────────

export const libraryEntryCreate = z.object({
  id: z.string().min(1).optional(),
  name: z.string().trim().min(1),
  courseTemplateId: z.string().min(1).nullish(), // none = offered for every course
  criteria: z.array(criterionSchema),
  sourceAssignmentId: z.string().min(1).nullish(),
});
// The frontend only renames an entry (renameEntry).
export const libraryEntryUpdate = z.object({ name: z.string().trim().min(1) });

function toLibraryEntry(e: RubricLibraryEntry) {
  return {
    id: e.id,
    name: e.name,
    ...(e.courseTemplateId !== null && { courseTemplateId: e.courseTemplateId }),
    criteria: e.criteria,
    ...(e.sourceAssignmentId !== null && { sourceAssignmentId: e.sourceAssignmentId }),
    createdAt: iso(e.createdAt),
  };
}

rubricToolsRouter.get("/rubric-library", async (req, res) => {
  // ?courseTemplateId=… → that subject's entries plus the ones offered for every course
  const tpl = typeof req.query.courseTemplateId === "string" ? req.query.courseTemplateId : undefined;
  const rows = await prisma.rubricLibraryEntry.findMany({
    where: tpl ? { OR: [{ courseTemplateId: tpl }, { courseTemplateId: null }] } : undefined,
    orderBy: { createdAt: "asc" },
  });
  res.json(rows.map(toLibraryEntry));
});

rubricToolsRouter.post("/rubric-library", async (req, res) => {
  const { criteria, ...data } = parse(libraryEntryCreate, req.body);
  const row = await prisma.rubricLibraryEntry.create({ data: { ...data, criteria: criteria as Prisma.InputJsonValue } });
  res.status(201).json(toLibraryEntry(row));
});

rubricToolsRouter.patch("/rubric-library/:id", async (req, res) => {
  const data = parse(libraryEntryUpdate, req.body);
  const row = await prisma.rubricLibraryEntry.update({ where: { id: req.params.id }, data });
  res.json(toLibraryEntry(row));
});

rubricToolsRouter.delete("/rubric-library/:id", async (req, res) => {
  await prisma.rubricLibraryEntry.delete({ where: { id: req.params.id } });
  res.status(204).end();
});

// ── Calibration runs ─────────────────────────────────────────────────────────

const levels = z.record(z.string(), z.record(z.string(), z.number().int().min(0)));
// The frontend's saveRun() creates or replaces a whole run, so it's a PUT with the full run.
export const calibrationRunPut = z.object({
  id: z.string().min(1).optional(), // the path's id wins
  assignmentId: z.string().min(1),
  createdAt: z.iso.datetime(),
  sampleIds: z.array(z.string().min(1)),
  teacherLevels: levels,
  completedAt: z.iso.datetime().nullish(),
  appliedAt: z.iso.datetime().nullish(),
  appliedOffsets: z.record(z.string(), z.number()).nullish(),
});

function toCalibrationRun(r: CalibrationRun) {
  return {
    id: r.id,
    assignmentId: r.assignmentId,
    createdAt: iso(r.createdAt),
    sampleIds: r.sampleIds,
    teacherLevels: r.teacherLevels,
    ...(r.completedAt && { completedAt: iso(r.completedAt) }),
    ...(r.appliedAt && { appliedAt: iso(r.appliedAt) }),
    ...(r.appliedOffsets !== null && { appliedOffsets: r.appliedOffsets }),
  };
}

rubricToolsRouter.get("/calibration-runs", async (req, res) => {
  const assignmentId = typeof req.query.assignmentId === "string" ? req.query.assignmentId : undefined;
  const rows = await prisma.calibrationRun.findMany({ where: assignmentId ? { assignmentId } : undefined, orderBy: { createdAt: "asc" } });
  res.json(rows.map(toCalibrationRun));
});

rubricToolsRouter.put("/calibration-runs/:id", async (req, res) => {
  const { id: _ignored, teacherLevels, appliedOffsets, createdAt, completedAt, appliedAt, ...rest } = parse(calibrationRunPut, req.body);
  const date = (v: string | null | undefined) => (v ? new Date(v) : null);
  const data = {
    ...rest,
    teacherLevels: teacherLevels as Prisma.InputJsonValue,
    appliedOffsets: json(appliedOffsets ?? null),
    createdAt: new Date(createdAt),
    completedAt: date(completedAt),
    appliedAt: date(appliedAt),
  };
  const existed = await prisma.calibrationRun.findUnique({ where: { id: req.params.id }, select: { id: true } });
  const row = await prisma.calibrationRun.upsert({ where: { id: req.params.id }, create: { id: req.params.id, ...data }, update: data });
  res.status(existed ? 200 : 201).json(toCalibrationRun(row));
});

rubricToolsRouter.delete("/calibration-runs/:id", async (req, res) => {
  await prisma.calibrationRun.delete({ where: { id: req.params.id } });
  res.status(204).end();
});
