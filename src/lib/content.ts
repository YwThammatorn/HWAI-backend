// Validation + serialization for course content (rosters, grading categories, assignments, rubrics,
// submissions, student groups). Shapes mirror HWAI-frontend/src/lib/{students,gradingCategories,assignments,studentGroups}.ts.
import { z } from "zod";
import type {
  Assignment,
  Enrollment,
  GradingCategory,
  Rubric,
  StudentGroup,
  Submission,
} from "../generated/prisma/client.js";

// ── Enum mapping (API values that aren't valid identifiers) ──────────────────

const bimap = <A extends string, D extends string>(pairs: Record<A, D>) => {
  const toDb = pairs;
  const toApi = Object.fromEntries(Object.entries(pairs).map(([a, d]) => [d, a])) as Record<D, A>;
  return { toDb: (a: A) => toDb[a], toApi: (d: D) => toApi[d] };
};

export const enrollmentStatus = bimap({ enrolled: "enrolled", withdrawn: "withdrawn", "added-midterm": "addedMidterm" } as const);
export const submissionStatus = bimap({ not_graded: "notGraded", need_review: "needReview", graded: "graded" } as const);

// ── Shared JSON shapes ───────────────────────────────────────────────────────
// Loose objects: fields the frontend adds later are kept, not silently dropped from the stored JSON.

export const attachmentSchema = z.looseObject({
  id: z.string().min(1),
  kind: z.enum(["file", "image", "link"]),
  name: z.string(),
  source: z.enum(["upload", "url"]),
  ref: z.string().min(1),
});

export const criterionSchema = z.looseObject({
  id: z.string().min(1),
  name: z.string(),
  description: z.string(),
  maxPoints: z.number().min(0),
  weight: z.number().min(0),
  levels: z.array(z.looseObject({ label: z.string(), description: z.string() })),
});

export const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "expected YYYY-MM-DD");
export const idOverride = { id: z.string().min(1).optional() };

// ── Serializers ──────────────────────────────────────────────────────────────

/** Drop keys whose value is null/undefined so OPTIONAL fields come out as `undefined` on the client. */
function compact<T extends Record<string, unknown>>(obj: T) {
  return Object.fromEntries(Object.entries(obj).filter(([, v]) => v !== null && v !== undefined)) as {
    [K in keyof T]: Exclude<T[K], null>;
  };
}

const iso = (d: Date) => d.toISOString();
const ymd = (d: Date) => d.toISOString().slice(0, 10);

export function toEnrollment(e: Enrollment) {
  return compact({
    id: e.id,
    courseId: e.courseId,
    studentId: e.studentId,
    firstName: e.firstName,
    lastName: e.lastName,
    email: e.email,
    sequenceNumber: e.sequenceNumber,
    enrollmentStatus: e.enrollmentStatus ? enrollmentStatus.toApi(e.enrollmentStatus) : null,
  });
}

export function toGradingCategory(c: GradingCategory) {
  return {
    id: c.id,
    courseId: c.courseId,
    name: c.name,
    weight: c.weight,
    createdAt: iso(c.createdAt),
    updatedAt: iso(c.updatedAt),
  };
}

export function toAssignment(a: Assignment) {
  return {
    ...compact({
      id: a.id,
      courseId: a.courseId,
      name: a.name,
      description: a.description,
      attachments: a.attachments,
      dueDate: a.dueDate ? ymd(a.dueDate) : null,
      maxPoints: a.maxPoints,
      categoryId: a.categoryId,
      acceptsFiles: a.acceptsFiles,
      fileTypes: a.fileTypes,
      submissionType: a.submissionType,
      rubricIds: a.rubricIds,
      gradingFinalized: a.gradingFinalized,
      isExam: a.isExam,
      createdAt: iso(a.createdAt),
      updatedAt: iso(a.updatedAt),
    }),
    maxGroupSize: a.maxGroupSize, // number | null on the frontend — null is meaningful, keep it
  };
}

export function toRubric(r: Rubric) {
  return {
    id: r.id,
    assignmentId: r.assignmentId,
    name: r.name,
    criteria: r.criteria,
    createdAt: iso(r.createdAt),
    updatedAt: iso(r.updatedAt),
  };
}

export function toSubmission(s: Submission) {
  return {
    ...compact({
      id: s.id,
      assignmentId: s.assignmentId,
      studentId: s.studentId,
      studentName: s.studentName,
      email: s.email,
      submittedAt: iso(s.submittedAt),
      attachments: s.attachments,
      instructorComment: s.instructorComment,
      criterionComments: s.criterionComments,
      criterionScores: s.criterionScores,
      externalUseConsent: s.externalUseConsent,
      status: submissionStatus.toApi(s.status),
      groupId: s.groupId,
      updatedAt: iso(s.updatedAt),
    }),
    // `number | null` / `string | null` on the frontend, which checks `!== null` — keep the nulls.
    fileUrl: s.fileUrl,
    aiScore: s.aiScore,
    instructorScore: s.instructorScore,
  };
}

export function toStudentGroup(g: StudentGroup) {
  return {
    id: g.id,
    assignmentId: g.assignmentId,
    courseId: g.courseId,
    name: g.name,
    memberStudentIds: g.memberStudentIds,
    createdAt: iso(g.createdAt),
    updatedAt: iso(g.updatedAt),
  };
}
