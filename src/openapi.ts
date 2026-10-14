// OpenAPI 3.1 spec served at /docs (Swagger UI) and /openapi.json. Request bodies are generated from
// the same zod schemas the routes validate with, so the docs can't drift from the real validation.
import { z } from "zod";
import { courseCreate, courseUpdate } from "./routes/courses.js";
import { templateCreate, templateUpdate, versionCreate, versionUpdate } from "./routes/curriculum.js";
import { teacherCreate, teacherUpdate } from "./routes/managed-teachers.js";
import { studentBulkUpdate, studentCreate, studentUpdate } from "./routes/cohort-students.js";
import { enrollmentCreate, enrollmentUpdate } from "./routes/enrollments.js";
import { categoryCreate, categoryUpdate } from "./routes/grading-categories.js";
import {
  assignmentCreate,
  assignmentUpdate,
  rubricCreate,
  rubricUpdate,
  submissionCreate,
  submissionUpdate,
} from "./routes/assignments.js";
import { groupCreate, groupUpdate } from "./routes/student-groups.js";
import { MAX_FILE_BYTES } from "./routes/files.js";
import { cloCreate, cloUpdate, sectionRoleCreate } from "./routes/course-staff.js";
import { calibrationRunPut, libraryEntryCreate, libraryEntryUpdate } from "./routes/rubric-tools.js";
import { demoLoginBody, googleLoginBody } from "./routes/auth.js";

const json = (schema: z.ZodType) => z.toJSONSchema(schema, { io: "input", unrepresentable: "any" });

