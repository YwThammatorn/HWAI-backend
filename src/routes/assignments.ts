// Assignments, their rubrics and submissions (HWAI-frontend/src/lib/assignments.ts).
import { Router } from "express";
import { z } from "zod";
import { Prisma, type Submission } from "../generated/prisma/client.js";
import { prisma } from "../lib/prisma.js";
import { HttpError, parse } from "../lib/http.js";
import {
  courseFilter,
  courseOfAssignment,
  courseOfRubric,
  requireMember,
  requireStaff,
  visibleCourses,
} from "../lib/access.js";
import { principalOf, type Principal } from "../lib/auth.js";
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
  gradingMode: z.enum(["ai", "manual"]).nullish(), // teacher's choice; null = not chosen yet
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

// Members of a course read its assignments. Creating, editing and deleting one is a course setting
// (canEditSettings); any staff may pick the grading mode, and announcing results (gradingFinalized)
// needs canPublishScores.
assignmentsRouter.get("/assignments", async (req, res) => {
  const courseId = courseFilter(await visibleCourses(principalOf(req)));
  const rows = await prisma.assignment.findMany({ where: courseId && { courseId }, orderBy: { createdAt: "asc" } });
  res.json(rows.map(toAssignment));
});

assignmentsRouter.get("/courses/:courseId/assignments", async (req, res) => {
  await requireMember(req, req.params.courseId);
  const rows = await prisma.assignment.findMany({ where: { courseId: req.params.courseId }, orderBy: { createdAt: "asc" } });
  res.json(rows.map(toAssignment));
});

assignmentsRouter.get("/assignments/:id", async (req, res) => {
  const row = await prisma.assignment.findUniqueOrThrow({ where: { id: req.params.id } });
  await requireMember(req, row.courseId);
  res.json(toAssignment(row));
});

assignmentsRouter.post("/courses/:courseId/assignments", async (req, res) => {
  await requireStaff(req, req.params.courseId, "canEditSettings");
  const { courseId: _ignored, ...data } = parse(assignmentCreate, req.body);
  const row = await prisma.assignment.create({ data: { ...assignmentData(data), courseId: req.params.courseId } });
  res.status(201).json(toAssignment(row));
});

assignmentsRouter.patch("/assignments/:id", async (req, res) => {
  const data = parse(assignmentUpdate, req.body);
  const current = await prisma.assignment.findUniqueOrThrow({ where: { id: req.params.id }, select: { courseId: true, gradingFinalized: true } });
  const perms = await requireStaff(req, current.courseId);
  const announcing = data.gradingFinalized !== undefined && data.gradingFinalized !== current.gradingFinalized;
  if (announcing && !perms.canPublishScores) throw new HttpError(403, "You need the canPublishScores permission in this course");
  const settings = Object.keys(data).filter((k) => k !== "gradingFinalized" && k !== "gradingMode");
  if (settings.length > 0 && !perms.canEditSettings) throw new HttpError(403, "You need the canEditSettings permission in this course");
  const row = await prisma.assignment.update({ where: { id: req.params.id }, data: assignmentData(data) });
  res.json(toAssignment(row));
});

// Rubrics, submissions and student groups cascade-delete via their FKs.
assignmentsRouter.delete("/assignments/:id", async (req, res) => {
  await requireStaff(req, await courseOfAssignment(req.params.id), "canEditSettings");
  await prisma.assignment.delete({ where: { id: req.params.id } });
  res.status(204).end();
});

// ── Rubrics ──────────────────────────────────────────────────────────────────

const rubricFields = z.object({
  name: z.string().trim().min(1),
  criteria: z.array(criterionSchema),
  aiOffsets: z.record(z.string(), z.number()).nullish(), // set from the Calibration page
});
export const rubricCreate = rubricFields.extend({ ...idOverride, assignmentId: z.string().optional() });
export const rubricUpdate = rubricFields.partial();

/** A rubric as a student sees it: no AI calibration offsets. */
const rubricForStudent = (r: Parameters<typeof toRubric>[0]) => toRubric({ ...r, aiOffsets: null });

// Members read rubrics (students without the AI offsets). Editing a rubric is a course setting
// (canEditSettings); the AI offsets alone (Calibration page) any staff may set.
assignmentsRouter.get("/rubrics", async (req, res) => {
  const v = await visibleCourses(principalOf(req));
  const courseId = courseFilter(v);
  const rows = await prisma.rubric.findMany({
    where: courseId && { assignment: { courseId } },
    include: { assignment: { select: { courseId: true } } },
    orderBy: { createdAt: "asc" },
  });
  res.json(rows.map(({ assignment, ...r }) => (v === "all" || v.staff.has(assignment.courseId) ? toRubric(r) : rubricForStudent(r))));
});

