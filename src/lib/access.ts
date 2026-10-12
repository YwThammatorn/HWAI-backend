// What a signed-in caller may do, per course.
//
// - Admin: everything.
// - Staff of a course: its primary teacher (course_teachers, admin-assigned) or anyone holding a
//   section role in it. Permissions follow HWAI-frontend/src/lib/section-roles.ts: a teacher-role
//   primary teacher and a co-teacher get everything, a TA (section role, or a TA-role account assigned
//   as primary) gets only what its permissions say. Any staff may grade.
// - Member of a course: staff, or a student enrolled in it (not withdrawn).
import type { Request } from "express";
import { prisma } from "./prisma.js";
import { HttpError } from "./http.js";
import { principalOf, type Principal } from "./auth.js";

export interface Permissions {
  canManageRoster: boolean;
  canEditSettings: boolean;
  canPublishScores: boolean;
}
export type Permission = keyof Permissions;

const FULL: Permissions = { canManageRoster: true, canEditSettings: true, canPublishScores: true };
const TA: Permissions = { canManageRoster: false, canEditSettings: false, canPublishScores: false };

const merge = (a: Permissions | null, b: Permissions): Permissions =>
  a
    ? {
        canManageRoster: a.canManageRoster || b.canManageRoster,
        canEditSettings: a.canEditSettings || b.canEditSettings,
        canPublishScores: a.canPublishScores || b.canPublishScores,
      }
    : b;

export function permissionsOf(role: "teacher" | "ta" | "coTeacher", stored: unknown): Permissions {
  if (stored && typeof stored === "object") return { ...TA, ...(stored as Partial<Permissions>) };
  return role === "ta" ? TA : FULL;
}

export interface CourseAccess {
  /** Null when the caller is not staff of the course. */
  staff: Permissions | null;
  /** Enrolled as a student (not withdrawn). */
  student: boolean;
}

/** Staff permissions per course, for every course the caller is staff of. */
async function staffCourses(p: Principal, courseId?: string): Promise<Map<string, Permissions>> {
  const out = new Map<string, Permissions>();
  if (p.teacher) {
    const links = await prisma.courseTeacher.findMany({
      where: { teacherId: p.teacher.id, ...(courseId && { courseId }) },
      select: { courseId: true },
    });
    for (const l of links) out.set(l.courseId, merge(out.get(l.courseId) ?? null, p.teacher.role === "teacher" ? FULL : TA));
  }
  const accountIds = [p.teacher && { teacherId: p.teacher.id }, p.student && { studentId: p.student.id }].filter(
    (x): x is { teacherId: string } | { studentId: string } => !!x,
  );
  if (accountIds.length > 0) {
    const roles = await prisma.sectionRole.findMany({
      where: { OR: accountIds, ...(courseId && { courseId }) },
      select: { courseId: true, role: true, permissions: true },
    });
    for (const r of roles) out.set(r.courseId, merge(out.get(r.courseId) ?? null, permissionsOf(r.role, r.permissions)));
  }
  return out;
}

/** Courses the caller is enrolled in as a student (not withdrawn). */
async function studentCourses(p: Principal, courseId?: string): Promise<Set<string>> {
  if (!p.student) return new Set();
  const rows = await prisma.enrollment.findMany({
    where: {
      studentId: p.student.studentId,
      ...(courseId && { courseId }),
      // A missing status counts as enrolled.
      OR: [{ enrollmentStatus: null }, { enrollmentStatus: { not: "withdrawn" } }],
    },
    select: { courseId: true },
  });
  return new Set(rows.map((r) => r.courseId));
}

export async function courseAccess(p: Principal, courseId: string): Promise<CourseAccess> {
  if (p.admin) return { staff: FULL, student: false };
  const [staff, enrolled] = await Promise.all([staffCourses(p, courseId), studentCourses(p, courseId)]);
  return { staff: staff.get(courseId) ?? null, student: enrolled.has(courseId) };
}

/**
 * Every course the caller can see, for filtering list endpoints — "all" for an admin.
 * `staff` maps course → permissions; `student` holds courses the caller is only a student in.
 */
export async function visibleCourses(p: Principal): Promise<"all" | { staff: Map<string, Permissions>; student: Set<string> }> {
  if (p.admin) return "all";
  const [staff, enrolled] = await Promise.all([staffCourses(p), studentCourses(p)]);
  for (const id of staff.keys()) enrolled.delete(id); // staff view wins
  return { staff, student: enrolled };
}

/** A Prisma `where` on courseId limiting a list to the caller's courses (undefined = no limit). */
export function courseFilter(v: Awaited<ReturnType<typeof visibleCourses>>) {
  if (v === "all") return undefined;
  return { in: [...v.staff.keys(), ...v.student] };
}

/** Is the caller a staff member anywhere (or admin) — e.g. may use the rubric library. */
export async function isStaffAnywhere(p: Principal) {
  if (p.admin || p.teacher) return true;
  return (await staffCourses(p)).size > 0;
}

const forbidden = (msg = "You don't have access to this") => new HttpError(403, msg);

export function requireAdmin(req: Request): Principal {
  const p = principalOf(req);
  if (!p.admin) throw forbidden("Admins only");
  return p;
}

/** The caller must be staff of the course (with `permission`, when given). Returns their permissions. */
export async function requireStaff(req: Request, courseId: string, permission?: Permission): Promise<Permissions> {
  const access = await courseAccess(principalOf(req), courseId);
  if (!access.staff) throw forbidden("Only this course's staff can do that");
  if (permission && !access.staff[permission]) throw forbidden(`You need the ${permission} permission in this course`);
  return access.staff;
}

/** The caller must be staff of, or enrolled in, the course. */
export async function requireMember(req: Request, courseId: string): Promise<CourseAccess> {
  const access = await courseAccess(principalOf(req), courseId);
  if (!access.staff && !access.student) throw forbidden("You're not in this course");
  return access;
}

// ── Finding the course a row belongs to ──────────────────────────────────────

const notFound = (what: string) => new HttpError(404, `${what} not found`);

export async function courseOfAssignment(id: string) {
  const a = await prisma.assignment.findUnique({ where: { id }, select: { courseId: true } });
  if (!a) throw notFound("Assignment");
  return a.courseId;
}
export async function courseOfRubric(id: string) {
  const r = await prisma.rubric.findUnique({ where: { id }, select: { assignment: { select: { courseId: true } } } });
  if (!r) throw notFound("Rubric");
  return r.assignment.courseId;
}
