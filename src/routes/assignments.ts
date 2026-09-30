// Assignments, their rubrics and submissions (HWAI-frontend/src/lib/assignments.ts).
import { Router } from "express";
import { z } from "zod";
import { Prisma } from "../generated/prisma/client.js";
import { prisma } from "../lib/prisma.js";
import { parse } from "../lib/http.js";
import {
  attachmentSchema,
  criterionSchema,
  idOverride,
  isoDate,
  submissionStatus,
  toAssignment,
  toRubric,
  toSubmission,
} from "../lib/content.js";

export const assignmentsRouter = Router();

/** An optional JSON column: `null` must be written as Prisma.DbNull, `undefined` leaves it alone. */
const json = <T>(v: T | null | undefined) =>
  v === undefined ? undefined : v === null ? Prisma.DbNull : (v as Prisma.InputJsonValue);

// ── Assignments ──────────────────────────────────────────────────────────────

const assignmentFields = z.object({
  name: z.string().trim().min(1),
  description: z.string(),
  attachments: z.array(attachmentSchema).nullish(),
  dueDate: isoDate.nullish(), // exams have none
  maxPoints: z.number().min(0),
  categoryId: z.string().min(1).nullish(),
  acceptsFiles: z.boolean(),
  fileTypes: z.array(z.enum(["figma", "pdf", "image"])),
  submissionType: z.enum(["individual", "group"]),
  maxGroupSize: z.number().int().positive().nullable(),
  rubricIds: z.array(z.string().min(1)),
  gradingFinalized: z.boolean().optional(),
  isExam: z.boolean().optional(),
});
export const assignmentCreate = assignmentFields.extend({
  ...idOverride,
  courseId: z.string().optional(), // the path's courseId wins
  description: assignmentFields.shape.description.default(""),
  acceptsFiles: assignmentFields.shape.acceptsFiles.default(true),
  fileTypes: assignmentFields.shape.fileTypes.default([]),
  submissionType: assignmentFields.shape.submissionType.default("individual"),
  maxGroupSize: assignmentFields.shape.maxGroupSize.default(null),
  rubricIds: assignmentFields.shape.rubricIds.default([]),
});
export const assignmentUpdate = assignmentFields.partial();

function assignmentData<T extends { attachments?: unknown; dueDate?: string | null }>(data: T) {
  const { attachments, dueDate, ...rest } = data;
  return {
    ...rest,
    attachments: json(attachments),
    dueDate: dueDate === undefined ? undefined : dueDate === null ? null : new Date(`${dueDate}T00:00:00Z`),
  };
}

assignmentsRouter.get("/assignments", async (_req, res) => {
  const rows = await prisma.assignment.findMany({ orderBy: { createdAt: "asc" } });
  res.json(rows.map(toAssignment));
});

assignmentsRouter.get("/courses/:courseId/assignments", async (req, res) => {
  const rows = await prisma.assignment.findMany({ where: { courseId: req.params.courseId }, orderBy: { createdAt: "asc" } });
  res.json(rows.map(toAssignment));
});

assignmentsRouter.get("/assignments/:id", async (req, res) => {
  const row = await prisma.assignment.findUniqueOrThrow({ where: { id: req.params.id } });
  res.json(toAssignment(row));
});

assignmentsRouter.post("/courses/:courseId/assignments", async (req, res) => {
  const { courseId: _ignored, ...data } = parse(assignmentCreate, req.body);
  const row = await prisma.assignment.create({ data: { ...assignmentData(data), courseId: req.params.courseId } });
  res.status(201).json(toAssignment(row));
});

assignmentsRouter.patch("/assignments/:id", async (req, res) => {
  const data = parse(assignmentUpdate, req.body);
  const row = await prisma.assignment.update({ where: { id: req.params.id }, data: assignmentData(data) });
  res.json(toAssignment(row));
});

// Rubrics, submissions and student groups cascade-delete via their FKs.
assignmentsRouter.delete("/assignments/:id", async (req, res) => {
  await prisma.assignment.delete({ where: { id: req.params.id } });
  res.status(204).end();
});

// ── Rubrics ──────────────────────────────────────────────────────────────────

const rubricFields = z.object({
  name: z.string().trim().min(1),
  criteria: z.array(criterionSchema),
});
export const rubricCreate = rubricFields.extend({ ...idOverride, assignmentId: z.string().optional() });
export const rubricUpdate = rubricFields.partial();

