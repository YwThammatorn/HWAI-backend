// Seeds the database with the same mock data the frontend ships in public/mock-data/
// (copied into prisma/seed-data/). Safe to re-run: every row is upserted by id.
import "dotenv/config";
import { readFileSync } from "node:fs";
import { prisma } from "../src/lib/prisma.js";
import { termFromApi, type ApiTerm } from "../src/lib/serialize.js";
import { enrollmentStatus, submissionStatus } from "../src/lib/content.js";
import type { Prisma } from "../src/generated/prisma/client.js";

function load<T>(file: string): T {
  return JSON.parse(readFileSync(new URL(`./seed-data/${file}`, import.meta.url), "utf8")) as T;
}

type Curriculum = {
  curriculumVersions: Prisma.CurriculumVersionCreateManyInput[];
  courseTemplates: Prisma.CourseTemplateCreateManyInput[];
};
type SeedCourse = Omit<Prisma.CourseCreateManyInput, "term"> & { term?: ApiTerm };
type SeedTeacher = Prisma.TeacherCreateManyInput & { courseIds: string[] };

async function main() {
  const curriculum = load<Curriculum>("curriculum-mockup.json");
  // [21] adds earlier years' sections of a subject (for Rubrics > compare years), taught by years.teacherId.
  const years = load<{ teacherId: string; courses: (SeedCourse & { id: string })[] }>("rubric-years-mockup.json");
  const courses = [...load<SeedCourse[]>("courses-mockup.json"), ...years.courses];
  const teachers = load<SeedTeacher[]>("teachers-mockup.json");
  const students = load<Prisma.StudentCreateManyInput[]>("students-mockup.json");

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
  for (const { courseIds, ...t } of teachers) {
    const courses = { deleteMany: {}, create: courseIds.map((courseId) => ({ courseId })) };
    await prisma.teacher.upsert({
      where: { id: t.id },
      create: { ...t, courses: { create: courses.create } },
      update: { ...t, courses },
    });
  }
  // Mock courses the mock data no longer has (seed-commands [2]/[18] replace the whole list). Only the mock's own
  // "c-mock-…" ids — courses people created themselves (uuid ids) are never touched.
  const mockIds = courses.map((c) => c.id as string);
  const stale = await prisma.course.deleteMany({ where: { id: { startsWith: "c-mock-", notIn: mockIds } } });
  if (stale.count) console.log(`Removed ${stale.count} mock course(s) no longer in the mock data.`);
  for (const c of years.courses) {
    await prisma.courseTeacher.upsert({
      where: { courseId_teacherId: { courseId: c.id, teacherId: years.teacherId } },
      create: { courseId: c.id, teacherId: years.teacherId },
      update: {},
    });
  }
  for (const s of students) {
    // Keyed on the student ID (unique), so one added through the admin page under another id is updated, not duplicated.
    const { id: _id, ...changes } = s;
    void _id;
    await prisma.student.upsert({ where: { studentId: s.studentId }, create: s, update: changes });
  }

  const content = await seedCourseContent();

  console.log(
    `Seeded ${curriculum.curriculumVersions.length} curriculum versions, ${curriculum.courseTemplates.length} course templates, ` +
      `${courses.length} courses, ${teachers.length} teachers, ${students.length} students; ${content}.`,
  );
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

  for (const e of roster) {
    const { id, courseId, studentId, enrollmentStatus: s, ...rest } = e as Row & { courseId: string; studentId: string; enrollmentStatus?: string };
    const data = {
      ...(rest as Omit<Prisma.EnrollmentCreateManyInput, "id" | "courseId" | "studentId">),
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
    const { attachments, dueDate, createdAt, updatedAt, ...rest } = a;
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
    const { status, attachments, criterionComments, criterionScores, ...rest } = s;
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
  // [15] / [16] replace a course's whole roster (c-mock-1, c-mock-4), and [15] / [16] / [21] every submission of their
  // assignments — drop what earlier seeds (or older mock data) left behind there.
  const ownedCourses = new Set([...flow.courseStudents, ...(uxui.courseStudents ?? [])].map((x) => x.courseId as string));
  for (const courseId of ownedCourses) {
    const keep = roster.filter((x) => x.courseId === courseId).map((x) => x.studentId as string);
    await prisma.enrollment.deleteMany({ where: { courseId, studentId: { notIn: keep } } });
  }
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
