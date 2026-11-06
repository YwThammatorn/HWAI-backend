// Converts DB rows into the exact JSON shapes the frontend types expect
// (HWAI-frontend/src/lib/*.ts): optional fields are omitted rather than null,
// dates are ISO strings, and Term is mapped back to 1 | 2 | 3 | "summer".
// Function names follow the API/frontend shapes (ManagedTeacher, CohortStudent), not the table names.
import type {
  Course,
  CourseTemplate,
  CurriculumVersion,
  Student,
  Teacher,
  Term,
  User,
} from "../generated/prisma/client.js";

export type ApiTerm = 1 | 2 | 3 | "summer";

const TERM_TO_API: Record<Term, ApiTerm> = { T1: 1, T2: 2, T3: 3, SUMMER: "summer" };

export function termFromApi(term: ApiTerm): Term {
  return term === 1 ? "T1" : term === 2 ? "T2" : term === 3 ? "T3" : "SUMMER";
}

/** Drop keys whose value is null so optional fields come out as `undefined` on the client. */
function compact<T extends Record<string, unknown>>(obj: T) {
  return Object.fromEntries(Object.entries(obj).filter(([, v]) => v !== null)) as {
    [K in keyof T]: Exclude<T[K], null>;
  };
}

export function toCurriculumVersion(v: CurriculumVersion) {
  return compact({
    id: v.id,
    program: v.program,
    label: v.label,
    effectiveFrom: v.effectiveFrom,
    effectiveTo: v.effectiveTo,
  });
}

export function toCourseTemplate(t: CourseTemplate) {
  return compact({
    id: t.id,
    curriculumVersionId: t.curriculumVersionId,
    code: t.code,
    name: t.name,
    description: t.description,
  });
}

export function toCourse(c: Course) {
  return compact({
    id: c.id,
    name: c.name,
    description: c.description,
    status: c.status,
    coverColor: c.coverColor,
    icon: c.icon,
    createdAt: c.createdAt.toISOString(),
    updatedAt: c.updatedAt.toISOString(),
    code: c.code,
    courseTemplateId: c.courseTemplateId,
    academicYear: c.academicYear,
    term: c.term ? TERM_TO_API[c.term] : null,
    sectionNumber: c.sectionNumber,
    schedule: c.schedule,
    room: c.room,
  });
}

/** `include` for a teacher query: their user row with the courses they teach (role "teacher", oldest first). */
export const teacherInclude = {
  user: {
    include: {
      sectionRoles: { where: { role: "teacher" }, select: { courseId: true }, orderBy: { createdAt: "asc" } },
    },
  },
} as const;

// A teacher / student as the API shows them: their user row's common fields + their subtype's. id = users.id.
export function toManagedTeacher(t: Teacher & { user: User & { sectionRoles: { courseId: string }[] } }) {
  return compact({
    id: t.userId,
    title: t.user.title,
    name: t.user.name,
    email: t.user.email,
    status: t.user.status,
    courseIds: t.user.sectionRoles.map((r) => r.courseId),
  });
}

export function toCohortStudent(s: Student & { user: User }) {
  return compact({
    id: s.userId,
    studentId: s.studentId,
    title: s.user.title,
    name: s.user.name,
    email: s.user.email,
    program: s.program,
    status: s.user.status,
  });
}
