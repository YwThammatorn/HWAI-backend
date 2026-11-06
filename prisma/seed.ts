// Seeds the database with the same mock data the frontend ships in public/mock-data/
// (copied into prisma/seed-data/). Safe to re-run: every row is upserted by id.
import "dotenv/config";
import { readFileSync } from "node:fs";
import { prisma } from "../src/lib/prisma.js";
import { termFromApi, type ApiTerm } from "../src/lib/serialize.js";
import { enrollmentStatus, submissionStatus } from "../src/lib/content.js";
import { Prisma } from "../src/generated/prisma/client.js";

function load<T>(file: string): T {
  return JSON.parse(readFileSync(new URL(`./seed-data/${file}`, import.meta.url), "utf8")) as T;
}

type Curriculum = {
  curriculumVersions: Prisma.CurriculumVersionCreateManyInput[];
  courseTemplates: Prisma.CourseTemplateCreateManyInput[];
};
type SeedCourse = Omit<Prisma.CourseCreateManyInput, "term"> & { term?: ApiTerm };
type SeedAccount = { id: string; email: string; title?: string | null; name: string; status?: "active" | "inactive" };
type SeedTeacher = SeedAccount & { role?: string; courseIds: string[] }; // role: older mocks — ignored, a teacher is a teacher
type SeedStudent = SeedAccount & { studentId: string; program: "CE" | "CECS" | "CEI" };

async function main() {
  const curriculum = load<Curriculum>("curriculum-mockup.json");
  // [21] adds earlier years' sections of a subject (for Rubrics > compare years), taught by years.teacherId.
  const years = load<{
    teacherId: string;
    courses: (SeedCourse & { id: string })[];
    assignments: { id: string; courseId: string }[];
    submissions: { assignmentId: string; studentId: string; studentName: string; email: string }[];
  }>("rubric-years-mockup.json");
  const courses = [...load<SeedCourse[]>("courses-mockup.json"), ...years.courses];
  const teachers = load<SeedTeacher[]>("teachers-mockup.json");
  const students = load<SeedStudent[]>("students-mockup.json");

  for (const v of curriculum.curriculumVersions) {
    await prisma.curriculumVersion.upsert({ where: { id: v.id }, create: v, update: v });
  }
  for (const t of curriculum.courseTemplates) {
    await prisma.courseTemplate.upsert({ where: { id: t.id }, create: t, update: t });
  }
  for (const { term, ...c } of courses) {
    const data = { ...c, term: term === undefined ? undefined : termFromApi(term) };
    await prisma.course.upsert({ where: { id: c.id }, create: data, update: data });
  }
  for (const { courseIds, role: _ignored, ...account } of teachers) {
    const userId = await seedUser(account);
    await prisma.teacher.upsert({ where: { userId }, create: { userId }, update: {} });
    // The sections they teach (role "teacher") are exactly the mock's courseIds
    await prisma.sectionRole.deleteMany({ where: { userId, role: "teacher", courseId: { notIn: courseIds } } });
    for (const courseId of courseIds) await seedTeaches(userId, courseId);
  }
  // Mock courses the mock data no longer has (seed-commands [2]/[18] replace the whole list). Only the mock's own
  // "c-mock-…" ids — courses people created themselves (uuid ids) are never touched.
  const mockIds = courses.map((c) => c.id as string);
  const stale = await prisma.course.deleteMany({ where: { id: { startsWith: "c-mock-", notIn: mockIds } } });
  if (stale.count) console.log(`Removed ${stale.count} mock course(s) no longer in the mock data.`);
  for (const c of years.courses) await seedTeaches(years.teacherId, c.id);
  for (const { studentId, program, ...account } of students) {
    // Keyed on the student ID (unique), so one added through the admin page under another id is updated, not duplicated.
    const existing = await prisma.student.findUnique({ where: { studentId }, select: { userId: true } });
    const userId = await seedUser({ ...account, id: existing?.userId ?? account.id });
    const data = { studentId, program };
    await prisma.student.upsert({ where: { userId }, create: { userId, ...data }, update: data });
  }
  await seedPastStudents(curriculum, years, new Set(students.map((s) => s.studentId)));

  await seedDemoAccounts();
  const content = await seedCourseContent();

  console.log(
    `Seeded ${curriculum.curriculumVersions.length} curriculum versions, ${curriculum.courseTemplates.length} course templates, ` +
      `${courses.length} courses, ${teachers.length} teachers, ${students.length} students; ${content}.`,
  );
}