// Response shapes (see src/lib/serialize.ts). Optional fields are omitted rather than null.
const opt = <T extends z.ZodType>(s: T) => s.optional();
const timestamps = { createdAt: z.iso.datetime(), updatedAt: z.iso.datetime() };
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
    term: opt(z.union([z.literal(1), z.literal(2), z.literal(3), z.literal("summer")])),
    sectionNumber: opt(z.string()),
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
    program: z.string(),
    status: z.enum(["active", "inactive"]),
    curriculumVersionId: opt(z.string()),
  }),
  // ── Course content (see src/lib/content.ts) ──
  Enrollment: z.object({
    id: z.string(),
    courseId: z.string(),
    studentId: z.string(),
    firstName: z.string(),
    lastName: z.string(),
    email: z.string(),
    sequenceNumber: opt(z.number().int()),
    enrollmentStatus: opt(z.enum(["enrolled", "withdrawn", "added-midterm"])),
  }),
  GradingCategory: z.object({ id: z.string(), courseId: z.string(), name: z.string(), weight: z.number(), ...timestamps }),
  Assignment: assignmentUpdate.extend({ id: z.string(), courseId: z.string(), ...timestamps }),
  Rubric: rubricUpdate.required().extend({ id: z.string(), assignmentId: z.string(), ...timestamps }),
  Submission: submissionCreate.omit({ id: true }).extend({ id: z.string(), assignmentId: z.string(), updatedAt: z.iso.datetime() }),
  StudentGroup: z.object({
    id: z.string(),
    assignmentId: z.string(),
    courseId: z.string(),
    name: z.string(),
    memberStudentIds: z.array(z.string()),
    ...timestamps,
  }),
  StoredFile: z.object({ id: z.string(), name: z.string(), mimeType: z.string(), size: z.number().int() }),
  Me: z.object({
    email: z.string(),
    name: z.string(),
    demo: z.boolean().describe("เข้าสู่ระบบแบบเดโม"),
    roles: z.array(z.enum(["admin", "teacher", "ta", "student"])),
    defaultRole: z.enum(["admin", "teacher", "ta", "student"]),
    teacher: z.object({ id: z.string(), role: z.enum(["teacher", "ta"]), name: z.string() }).nullable(),
    student: z.object({ id: z.string(), studentId: z.string(), name: z.string(), email: z.string() }).nullable(),
  }),
  AuthConfig: z.object({
    demoLogin: z.boolean(),
    demoAccounts: z.array(z.string()),
    google: z.boolean(),
    googleClientId: opt(z.string()),
    googleDomain: opt(z.string()),
  }),
  SectionRole: z.object({
    id: z.string(),
    accountId: z.string(),
    courseId: z.string(),
    role: z.enum(["teacher", "ta", "co-teacher"]),
    permissions: opt(z.object({ canManageRoster: z.boolean(), canEditSettings: z.boolean(), canPublishScores: z.boolean() })),
  }),
  CLO: z.object({ id: z.string(), courseId: z.string(), code: z.string(), text: z.string(), ...timestamps }),
  RubricLibraryEntry: libraryEntryCreate.omit({ id: true }).extend({ id: z.string(), createdAt: z.iso.datetime() }),
  CalibrationRun: calibrationRunPut.omit({ id: true }).extend({ id: z.string() }),
  RejectedEnrollment: z.object({
    studentId: z.string(),
    program: z.string(),
    sectionProgram: z.string(),
    reason: z.literal("wrong_program"),
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
    { studentId: "69070999", title: "นาย", firstName: "ทดลอง", lastName: "ระบบ", email: "69070999@kmitl.ac.th", program: "CE" },
  ],
  studentUpdate: { status: "inactive" },
  studentBulkUpdate: { ids: ["cs-mock-1", "cs-mock-2"], data: { status: "inactive" } },
  enrollmentCreate: [{ studentId: "69070104", firstName: "ทดลอง", lastName: "ลงทะเบียน", email: "69070104@kmitl.ac.th" }],
  enrollmentUpdate: { enrollmentStatus: "withdrawn" },
  categoryCreate: { name: "งานกลุ่ม", weight: 10 },
  categoryUpdate: { weight: 30 },
  assignmentCreate: {
    name: "Lab ทดลองจาก Swagger",
    description: "เขียนโปรแกรมวนซ้ำ 3 ข้อ",
    dueDate: "2026-10-20",
    maxPoints: 100,
    categoryId: "gcat-seed-c1-1",
    fileTypes: ["pdf"],
    submissionType: "individual",
  },
  assignmentUpdate: { gradingFinalized: true },
  rubricCreate: {
    name: "เกณฑ์ทดลอง",
    criteria: [{
      id: "c1", name: "ความถูกต้อง", description: "", maxPoints: 100, weight: 100,
      levels: [{ label: "ดี", description: "" }, { label: "ต้องปรับปรุง", description: "" }],
    }],
  },
  rubricUpdate: { name: "เกณฑ์ทดลอง (แก้ชื่อ)" },
  submissionCreate: {
    studentId: "69070102",
    studentName: "สุดา วงษ์สา",
    email: "69070102@kmitl.ac.th",
    submittedAt: "2026-10-01T10:00:00.000Z",
    attachments: [{ id: "att-1", kind: "link", name: "งานของฉัน", source: "url", ref: "https://example.com/work" }],
  },
  submissionUpdate: { status: "graded", instructorScore: 88, instructorComment: "ดีมาก" },
  groupCreate: { name: "ทีม A", memberStudentIds: ["69070101", "69070102"] },
  groupUpdate: { memberStudentIds: ["69070101"] },
  roleCreateTa: { accountId: "cs-mock-14", role: "ta" },
  rolePermissions: { canManageRoster: false, canEditSettings: false, canPublishScores: true },
  cloCreate: { code: "CLO5", text: "นักศึกษาสามารถทดสอบโปรแกรมด้วย unit test ได้" },
  cloUpdate: { text: "นักศึกษาสามารถเขียน unit test ครอบคลุมกรณีขอบได้" },
  libraryEntryCreate: {
    name: "เกณฑ์แบบฝึกหัด Python",
    courseTemplateId: "ct-18",
    sourceAssignmentId: "a-mock-1",
    criteria: [{ id: "c1", name: "ความถูกต้อง", description: "", maxPoints: 10, weight: 100, levels: [{ label: "ดี", description: "" }], cloIds: ["clo-mock-1"] }],
  },
  libraryEntryUpdate: { name: "เกณฑ์แบบฝึกหัด Python (ปี 2569)" },
  calibrationRunPut: {
    assignmentId: "a-mock-1",
    createdAt: "2026-10-12T09:00:00.000Z",
    sampleIds: ["sub-mock-1", "sub-mock-2"],
    teacherLevels: { "sub-mock-1": { "rc-1": 0, "rc-2": 1 }, "sub-mock-2": { "rc-1": 2, "rc-2": 1 } },
    completedAt: "2026-10-12T09:30:00.000Z",
  },
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
  /** Open without signing in (no cookie needed, no 401/403). */
  open?: boolean;
};

