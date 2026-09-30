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
  const courses = load<SeedCourse[]>("courses-mockup.json");
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
  for (const s of students) {
    await prisma.student.upsert({ where: { id: s.id }, create: s, update: s });
  }

  const content = await seedCourseContent();

  console.log(
    `Seeded ${curriculum.curriculumVersions.length} curriculum versions, ${curriculum.courseTemplates.length} course templates, ` +
      `${courses.length} courses, ${teachers.length} teachers, ${students.length} students; ${content}.`,
  );
}

// Course content = seed-commands [5] (student-flow) + [14] (student-history), merged the way those
// commands merge them in localStorage.
async function seedCourseContent() {
  type Row = Record<string, unknown> & { id: string };
  type Learning = Record<"courseStudents" | "gradingCategories" | "assignments" | "rubrics" | "submissions", Row[]>;
  const flow = load<Learning>("student-flow-mockup.json");
  const history = load<Learning>("student-history-mockup.json");

  const byId = (a: Row[] = [], b: Row[] = []) => { const ids = new Set(a.map((x) => x.id)); return [...a, ...b.filter((x) => !ids.has(x.id))]; };
  // [14] replaces a roster entry for the same student + course rather than keeping both.
  const pair = (x: Row) => `${x.studentId}|${x.courseId}`;
  const historyPairs = new Set((history.courseStudents ?? []).map(pair));
  const roster = [...flow.courseStudents.filter((x) => !historyPairs.has(pair(x))), ...(history.courseStudents ?? [])];
  const categories = byId(flow.gradingCategories, history.gradingCategories);
  const assignments = byId(flow.assignments, history.assignments);
  const rubrics = byId(flow.rubrics, history.rubrics);
  const submissions = byId(flow.submissions, history.submissions);

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
    await prisma.submission.upsert({ where: { id: s.id }, create: data, update: data });
  }
  return (
    `${roster.length} roster entries, ${categories.length} grading categories, ${assignments.length} assignments, ` +
    `${rubrics.length} rubrics, ${submissions.length} submissions`
  );
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