assignmentsRouter.get("/assignments/:id/rubrics", async (req, res) => {
  const access = await requireMember(req, await courseOfAssignment(req.params.id));
  const rows = await prisma.rubric.findMany({ where: { assignmentId: req.params.id }, orderBy: { createdAt: "asc" } });
  res.json(rows.map(access.staff ? toRubric : rubricForStudent));
});

assignmentsRouter.post("/assignments/:id/rubrics", async (req, res) => {
  await requireStaff(req, await courseOfAssignment(req.params.id), "canEditSettings");
  const { assignmentId: _ignored, criteria, aiOffsets, ...data } = parse(rubricCreate, req.body);
  const row = await prisma.rubric.create({
    data: { ...data, criteria: criteria as Prisma.InputJsonValue, aiOffsets: json(aiOffsets), assignmentId: req.params.id },
  });
  res.status(201).json(toRubric(row));
});

assignmentsRouter.patch("/rubrics/:id", async (req, res) => {
  const body = parse(rubricUpdate, req.body);
  const onlyOffsets = Object.keys(body).every((k) => k === "aiOffsets");
  await requireStaff(req, await courseOfRubric(req.params.id), onlyOffsets ? undefined : "canEditSettings");
  const { criteria, aiOffsets, ...data } = body;
  const row = await prisma.rubric.update({
    where: { id: req.params.id },
    data: { ...data, ...(criteria && { criteria: criteria as Prisma.InputJsonValue }), aiOffsets: json(aiOffsets) },
  });
  res.json(toRubric(row));
});

assignmentsRouter.delete("/rubrics/:id", async (req, res) => {
  await requireStaff(req, await courseOfRubric(req.params.id), "canEditSettings");
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
  aiCriterionScores: z.record(z.string(), z.number()).nullish(),
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
  aiCriterionScores: z.record(z.string(), z.number()).nullable(),
  status: statusSchema,
  fileUrl: z.string().nullable(),
  attachments: z.array(attachmentSchema).nullable(),
}).partial();

function submissionData<T extends {
  attachments?: unknown; criterionComments?: unknown; criterionScores?: unknown; aiCriterionScores?: unknown;
  status?: z.infer<typeof statusSchema>; submittedAt?: string;
}>(data: T) {
  const { attachments, criterionComments, criterionScores, aiCriterionScores, status, submittedAt, ...rest } = data;
  return {
    ...rest,
    attachments: json(attachments),
    criterionComments: json(criterionComments),
    criterionScores: json(criterionScores),
    aiCriterionScores: json(aiCriterionScores),
    ...(status && { status: submissionStatus.toDb(status) }),
    ...(submittedAt && { submittedAt: new Date(submittedAt) }),
  };
}

// Who sees which submission:
// - staff of the course (and admins): everything;
// - a student: their own and their teammates' — with scores and feedback hidden until the results
//   are announced (gradingFinalized; the status stays, so a graded one stays locked) — and, once
//   announced, everyone else's graded score with nothing that says whose it is (for the class
//   min / average / max on the student's page).

type SubmissionWithAssignment = Submission & { assignment: { courseId: string; gradingFinalized: boolean } };
type Team = { id: string; assignmentId: string; memberStudentIds: string[] };

/** The teams `me` is on (for `assignmentIds`, or every assignment). */
function teamsOf(me: string, assignmentIds?: string[]): Promise<Team[]> {
  return prisma.studentGroup.findMany({
    where: { memberStudentIds: { has: me }, ...(assignmentIds && { assignmentId: { in: assignmentIds } }) },
    select: { id: true, assignmentId: true, memberStudentIds: true },
  });
}

function isTeammates(me: string, sub: { assignmentId: string; studentId: string; groupId: string | null }, teams: Team[]) {
  if (sub.studentId === me) return true;
  return teams.some(
    (g) => g.assignmentId === sub.assignmentId && (g.id === sub.groupId || g.memberStudentIds.includes(sub.studentId)),
  );
}

function forStudent(me: string, teams: Team[], s: SubmissionWithAssignment) {
  const { assignment, ...sub } = s;
  const announced = assignment.gradingFinalized;
  if (isTeammates(me, sub, teams)) {
    if (sub.status !== "graded" || announced) return toSubmission(sub);
    return toSubmission({
      ...sub, aiScore: null, instructorScore: null, instructorComment: "",
      criterionComments: null, criterionScores: null, aiCriterionScores: null,
    });
  }
  if (!announced || sub.status !== "graded") return null;
  return toSubmission({
    ...sub, studentId: "", studentName: "", email: "", fileUrl: null, attachments: null, instructorComment: "",
    criterionComments: null, criterionScores: null, aiCriterionScores: null, externalUseConsent: false, groupId: null,
  });
}