const AUTH_ERRORS = { "401": "ยังไม่ได้เข้าสู่ระบบ (ไม่มี / หมดอายุ session cookie)", "403": "ไม่มีสิทธิ์ทำรายการนี้" };

function op(tag: string, o: Op) {
  return {
    tags: [tag],
    summary: o.summary,
    parameters: [...(o.params ?? []), ...(o.query ?? [])],
    ...(o.body && { requestBody: o.body }),
    ...(o.open && { security: [] }),
    responses: {
      ...o.res,
      ...Object.fromEntries(
        Object.entries({ ...(o.open ? {} : AUTH_ERRORS), ...o.errors }).map(([code, d]) => [code, errorResponse(d)]),
      ),
    },
  };
}

const id = pathParam("id");
const courseId = pathParam("courseId");
const list = (m: Model) => ({ type: "array", items: ref(m) });
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
      "- Error ตอบเป็น `{ error: string }` — 400 validation, 401 ยังไม่ได้เข้าสู่ระบบ, 403 ไม่มีสิทธิ์, 404 not found, 409 ข้อมูลซ้ำ\n\n" +
      "**การเข้าสู่ระบบ** — session อยู่ใน cookie `hwai_session` (HttpOnly) ทุก endpoint ต้องเข้าสู่ระบบก่อน ยกเว้น /health และ /auth/*. " +
      "ลองใน Swagger: เรียก `POST /auth/demo-login` ก่อน (ต้องรันด้วย DEMO_LOGIN=true) แล้ว cookie จะติดไปกับทุก request\n\n" +
      "**สิทธิ์** — admin ทำได้ทุกอย่าง · หลักสูตร / บัญชีอาจารย์-นักศึกษา / สร้าง-ลบรายวิชา: admin เท่านั้น · " +
      "ในรายวิชา: อาจารย์หลักและ co-teacher ทำได้ทุกอย่าง, TA ตาม permissions (canManageRoster = รายชื่อ + ผู้ร่วมสอน, " +
      "canEditSettings = ตั้งค่ารายวิชา / งาน / rubric / หมวดคะแนน / CLO, canPublishScores = ประกาศคะแนน), staff ทุกคนตรวจงานได้ · " +
      "นักศึกษา: อ่านข้อมูลรายวิชาที่ลงทะเบียน, ส่งงานของตัวเอง (หรือของเพื่อนร่วมทีม) โดยเซิร์ฟเวอร์กำหนดผู้ส่ง เวลา และคะแนนเอง, " +
      "เห็นคะแนนตัวเองหลังประกาศ และคะแนนคนอื่นแบบไม่ระบุตัวตน",
  },
  servers: [{ url: "/api" }],
  tags: [
    { name: "Curriculum", description: "หลักสูตร + รายวิชาในหลักสูตร (/admin/curriculum)" },
    { name: "Courses", description: "รายวิชาที่เปิดสอน / section (/admin/courses)" },
    { name: "Teachers", description: "อาจารย์ / TA (/admin/users)" },
    { name: "Students", description: "นักศึกษา (/admin/users)" },
    { name: "Rosters", description: "รายชื่อนักศึกษาในแต่ละรายวิชา (Student ของ frontend)" },
    { name: "Grading categories", description: "หมวดคะแนนของรายวิชา" },
    { name: "Assignments", description: "งาน + rubric (หน้าสร้างงานของอาจารย์)" },
    { name: "Submissions", description: "งานที่นักศึกษาส่ง + คะแนน" },
    { name: "Teams", description: "ทีมสำหรับงานกลุ่ม" },
    { name: "Collaborators", description: "ผู้ร่วมสอนในรายวิชา: TA (นักศึกษา) / co-teacher (อาจารย์)" },
    { name: "CLOs", description: "ผลลัพธ์การเรียนรู้ของรายวิชา" },
    { name: "Rubric tools", description: "คลัง rubric สำหรับใช้ซ้ำ และผล Calibration ของ AI" },
    { name: "Files", description: "ไฟล์แนบ (เก็บใน PostgreSQL)" },
    { name: "Auth", description: "เข้าสู่ระบบ (Google สำหรับ @kmitl.ac.th และ demo sign-in)" },
    { name: "System" },
  ],
  components: {
    schemas: Object.fromEntries(Object.entries(responses).map(([k, s]) => [k, json(s)])),
    securitySchemes: { session: { type: "apiKey", in: "cookie", name: "hwai_session" } },
  },
  security: [{ session: [] }],
  paths: {
    "/health": { get: op("System", { summary: "Health check", open: true, res: ok({ type: "object", properties: { ok: { type: "boolean" } } }) }) },

    "/auth/config": {
      get: op("Auth", { summary: "วิธีเข้าสู่ระบบที่เปิดอยู่ (หน้า login ใช้)", open: true, res: ok(ref("AuthConfig")) }),
    },
    "/auth/google": {
      post: op("Auth", {
        summary: "เข้าสู่ระบบด้วย Google — ส่ง ID token (credential) จากปุ่ม Sign in with Google; ตรวจลายเซ็น, aud, email_verified และ hd = kmitl.ac.th แล้วต้องมีบัญชีที่ active (session 7 วัน)",
        open: true,
        body: body(json(googleLoginBody)),
        res: ok(ref("Me")),
        errors: { ...V400, "401": "token ใช้ไม่ได้", "403": "ไม่ใช่บัญชี @kmitl.ac.th / ไม่มีบัญชีในระบบ", "404": "ยังไม่ได้ตั้ง GOOGLE_CLIENT_ID" },
      }),
    },
    "/auth/demo-login": {
      post: op("Auth", {
        summary: "เข้าสู่ระบบแบบเดโม — ข้ามแค่การยืนยันตัวตน สิทธิ์เท่าบัญชีนั้นจริงๆ (DEMO_LOGIN=true, ไม่ใช่ production, เฉพาะอีเมลใน DEMO_ACCOUNTS; session 8 ชม.)",
        open: true,
        body: body(json(demoLoginBody), { email: "somsak.c@kmitl.ac.th" }),
        res: ok(ref("Me")),
        errors: { ...V400, "403": "อีเมลนี้ใช้ demo sign-in ไม่ได้ / ไม่มีบัญชีที่ active", "404": "ปิด demo sign-in อยู่" },
      }),
    },
    "/auth/logout": { post: op("Auth", { summary: "ออกจากระบบ (ลบ session)", open: true, res: noContent }) },
    "/auth/me": {
      get: op("Auth", { summary: "ผู้ที่เข้าสู่ระบบอยู่ และทุกบทบาทที่มี", res: ok(ref("Me")), errors: { "401": AUTH_ERRORS["401"] } }),
    },

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
        res: ok({ type: "array", items: ref("CohortStudent") }),
      }),
      post: op("Students", { summary: "เพิ่มนักศึกษา (ส่งเป็น array, ซ้ำคนเดียว = reject ทั้งชุด)", body: body({ type: "array", items: json(studentCreate) }, examples.studentCreate), res: ok({ type: "array", items: ref("CohortStudent") }, "201"), errors: { ...V400, "409": "รหัสนักศึกษาซ้ำ" } }),
      patch: op("Students", { summary: "แก้ไขนักศึกษาหลายคนพร้อมกัน เช่น ปิดใช้งานทั้งรุ่น (ไม่เจอคนใดคนหนึ่ง = ไม่แก้เลย)", body: body(json(studentBulkUpdate), examples.studentBulkUpdate), res: ok({ type: "array", items: ref("CohortStudent") }), errors: { ...V400, ...N404 } }),
    },
    "/cohort-students/{id}": {
      patch: op("Students", { summary: "แก้ไขนักศึกษา", params: [id], body: body(json(studentUpdate), examples.studentUpdate), res: ok(ref("CohortStudent")), errors: { ...V400, ...N404 } }),
      delete: op("Students", { summary: "ลบนักศึกษา", params: [id], res: noContent, errors: N404 }),
    },

    // ── Course content ─────────────────────────────────────────────────────────
    "/students": {
      get: op("Rosters", { summary: "รายชื่อนักศึกษาของทุกรายวิชา", res: ok(list("Enrollment")) }),
    },
    "/courses/{courseId}/students": {
      get: op("Rosters", { summary: "รายชื่อนักศึกษาในรายวิชา", params: [courseId], res: ok(list("Enrollment")) }),
      post: op("Rosters", {
        summary: "เพิ่มนักศึกษาเข้ารายวิชา (array) — ลำดับต่อท้าย, คนที่เพิ่มทีหลัง = added-midterm. 1 section = 1 สาขา: คนต่างสาขาจะไม่ถูกเพิ่มและอยู่ใน rejected",
        params: [courseId], body: body({ type: "array", items: json(enrollmentCreate) }, examples.enrollmentCreate),
        res: ok({
          type: "object",
          properties: {
            enrolled: list("Enrollment"),
            rejected: { type: "array", items: ref("RejectedEnrollment") },
          },
        }, "201"),
        errors: { ...V400, "404": "ไม่พบรายวิชา", "409": "นักศึกษาอยู่ในรายวิชานี้แล้ว", "422": "ทุกคนอยู่คนละสาขากับ section (มี rejected แนบมา)" },
      }),
    },
    "/students/{id}": {
      patch: op("Rosters", { summary: "แก้ไข / ถอนรายวิชา (enrollmentStatus)", params: [id], body: body(json(enrollmentUpdate), examples.enrollmentUpdate), res: ok(ref("Enrollment")), errors: { ...V400, ...N404 } }),
      delete: op("Rosters", { summary: "ลบออกจากรายวิชา", params: [id], res: noContent, errors: N404 }),
    },

    "/grading-categories": {
      get: op("Grading categories", { summary: "หมวดคะแนนของทุกรายวิชา", res: ok(list("GradingCategory")) }),
    },
    "/courses/{courseId}/grading-categories": {
      get: op("Grading categories", { summary: "หมวดคะแนนของรายวิชา", params: [courseId], res: ok(list("GradingCategory")) }),
      post: op("Grading categories", { summary: "เพิ่มหมวดคะแนน", params: [courseId], body: body(json(categoryCreate), examples.categoryCreate), res: ok(ref("GradingCategory"), "201"), errors: V400 }),
    },
    "/grading-categories/{id}": {
      patch: op("Grading categories", { summary: "แก้ไขหมวดคะแนน", params: [id], body: body(json(categoryUpdate), examples.categoryUpdate), res: ok(ref("GradingCategory")), errors: { ...V400, ...N404 } }),
      delete: op("Grading categories", { summary: "ลบหมวดคะแนน (งานในหมวดยังอยู่ แค่ไม่มีหมวด)", params: [id], res: noContent, errors: N404 }),
    },

    "/assignments": {
      get: op("Assignments", { summary: "งานของทุกรายวิชา", res: ok(list("Assignment")) }),
    },
    "/courses/{courseId}/assignments": {
      get: op("Assignments", { summary: "งานในรายวิชา", params: [courseId], res: ok(list("Assignment")) }),
      post: op("Assignments", { summary: "สร้างงาน", params: [courseId], body: body(json(assignmentCreate), examples.assignmentCreate), res: ok(ref("Assignment"), "201"), errors: V400 }),
    },
    "/assignments/{id}": {
      get: op("Assignments", { summary: "ดูงาน", params: [id], res: ok(ref("Assignment")), errors: N404 }),
      patch: op("Assignments", { summary: "แก้ไขงาน (gradingFinalized = ประกาศคะแนน)", params: [id], body: body(json(assignmentUpdate), examples.assignmentUpdate), res: ok(ref("Assignment")), errors: { ...V400, ...N404 } }),
      delete: op("Assignments", { summary: "ลบงาน (rubric, งานที่ส่ง, ทีม ถูกลบด้วย)", params: [id], res: noContent, errors: N404 }),
    },
    "/rubrics": {
      get: op("Assignments", { summary: "rubric ทั้งหมด", res: ok(list("Rubric")) }),
    },
    "/assignments/{id}/rubrics": {
      get: op("Assignments", { summary: "rubric ของงาน", params: [id], res: ok(list("Rubric")) }),
      post: op("Assignments", { summary: "เพิ่ม rubric (แล้ว PATCH งานให้ rubricIds ชี้มา)", params: [id], body: body(json(rubricCreate), examples.rubricCreate), res: ok(ref("Rubric"), "201"), errors: V400 }),
    },
    "/rubrics/{id}": {
      patch: op("Assignments", { summary: "แก้ไข rubric", params: [id], body: body(json(rubricUpdate), examples.rubricUpdate), res: ok(ref("Rubric")), errors: { ...V400, ...N404 } }),
      delete: op("Assignments", { summary: "ลบ rubric", params: [id], res: noContent, errors: N404 }),
    },

    "/submissions": {
      get: op("Submissions", { summary: "งานที่ส่งทั้งหมด", res: ok(list("Submission")) }),
    },
    "/assignments/{id}/submissions": {
      get: op("Submissions", { summary: "งานที่ส่งของงานนี้", params: [id], res: ok(list("Submission")) }),
      post: op("Submissions", { summary: "ส่งงาน (1 ครั้งต่อคนต่องาน — ส่งใหม่ใช้ PATCH)", params: [id], body: body(json(submissionCreate), examples.submissionCreate), res: ok(ref("Submission"), "201"), errors: { ...V400, "409": "นักศึกษาคนนี้ส่งงานนี้แล้ว" } }),
    },
    "/submissions/{id}": {
      patch: op("Submissions", { summary: "ส่งใหม่ / ให้คะแนน", params: [id], body: body(json(submissionUpdate), examples.submissionUpdate), res: ok(ref("Submission")), errors: { ...V400, ...N404 } }),
    },

    "/student-groups": {
      get: op("Teams", { summary: "ทีมทั้งหมด", res: ok(list("StudentGroup")) }),
    },
    "/assignments/{id}/groups": {
      get: op("Teams", { summary: "ทีมของงานกลุ่มนี้", params: [id], res: ok(list("StudentGroup")) }),
      post: op("Teams", { summary: "ตั้งทีม (ไม่เกิน maxGroupSize ของงาน)", params: [id], body: body(json(groupCreate), examples.groupCreate), res: ok(ref("StudentGroup"), "201"), errors: { "400": "Validation error / ไม่ใช่งานกลุ่ม / สมาชิกเกิน", ...N404 } }),
    },
    "/student-groups/{id}": {
      patch: op("Teams", { summary: "แก้ชื่อ / สมาชิก", params: [id], body: body(json(groupUpdate), examples.groupUpdate), res: ok(ref("StudentGroup")), errors: { ...V400, ...N404 } }),
      delete: op("Teams", { summary: "ยุบทีม", params: [id], res: noContent, errors: N404 }),
    },

    "/section-roles": {
      get: op("Collaborators", { summary: "role ทั้งหมด", res: ok(list("SectionRole")) }),
    },
    "/courses/{courseId}/roles": {
      get: op("Collaborators", { summary: "ผู้ร่วมสอนของรายวิชา", params: [courseId], res: ok(list("SectionRole")) }),
      post: op("Collaborators", {
        summary: "เพิ่มผู้ร่วมสอน — accountId = id ของนักศึกษา (TA) หรืออาจารย์ (co-teacher)",
        params: [courseId], body: body(json(sectionRoleCreate), examples.roleCreateTa), res: ok(ref("SectionRole"), "201"),
        errors: { "400": "Validation error / role ไม่เข้ากับบัญชี (นักศึกษาเป็นได้แค่ TA) / ไม่พบบัญชี", "409": "คนนี้มี role ในรายวิชานี้แล้ว" },
      }),
    },
    "/section-roles/{id}/permissions": {
      patch: op("Collaborators", {
        summary: "กำหนดสิทธิ์แทนค่าเริ่มต้นของ role (ส่ง null = กลับไปใช้ค่าเริ่มต้น)",
        params: [id], body: body({ type: ["object", "null"], properties: { canManageRoster: { type: "boolean" }, canEditSettings: { type: "boolean" }, canPublishScores: { type: "boolean" } } }, examples.rolePermissions),
        res: ok(ref("SectionRole")), errors: { ...V400, ...N404 },
      }),
    },
    "/section-roles/{id}": {
      delete: op("Collaborators", { summary: "เอาออกจากรายวิชา", params: [id], res: noContent, errors: N404 }),
    },

    "/clos": {
      get: op("CLOs", { summary: "CLO ทั้งหมด", res: ok(list("CLO")) }),
    },
    "/courses/{courseId}/clos": {
      get: op("CLOs", { summary: "CLO ของรายวิชา", params: [courseId], res: ok(list("CLO")) }),
      post: op("CLOs", { summary: "เพิ่ม CLO", params: [courseId], body: body(json(cloCreate), examples.cloCreate), res: ok(ref("CLO"), "201"), errors: V400 }),
    },
    "/clos/{id}": {
      patch: op("CLOs", { summary: "แก้ไข CLO", params: [id], body: body(json(cloUpdate), examples.cloUpdate), res: ok(ref("CLO")), errors: { ...V400, ...N404 } }),
      delete: op("CLOs", { summary: "ลบ CLO", params: [id], res: noContent, errors: N404 }),
    },

    "/rubric-library": {
      get: op("Rubric tools", {
        summary: "คลัง rubric (ใส่ courseTemplateId = ของวิชานั้น + ที่ใช้ได้ทุกวิชา)",
        query: [{ name: "courseTemplateId", in: "query", required: false, schema: { type: "string" } }],
        res: ok(list("RubricLibraryEntry")),
      }),
      post: op("Rubric tools", { summary: "บันทึก rubric ลงคลัง", body: body(json(libraryEntryCreate), examples.libraryEntryCreate), res: ok(ref("RubricLibraryEntry"), "201"), errors: V400 }),
    },
    "/rubric-library/{id}": {
      patch: op("Rubric tools", { summary: "เปลี่ยนชื่อ", params: [id], body: body(json(libraryEntryUpdate), examples.libraryEntryUpdate), res: ok(ref("RubricLibraryEntry")), errors: { ...V400, ...N404 } }),
      delete: op("Rubric tools", { summary: "ลบออกจากคลัง", params: [id], res: noContent, errors: N404 }),
    },
    "/calibration-runs": {
      get: op("Rubric tools", {
        summary: "ผล Calibration",
        query: [{ name: "assignmentId", in: "query", required: false, schema: { type: "string" } }],
        res: ok(list("CalibrationRun")),
      }),
    },
    "/calibration-runs/{id}": {
      put: op("Rubric tools", {
        summary: "สร้างหรือแทนที่ทั้ง run (201 ถ้าสร้างใหม่, 200 ถ้าแทนที่)",
        params: [id], body: body(json(calibrationRunPut), examples.calibrationRunPut),
        res: { ...ok(ref("CalibrationRun")), ...ok(ref("CalibrationRun"), "201") }, errors: V400,
      }),
      delete: op("Rubric tools", { summary: "ลบ run", params: [id], res: noContent, errors: N404 }),
    },

    "/files": {
      post: op("Files", {
        summary: `อัปโหลดไฟล์ (ไม่เกิน ${MAX_FILE_BYTES / 1024 / 1024} MB) — body คือตัวไฟล์, ชื่อไฟล์ใส่ใน header X-File-Name (URI-encoded)`,
        params: [{ name: "X-File-Name", in: "header", required: false, schema: { type: "string" }, description: "ชื่อไฟล์ (encodeURIComponent)" }],
        body: { required: true, content: { "application/octet-stream": { schema: { type: "string", format: "binary" } } } },
        res: ok(ref("StoredFile"), "201"),
        errors: { "400": "ไม่มีไฟล์", "413": "ไฟล์ใหญ่เกิน" },
      }),
    },
    "/files/{id}": {
      get: op("Files", {
        summary: "ดาวน์โหลด / เปิดไฟล์ (รูปและ PDF เปิดในเบราว์เซอร์ ที่เหลือดาวน์โหลด)",
        params: [id],
        res: { "200": { description: "ตัวไฟล์", content: { "application/octet-stream": { schema: { type: "string", format: "binary" } } } } },
        errors: N404,
      }),
      delete: op("Files", { summary: "ลบไฟล์ (เรียกซ้ำได้)", params: [id], res: noContent }),
    },
  },
};