// [21]'s earlier offerings were taken by synthetic students (6499xxxx / 6599xxxx: classes 64 and 65 —
// 66 to 69 are still studying) the cohort mock doesn't have.
// Every submission belongs to a student (FK), so they become inactive accounts — a cohort that has graduated —
// named as on their submissions, in the program of their section's curriculum (CE when it has none). An account
// that already exists is left as it is.
async function seedPastStudents(
  curriculum: Curriculum,
  years: { courses: { id: string; courseTemplateId?: string | null }[]; assignments: { id: string; courseId: string }[]; submissions: { assignmentId: string; studentId: string; studentName: string; email: string }[] },
  known: Set<string>,
) {
  const courseOf = new Map(years.assignments.map((a) => [a.id, a.courseId]));
  const templateOf = new Map(years.courses.map((c) => [c.id, c.courseTemplateId ?? null]));
  const programOf = (courseId: string | undefined) => {
    const template = curriculum.courseTemplates.find((t) => t.id === templateOf.get(courseId ?? ""));
    const version = curriculum.curriculumVersions.find((v) => v.id === template?.curriculumVersionId);
    return version?.program ?? "CE";
  };
  const seen = new Set<string>();
  for (const s of years.submissions) {
    if (known.has(s.studentId) || seen.has(s.studentId)) continue;
    seen.add(s.studentId);
    if (await prisma.student.findUnique({ where: { studentId: s.studentId }, select: { userId: true } })) continue;
    const email = s.email.toLowerCase();
    const user = await prisma.user.upsert({
      where: { email },
      create: { email, name: s.studentName.trim(), status: "inactive" },
      update: {},
      select: { id: true },
    });
    await prisma.student.create({ data: { userId: user.id, studentId: s.studentId, program: programOf(courseOf.get(s.assignmentId)) } });
  }
  if (seen.size) console.log(`Past students for [21]: ${seen.size} inactive accounts.`);
}

// The demo admin: ผศ.ดร. สมศักดิ์ (teacher t-mock-1) is also an admin — but only while demo sign-in is on;
// real (Google) sign-in never makes him one. A teacher is never also a student.
async function seedDemoAccounts() {
  const user = await prisma.user.findUniqueOrThrow({ where: { email: "somsak.c@kmitl.ac.th" }, select: { id: true } });
  await prisma.admin.upsert({ where: { userId: user.id }, create: { userId: user.id, demo: true }, update: { demo: true } });
}

/** Makes the user the teacher of a course (over a co-teacher role they may have had there). */
async function seedTeaches(userId: string, courseId: string) {
  await prisma.sectionRole.upsert({
    where: { courseId_userId: { courseId, userId } },
    create: { courseId, userId, role: "teacher" },
    update: { role: "teacher", permissions: Prisma.DbNull },
  });
}

/**
 * The user a mock account is: the one with its id, else the one with its email (someone added it through the
 * admin pages), else a new one with the mock's id. Name, title, email and status are refreshed from the mock.
 */
async function seedUser(a: SeedAccount): Promise<string> {
  const existing =
    (await prisma.user.findUnique({ where: { id: a.id }, select: { id: true } })) ??
    (await prisma.user.findUnique({ where: { email: a.email }, select: { id: true } }));
  const data = { email: a.email, title: a.title ?? null, name: a.name, ...(a.status && { status: a.status }) };
  if (existing) {
    await prisma.user.update({ where: { id: existing.id }, data });
    return existing.id;
  }
  return (await prisma.user.create({ data: { id: a.id, ...data }, select: { id: true } })).id;
}