async function listSubmissions(p: Principal, where: { assignmentId?: string }) {
  const v = await visibleCourses(p);
  const courseId = courseFilter(v);
  const rows = await prisma.submission.findMany({
    where: { ...(where.assignmentId && { assignmentId: where.assignmentId }), ...(courseId && { assignment: { courseId } }) },
    include: { assignment: { select: { courseId: true, gradingFinalized: true } } },
    orderBy: { submittedAt: "asc" },
  });
  if (v === "all") return rows.map(({ assignment: _a, ...s }) => toSubmission(s));
  const me = p.student?.studentId ?? "";
  const teams = me ? await teamsOf(me) : [];
  return rows
    .map((r) => {
      if (v.staff.has(r.assignment.courseId)) {
        const { assignment: _a, ...s } = r;
        return toSubmission(s);
      }
      return forStudent(me, teams, r);
    })
    .filter((s) => s !== null);
}

assignmentsRouter.get("/submissions", async (req, res) => {
  res.json(await listSubmissions(principalOf(req), {}));
});

assignmentsRouter.get("/assignments/:id/submissions", async (req, res) => {
  await requireMember(req, await courseOfAssignment(req.params.id));
  res.json(await listSubmissions(principalOf(req), { assignmentId: req.params.id }));
});

/** A student hands in for themself — or, on a group assignment, for a teammate. Returns their team. */
async function assertMayHandIn(me: string, assignmentId: string, target: string) {
  const assignment = await prisma.assignment.findUniqueOrThrow({ where: { id: assignmentId }, select: { isExam: true, submissionType: true } });
  if (assignment.isExam) throw new HttpError(403, "An exam isn't handed in");
  if (assignment.submissionType !== "group") {
    if (target !== me) throw new HttpError(403, "You can only hand in your own work");
    return null;
  }
  const team = (await teamsOf(me, [assignmentId]))[0];
  if (!team) throw new HttpError(400, "Form a team first");
  if (!team.memberStudentIds.includes(target)) throw new HttpError(403, "That student isn't on your team");
  return team;
}

// One submission per student per assignment (409 on a second one — resubmitting is a PATCH).
// Staff may write any field (exam scores, CSV imports). A student only hands work in: whose it is,
// when, and the scores are set here, never taken from the request.
assignmentsRouter.post("/assignments/:id/submissions", async (req, res) => {
  const courseId = await courseOfAssignment(req.params.id);
  const access = await requireMember(req, courseId);
  const { assignmentId: _ignored, ...data } = parse(submissionCreate, req.body);
  if (access.staff) {
    const row = await prisma.submission.create({
      data: { ...submissionData(data), submittedAt: new Date(data.submittedAt), assignmentId: req.params.id },
    });
    res.status(201).json(toSubmission(row));
    return;
  }
  const me = principalOf(req).student!.studentId;
  const team = await assertMayHandIn(me, req.params.id, data.studentId);
  const enrolled = await prisma.enrollment.findUnique({
    where: { courseId_studentId: { courseId, studentId: data.studentId } },
    select: { firstName: true, lastName: true, email: true, enrollmentStatus: true },
  });
  if (!enrolled || enrolled.enrollmentStatus === "withdrawn") throw new HttpError(403, "That student isn't enrolled in this course");
  const row = await prisma.submission.create({
    data: {
      ...(data.id && { id: data.id }),
      assignmentId: req.params.id,
      studentId: data.studentId,
      studentName: `${enrolled.firstName} ${enrolled.lastName}`,
      email: enrolled.email,
      submittedAt: new Date(),
      fileUrl: data.fileUrl,
      attachments: json(data.attachments),
      externalUseConsent: data.studentId === me && data.externalUseConsent, // only for your own work
      status: "notGraded",
      groupId: team?.id ?? null,
    },
  });
  res.status(201).json(toSubmission(row));
});

// What a student may change when resubmitting.
const STUDENT_RESUBMIT = new Set(["fileUrl", "attachments", "status"]);

assignmentsRouter.patch("/submissions/:id", async (req, res) => {
  const data = parse(submissionUpdate, req.body);
  const current = await prisma.submission.findUniqueOrThrow({
    where: { id: req.params.id },
    select: { assignmentId: true, studentId: true, status: true, assignment: { select: { courseId: true } } },
  });
  const access = await requireMember(req, current.assignment.courseId);
  if (!access.staff) {
    const me = principalOf(req).student!.studentId;
    await assertMayHandIn(me, current.assignmentId, current.studentId);
    const other = Object.keys(data).filter((k) => !STUDENT_RESUBMIT.has(k));
    if (other.length > 0) throw new HttpError(403, `Only staff can change: ${other.join(", ")}`);
    if (data.status !== undefined && data.status !== "not_graded") throw new HttpError(403, "Only staff can grade");
    if (current.status === "graded") throw new HttpError(409, "This submission has already been graded");
  }
  const row = await prisma.submission.update({ where: { id: req.params.id }, data: submissionData(data) });
  res.json(toSubmission(row));
});
