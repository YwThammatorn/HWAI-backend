// Seeds the database with the same mock data the frontend ships in public/mock-data/
// (copied into prisma/seed-data/). Safe to re-run: every row is upserted by id.
import "dotenv/config";
import { readFileSync } from "node:fs";
import { prisma } from "../src/lib/prisma.js";
import { termFromApi, type ApiTerm } from "../src/lib/serialize.js";
import type { Prisma } from "../src/generated/prisma/client.js";

function load<T>(file: string): T {
  return JSON.parse(readFileSync(new URL(`./seed-data/${file}`, import.meta.url), "utf8")) as T;
}

type Curriculum = {
  curriculumVersions: Prisma.CurriculumVersionCreateManyInput[];
  courseTemplates: Prisma.CourseTemplateCreateManyInput[];
};
type SeedCourse = Omit<Prisma.CourseCreateManyInput, "term"> & { term?: ApiTerm };
type SeedTeacher = Prisma.ManagedTeacherCreateManyInput & { courseIds: string[] };

async function main() {
  const curriculum = load<Curriculum>("curriculum-mockup.json");
  const courses = load<SeedCourse[]>("courses-mockup.json");
  const teachers = load<SeedTeacher[]>("teachers-mockup.json");
  const students = load<Prisma.CohortStudentCreateManyInput[]>("cohort-students-mockup.json");

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
    await prisma.managedTeacher.upsert({
      where: { id: t.id },
      create: { ...t, courses: { create: courses.create } },
      update: { ...t, courses },
    });
  }
  for (const s of students) {
    await prisma.cohortStudent.upsert({ where: { id: s.id }, create: s, update: s });
  }

  console.log(
    `Seeded ${curriculum.curriculumVersions.length} curriculum versions, ${curriculum.courseTemplates.length} course templates, ` +
      `${courses.length} courses, ${teachers.length} teachers, ${students.length} cohort students.`,
  );
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