// Course content = seed-commands [5]/[15] (student-flow) + [14] (student-history) + [16] (the UX/UI class) +
// [21] (cross-year rubric data), merged the way those commands merge them in localStorage.
async function seedCourseContent() {
  type Row = Record<string, unknown> & { id: string };
  type Learning = Record<"courseStudents" | "gradingCategories" | "assignments" | "rubrics" | "submissions" | "clos", Row[]>;
  const flow = load<Learning>("student-flow-mockup.json");
  const history = load<Learning>("student-history-mockup.json");
  const uxui = load<Learning>("student-uxui-mockup.json");
  const years = load<Learning>("rubric-years-mockup.json");

  const byId = (a: Row[] = [], b: Row[] = []) => { const ids = new Set(a.map((x) => x.id)); return [...a, ...b.filter((x) => !ids.has(x.id))]; };
  // [14] replaces a roster entry for the same student + course rather than keeping both.
  const pair = (x: Row) => `${x.studentId}|${x.courseId}`;
  const historyPairs = new Set((history.courseStudents ?? []).map(pair));
  // [16] replaces the whole c-mock-4 roster with the UX/UI class.
  const uxuiCourses = new Set((uxui.courseStudents ?? []).map((x) => x.courseId as string));
  const roster = [
    ...flow.courseStudents.filter((x) => !historyPairs.has(pair(x))),
    ...(history.courseStudents ?? []).filter((x) => !uxuiCourses.has(x.courseId as string)),
    ...(uxui.courseStudents ?? []),
  ];
  const later = (key: keyof Learning) => [...(uxui[key] ?? []), ...(years[key] ?? [])];
  const categories = byId(later("gradingCategories"), byId(flow.gradingCategories, history.gradingCategories));
  const assignments = byId(later("assignments"), byId(flow.assignments, history.assignments));
  const rubrics = byId(later("rubrics"), byId(flow.rubrics, history.rubrics));
  const submissions = byId(later("submissions"), byId(flow.submissions, history.submissions));
  const clos = byId(flow.clos, history.clos);

  const json = (v: unknown) => (v === undefined || v === null ? undefined : (v as Prisma.InputJsonValue));
  const date = (v: unknown) => (typeof v === "string" ? new Date(v.length === 10 ? `${v}T00:00:00Z` : v) : undefined);

  // [15] / [16] replace a course's whole roster (c-mock-1, c-mock-4) — drop what earlier seeds (or older mock data)
  // left behind there first, so their numbers are free.
  const ownedCourses = new Set([...flow.courseStudents, ...(uxui.courseStudents ?? [])].map((x) => x.courseId as string));
  for (const courseId of ownedCourses) {
    const keep = roster.filter((x) => x.courseId === courseId).map((x) => x.studentId as string);
    await prisma.enrollment.deleteMany({ where: { courseId, studentId: { notIn: keep } } });
  }
  // A number is unique per course: clear the mock students' old numbers first, so moving one onto a number
  // another mock student is leaving never collides.
  for (const e of roster) {
    await prisma.enrollment.updateMany({
      where: { courseId: e.courseId as string, studentId: e.studentId as string },
      data: { sequenceNumber: null },
    });
  }
  for (const e of roster) {
    // Name and email in the mock are the student's own — a roster row only links course and student.
    const { id, courseId, studentId, sequenceNumber, enrollmentStatus: s } = e as Row & {
      courseId: string; studentId: string; sequenceNumber?: number; enrollmentStatus?: string;
    };
    const data = {
      sequenceNumber: sequenceNumber ?? null,
      enrollmentStatus: s === undefined ? undefined : enrollmentStatus.toDb(s as "enrolled" | "withdrawn" | "added-midterm"),
    };
    await prisma.enrollment.upsert({
      where: { courseId_studentId: { courseId, studentId } },
      create: { id, courseId, studentId, ...data },
      update: data,
    });
  }
  for (const c of categories) {
    const data = c as unknown as Prisma.GradingCategoryCreateManyInput;
    await prisma.gradingCategory.upsert({ where: { id: c.id }, create: data, update: data });
  }
  for (const a of assignments) {
    // rubricIds isn't stored: the API derives it from the rubrics
    const { attachments, dueDate, createdAt, updatedAt, rubricIds: _derived, ...rest } = a;
    const data = {
      ...(rest as unknown as Prisma.AssignmentCreateManyInput),
      attachments: json(attachments),
      dueDate: date(dueDate) ?? null,
      createdAt: date(createdAt),
      updatedAt: date(updatedAt),
    };
    await prisma.assignment.upsert({ where: { id: a.id }, create: data, update: data });
  }
  for (const r of rubrics) {
    const data = { ...(r as unknown as Prisma.RubricCreateManyInput), criteria: r.criteria as Prisma.InputJsonValue };
    await prisma.rubric.upsert({ where: { id: r.id }, create: data, update: data });
  }
  for (const s of submissions) {
    // studentName / email in the mock are the student's own — the API reads them from the account
    const { status, attachments, criterionComments, criterionScores, studentName: _n, email: _e, ...rest } = s;
    const data = {
      ...(rest as unknown as Prisma.SubmissionCreateManyInput),
      status: submissionStatus.toDb(status as "not_graded" | "need_review" | "graded"),
      attachments: json(attachments),
      criterionComments: json(criterionComments),
      criterionScores: json(criterionScores),
    };
    // Keyed on (assignment, student) — the real uniqueness — so a submission someone already made in the
    // database under another id gets updated instead of tripping the unique constraint.
    const { id, ...changes } = data;
    await prisma.submission.upsert({
      where: { assignmentId_studentId: { assignmentId: data.assignmentId, studentId: data.studentId } },
      create: data,
      update: changes,
    });
    void id;
  }
  // [15] / [16] / [21] replace every submission of their assignments — drop what earlier seeds left behind there.
  const ownedAssignments = new Set([...flow.assignments, ...(uxui.assignments ?? []), ...(years.assignments ?? [])].map((a) => a.id));
  for (const assignmentId of ownedAssignments) {
    const keep = submissions.filter((x) => x.assignmentId === assignmentId).map((x) => x.studentId as string);
    await prisma.submission.deleteMany({ where: { assignmentId, studentId: { notIn: keep } } });
  }
  for (const c of clos) {
    const data = c as unknown as Prisma.CloCreateManyInput;
    await prisma.clo.upsert({ where: { id: c.id }, create: data, update: data });
  }
  return (
    `${roster.length} roster entries, ${categories.length} grading categories, ${assignments.length} assignments, ` +
    `${rubrics.length} rubrics, ${submissions.length} submissions, ${clos.length} CLOs`
  );
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