assignmentsRouter.get("/rubrics", async (_req, res) => {
  const rows = await prisma.rubric.findMany({ orderBy: { createdAt: "asc" } });
  res.json(rows.map(toRubric));
});

assignmentsRouter.get("/assignments/:id/rubrics", async (req, res) => {
  const rows = await prisma.rubric.findMany({ where: { assignmentId: req.params.id }, orderBy: { createdAt: "asc" } });
  res.json(rows.map(toRubric));
});

assignmentsRouter.post("/assignments/:id/rubrics", async (req, res) => {
  const { assignmentId: _ignored, criteria, ...data } = parse(rubricCreate, req.body);
  const row = await prisma.rubric.create({
    data: { ...data, criteria: criteria as Prisma.InputJsonValue, assignmentId: req.params.id },
  });
  res.status(201).json(toRubric(row));
});

assignmentsRouter.patch("/rubrics/:id", async (req, res) => {
  const { criteria, ...data } = parse(rubricUpdate, req.body);
  const row = await prisma.rubric.update({
    where: { id: req.params.id },
    data: { ...data, ...(criteria && { criteria: criteria as Prisma.InputJsonValue }) },
  });
  res.json(toRubric(row));
});

assignmentsRouter.delete("/rubrics/:id", async (req, res) => {
  await prisma.rubric.delete({ where: { id: req.params.id } });
  res.status(204).end();
});

// ── Submissions ──────────────────────────────────────────────────────────────

const statusSchema = z.enum(["not_graded", "need_review", "graded"]);
const score = z.number().min(0).nullable();
export const submissionCreate = z.object({
  ...idOverride,
  assignmentId: z.string().optional(), // the path's assignmentId wins
  studentId: z.string().trim().min(1),
  studentName: z.string(),
  email: z.string(),
  submittedAt: z.iso.datetime(),
  fileUrl: z.string().nullable().default(null),
  attachments: z.array(attachmentSchema).nullish(),
  aiScore: score.default(null),
  instructorScore: score.default(null),
  instructorComment: z.string().default(""),
  criterionComments: z.record(z.string(), z.string()).nullish(),
  criterionScores: z.record(z.string(), z.number()).nullish(),
  externalUseConsent: z.boolean().default(false),
  status: statusSchema.default("not_graded"),
  groupId: z.string().min(1).nullish(),
});
// Exactly what the frontend's updateSubmission() may change.
export const submissionUpdate = z.object({
  aiScore: score,
  instructorScore: score,
  instructorComment: z.string(),
  criterionComments: z.record(z.string(), z.string()).nullable(),
  criterionScores: z.record(z.string(), z.number()).nullable(),
  status: statusSchema,
  fileUrl: z.string().nullable(),
  attachments: z.array(attachmentSchema).nullable(),
}).partial();

function submissionData<T extends {
  attachments?: unknown; criterionComments?: unknown; criterionScores?: unknown;
  status?: z.infer<typeof statusSchema>; submittedAt?: string;
}>(data: T) {
  const { attachments, criterionComments, criterionScores, status, submittedAt, ...rest } = data;
  return {
    ...rest,
    attachments: json(attachments),
    criterionComments: json(criterionComments),
    criterionScores: json(criterionScores),
    ...(status && { status: submissionStatus.toDb(status) }),
    ...(submittedAt && { submittedAt: new Date(submittedAt) }),
  };
}

assignmentsRouter.get("/submissions", async (_req, res) => {
  const rows = await prisma.submission.findMany({ orderBy: { submittedAt: "asc" } });
  res.json(rows.map(toSubmission));
});

assignmentsRouter.get("/assignments/:id/submissions", async (req, res) => {
  const rows = await prisma.submission.findMany({ where: { assignmentId: req.params.id }, orderBy: { submittedAt: "asc" } });
  res.json(rows.map(toSubmission));
});

// One submission per student per assignment (409 on a second one — resubmitting is a PATCH).
assignmentsRouter.post("/assignments/:id/submissions", async (req, res) => {
  const { assignmentId: _ignored, ...data } = parse(submissionCreate, req.body);
  const row = await prisma.submission.create({
    data: { ...submissionData(data), submittedAt: new Date(data.submittedAt), assignmentId: req.params.id },
  });
  res.status(201).json(toSubmission(row));
});

assignmentsRouter.patch("/submissions/:id", async (req, res) => {
  const data = parse(submissionUpdate, req.body);
  const row = await prisma.submission.update({ where: { id: req.params.id }, data: submissionData(data) });
  res.json(toSubmission(row));
});
