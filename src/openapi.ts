// OpenAPI 3.1 spec served at /docs (Swagger UI) and /openapi.json. Request bodies are generated from
// the same zod schemas the routes validate with, so the docs can't drift from the real validation.
import { z } from "zod";
import { courseCreate, courseUpdate } from "./routes/courses.js";
import { templateCreate, templateUpdate, versionCreate, versionUpdate } from "./routes/curriculum.js";
import { teacherCreate, teacherUpdate } from "./routes/managed-teachers.js";
import { studentCreate, studentUpdate } from "./routes/cohort-students.js";

const json = (schema: z.ZodType) => z.toJSONSchema(schema, { io: "input", unrepresentable: "any" });

// Response shapes (see src/lib/serialize.ts). Optional fields are omitted rather than null.
const opt = <T extends z.ZodType>(s: T) => s.optional();
const responses = {
  CurriculumVersion: z.object({
    id: z.string(),
    program: z.enum(["CECS", "CEI", "CE"]),
    label: z.string(),
    effectiveFrom: z.number().int(),
    effectiveTo: opt(z.number().int()),
  }),
  CourseTemplate: z.object({
    id: z.string(),
    curriculumVersionId: z.string(),
    code: z.string(),
    name: z.string(),
    description: opt(z.string()),
  }),
  Course: z.object({
    id: z.string(),
    name: z.string(),
    description: z.string(),
    status: z.enum(["active", "archived"]),
    coverColor: z.string(),
    icon: z.enum(["book", "chart", "flask", "code", "palette", "laptop", "graduation", "globe"]),
    createdAt: z.iso.datetime(),
    updatedAt: z.iso.datetime(),
    code: opt(z.string()),
    courseTemplateId: opt(z.string()),
    academicYear: opt(z.number().int()),
    term: opt(z.union([z.literal(1), z.literal(2), z.literal("summer")])),
    sectionNumber: opt(z.string()),
    gradingSource: opt(z.enum(["ta", "ai", "blind"])),
    publishMode: opt(z.enum(["auto", "manual"])),
    schedule: opt(z.string()),
    room: opt(z.string()),
  }),
  ManagedTeacher: z.object({
    id: z.string(),
    title: opt(z.string()),
    name: z.string(),
    email: z.string(),
    role: z.enum(["teacher", "ta"]),
    status: z.enum(["active", "inactive"]),
    courseIds: z.array(z.string()),
  }),
  CohortStudent: z.object({
    id: z.string(),
    studentId: z.string(),
    title: opt(z.string()),
    firstName: z.string(),
    lastName: z.string(),
    email: z.string(),
    cohort: z.string(),
    program: z.string(),
    status: z.enum(["active", "inactive"]),
    curriculumVersionId: opt(z.string()),
  }),
};

type Model = keyof typeof responses;
const ref = (m: Model) => ({ $ref: `#/components/schemas/${m}` });

const errorResponse = (description: string) => ({
  description,
  content: { "application/json": { schema: { type: "object", properties: { error: { type: "string" } } } } },
});
const ok = (schema: object, status = "200") => ({
  [status]: { description: "OK", content: { "application/json": { schema } } },
});
const noContent = { "204": { description: "No Content" } };
const body = (schema: object, example?: unknown) => ({
  required: true,
  content: { "application/json": { schema, ...(example !== undefined && { example }) } },
});

// Ready-to-send examples — Swagger's auto-generated ones use placeholder values the API rejects
// (term: 0, courseTemplateId: "string", ...). Ids refer to the seed data (npm run db:seed).
const examples = {
  versionCreate: { program: "CE", label: "วิศวกรรมคอมพิวเตอร์ (หลักสูตรทดลอง 2570)", effectiveFrom: 2570 },
  versionUpdate: { effectiveTo: 2574 },
  templateCreate: { code: "01076999", name: "วิชาทดลอง", description: "สร้างจาก Swagger" },
  templateUpdate: { name: "วิชาทดลอง (แก้ชื่อ)" },
  courseCreate: {
    name: "วิชาทดลองจาก Swagger",
    coverColor: "#0F766E",
    icon: "code",
    courseTemplateId: "ct-18",
    code: "01076112",
    academicYear: 2569,
    term: 2,
    sectionNumber: "2",
    schedule: "ศุกร์ 9:00-12:00",
    room: "811",
  },
  courseUpdate: { status: "archived", room: null },
  teacherCreate: { title: "ดร.", name: "ทดลอง ใช้งาน", email: "trial.user@kmitl.ac.th", role: "teacher" },
  teacherImport: [
    { name: "ผู้ช่วย หนึ่ง", email: "ta.one@kmitl.ac.th", role: "ta" },
    { title: "อ.", name: "อาจารย์ สอง", email: "teacher.two@kmitl.ac.th", role: "teacher" },
  ],
  teacherUpdate: { title: null, courseIds: ["c-mock-1"] },
  studentCreate: [
    { studentId: "69070999", title: "นาย", firstName: "ทดลอง", lastName: "ระบบ", email: "69070999@kmitl.ac.th", cohort: "CE69", program: "CE" },
  ],
  studentUpdate: { status: "inactive" },
};
const pathParam = (name: string, description?: string) => ({
  name,
  in: "path",
  required: true,
  schema: { type: "string" },
  ...(description && { description }),
});

type Op = {
  summary: string;
  params?: object[];
  query?: object[];
  body?: object;
  res: object;
  errors?: Record<string, string>;
};

function op(tag: string, o: Op) {
  return {
    tags: [tag],
    summary: o.summary,
    parameters: [...(o.params ?? []), ...(o.query ?? [])],
    ...(o.body && { requestBody: o.body }),
    responses: {
      ...o.res,
      ...Object.fromEntries(Object.entries(o.errors ?? {}).map(([code, d]) => [code, errorResponse(d)])),
    },
  };
}

const id = pathParam("id");
const V400 = { "400": "Validation error" };
const N404 = { "404": "Not found" };

export const openapiSpec = {
  openapi: "3.1.0",
  info: {
    title: "HWAI Agent API",
    version: "0.1.0",
    description:
      "Backend สำหรับหน้า admin ของ HWAI-frontend (users / courses / curriculum).\n\n" +
      "- POST ที่สร้างข้อมูลรับ `id` จาก client ได้ (ไม่ส่งจะสร้าง uuid ให้)\n" +
      "- PATCH ส่งเฉพาะ field ที่จะแก้ และส่ง `null` เพื่อล้างค่า field ที่ optional\n" +
      "- Error ตอบเป็น `{ error: string }` — 400 validation, 404 not found, 409 ข้อมูลซ้ำ",
  },
  servers: [{ url: "/api" }],
  tags: [
    { name: "Curriculum", description: "หลักสูตร + รายวิชาในหลักสูตร (/admin/curriculum)" },
    { name: "Courses", description: "รายวิชาที่เปิดสอน / section (/admin/courses)" },
    { name: "Teachers", description: "อาจารย์ / TA (/admin/users)" },
    { name: "Students", description: "นักศึกษา (/admin/users)" },
    { name: "System" },
  ],
  components: {
    schemas: Object.fromEntries(Object.entries(responses).map(([k, s]) => [k, json(s)])),
  },
  paths: {
    "/health": { get: op("System", { summary: "Health check", res: ok({ type: "object", properties: { ok: { type: "boolean" } } }) }) },

    "/curriculum-versions": {
      get: op("Curriculum", { summary: "รายการหลักสูตรทั้งหมด", res: ok({ type: "array", items: ref("CurriculumVersion") }) }),
      post: op("Curriculum", { summary: "สร้างหลักสูตร", body: body(json(versionCreate), examples.versionCreate), res: ok(ref("CurriculumVersion"), "201"), errors: V400 }),
    },
    "/curriculum-versions/{id}": {
      patch: op("Curriculum", { summary: "แก้ไขหลักสูตร", params: [id], body: body(json(versionUpdate), examples.versionUpdate), res: ok(ref("CurriculumVersion")), errors: { ...V400, ...N404 } }),
      delete: op("Curriculum", { summary: "ลบหลักสูตร (ลบรายวิชาในหลักสูตรด้วย)", params: [id], res: noContent, errors: N404 }),
    },
    "/course-templates": {
      get: op("Curriculum", { summary: "รายวิชาในหลักสูตรทั้งหมด (ทุกหลักสูตร)", res: ok({ type: "array", items: ref("CourseTemplate") }) }),
    },
    "/curriculum-versions/{id}/course-templates": {
      get: op("Curriculum", { summary: "รายวิชาในหลักสูตรที่ระบุ", params: [id], res: ok({ type: "array", items: ref("CourseTemplate") }) }),
      post: op("Curriculum", { summary: "เพิ่มรายวิชาในหลักสูตร", params: [id], body: body(json(templateCreate), examples.templateCreate), res: ok(ref("CourseTemplate"), "201"), errors: { "400": "Validation error / หลักสูตรไม่มีอยู่" } }),
    },
    "/course-templates/{id}": {
      patch: op("Curriculum", { summary: "แก้ไขรายวิชาในหลักสูตร", params: [id], body: body(json(templateUpdate), examples.templateUpdate), res: ok(ref("CourseTemplate")), errors: { ...V400, ...N404 } }),
      delete: op("Curriculum", { summary: "ลบรายวิชาในหลักสูตร", params: [id], res: noContent, errors: N404 }),
    },

    "/courses": {
      get: op("Courses", { summary: "รายวิชาที่เปิดสอนทั้งหมด", res: ok({ type: "array", items: ref("Course") }) }),
      post: op("Courses", { summary: "สร้างรายวิชา", body: body(json(courseCreate), examples.courseCreate), res: ok(ref("Course"), "201"), errors: V400 }),
    },
    "/courses/{id}": {
      get: op("Courses", { summary: "ดูรายวิชา", params: [id], res: ok(ref("Course")), errors: N404 }),
      patch: op("Courses", { summary: "แก้ไขรายวิชา", params: [id], body: body(json(courseUpdate), examples.courseUpdate), res: ok(ref("Course")), errors: { ...V400, ...N404 } }),
      delete: op("Courses", { summary: "ลบรายวิชา (ยกเลิกการ assign อาจารย์ด้วย)", params: [id], res: noContent, errors: N404 }),
    },
    "/courses/{id}/teachers": {
      get: op("Courses", { summary: "อาจารย์ที่ assign ในรายวิชานี้", params: [id], res: ok({ type: "array", items: ref("ManagedTeacher") }) }),
    },

    "/managed-teachers": {
      get: op("Teachers", { summary: "อาจารย์ทั้งหมด", res: ok({ type: "array", items: ref("ManagedTeacher") }) }),
      post: op("Teachers", { summary: "เพิ่มอาจารย์", body: body(json(teacherCreate), examples.teacherCreate), res: ok(ref("ManagedTeacher"), "201"), errors: { ...V400, "409": "Email ซ้ำ" } }),
    },
    "/managed-teachers/import": {
      post: op("Teachers", { summary: "นำเข้าอาจารย์หลายคน (ซ้ำคนเดียว = reject ทั้งชุด)", body: body({ type: "array", items: json(teacherCreate) }, examples.teacherImport), res: ok({ type: "array", items: ref("ManagedTeacher") }, "201"), errors: { ...V400, "409": "Email ซ้ำ" } }),
    },
    "/managed-teachers/{id}": {
      patch: op("Teachers", { summary: "แก้ไขอาจารย์ (courseIds = แทนที่รายวิชาที่ assign ทั้งหมด)", params: [id], body: body(json(teacherUpdate), examples.teacherUpdate), res: ok(ref("ManagedTeacher")), errors: { ...V400, ...N404, "409": "Email ซ้ำ" } }),
      delete: op("Teachers", { summary: "ลบอาจารย์", params: [id], res: noContent, errors: N404 }),
    },
    "/managed-teachers/{id}/status": {
      patch: op("Teachers", { summary: "เปิด/ปิดใช้งานอาจารย์", params: [id], body: body({ type: "object", required: ["status"], properties: { status: { type: "string", enum: ["active", "inactive"] } } }), res: noContent, errors: { ...V400, ...N404 } }),
    },
    "/managed-teachers/{id}/courses/{courseId}": {
      post: op("Teachers", { summary: "Assign อาจารย์เข้ารายวิชา (เรียกซ้ำได้)", params: [id, pathParam("courseId")], res: noContent, errors: { "400": "อาจารย์หรือรายวิชาไม่มีอยู่" } }),
      delete: op("Teachers", { summary: "ยกเลิก assign", params: [id, pathParam("courseId")], res: noContent }),
    },

    "/cohort-students": {
      get: op("Students", {
        summary: "นักศึกษาทั้งหมด",
        query: [{ name: "cohort", in: "query", required: false, schema: { type: "string" }, description: "กรองตามรุ่น เช่น CE69" }],
        res: ok({ type: "array", items: ref("CohortStudent") }),
      }),
      post: op("Students", { summary: "เพิ่มนักศึกษา (ส่งเป็น array, ซ้ำคนเดียว = reject ทั้งชุด)", body: body({ type: "array", items: json(studentCreate) }, examples.studentCreate), res: ok({ type: "array", items: ref("CohortStudent") }, "201"), errors: { ...V400, "409": "รหัสนักศึกษาซ้ำ" } }),
    },
    "/cohort-students/{id}": {
      patch: op("Students", { summary: "แก้ไขนักศึกษา", params: [id], body: body(json(studentUpdate), examples.studentUpdate), res: ok(ref("CohortStudent")), errors: { ...V400, ...N404 } }),
      delete: op("Students", { summary: "ลบนักศึกษา", params: [id], res: noContent, errors: N404 }),
    },
  },
};
