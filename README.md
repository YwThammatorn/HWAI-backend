# HWAI-backend
[KMITL Project] AI Agent Web Application Backend Section

Express 5 + Prisma 7 + PostgreSQL API สำหรับ [HWAI-frontend](../HWAI-frontend).
ตอนนี้รองรับ:
- หน้า **admin** (`/admin/users`, `/admin/courses`, `/admin/curriculum`)
- หน้า **นักศึกษา** ทั้งหมด (`/student/...`) และหน้า**สร้าง/แก้ไขงาน**ของอาจารย์ — รวมถึงรายชื่อนักศึกษาในวิชา, หมวดคะแนน,
  งาน + rubric, งานที่ส่ง + คะแนน, ทีม และไฟล์แนบ

ที่ยังอยู่ใน localStorage ของ frontend: CLO, section roles (ผู้ร่วมสอน/TA), การแบ่งงานตรวจ (grading assignments) และ
ประกาศ / แผนรายสัปดาห์ / สื่อการสอน ซึ่ง frontend ซ่อนไว้ชั่วคราว (`featureFlags.ts`) — จะทำ backend ให้ตอนเปิดใช้

## Setup

```bash
npm install
cp .env.example .env          # แก้ DATABASE_URL ถ้าไม่ได้ใช้ docker-compose
docker compose up -d          # PostgreSQL 17 ที่ localhost:5432 (user/pass/db = hwai)
npx prisma migrate deploy     # สร้างตาราง
npm run db:seed               # ข้อมูลตัวอย่าง (ชุดเดียวกับ public/mock-data ของ frontend)
npm run dev                   # http://localhost:4000
```

ไม่มี Docker? ใช้ Postgres ในเครื่องแทนได้ด้วย `npx prisma dev` (Prisma Postgres local) แล้วเอา URL ที่ได้ไปใส่ `DATABASE_URL`

### ต่อกับ frontend

ใน `HWAI-frontend/.env.local`:

```
NEXT_PUBLIC_API_URL=http://localhost:4000
```

แล้ว `npm run dev` ฝั่ง frontend ใหม่ ถ้าไม่ตั้งค่านี้ frontend จะใช้ localStorage เหมือนเดิม (Playwright tests ใช้โหมดนี้)
frontend ต้องรันที่ origin ที่อยู่ใน `CORS_ORIGIN` (ค่าเริ่มต้น `http://localhost:3000`, ใส่หลายค่าคั่นด้วย `,`)

## Scripts

| Script | |
|---|---|
| `npm run dev` | รัน server แบบ watch |
| `npm run build` / `npm start` | compile เป็น `dist/` แล้วรัน |
| `npm run typecheck` | `tsc --noEmit` |
| `npm run db:migrate` | สร้าง migration ใหม่หลังแก้ `prisma/schema.prisma` |
| `npm run db:deploy` | apply migrations |
| `npm run db:seed` | seed ข้อมูลตัวอย่าง (รันซ้ำได้ — upsert ตาม id) |
| `npm run db:studio` | เปิด Prisma Studio |

## ลองเล่น API

- **Swagger UI** — http://localhost:4000/docs กดที่ endpoint → *Try it out* → *Execute* ยิงจริงได้เลย (spec ดิบอยู่ที่ `/openapi.json` เอาไป import เข้า Postman/Insomnia ได้)
- **Prisma Studio** — `npm run db:studio` ดู/แก้ข้อมูลในตารางตรง ๆ แบบ spreadsheet

request body ใน Swagger สร้างจาก zod schema ตัวเดียวกับที่ route ใช้ validate (`src/openapi.ts`) เลยตรงกับของจริงเสมอ

## API

Base path `/api`. Error ทุกตัวตอบเป็น `{ "error": "..." }` — 400 validation, 404 not found, 409 ข้อมูลซ้ำ (unique)
Response shape ตรงกับ type ใน `HWAI-frontend/src/lib/*.ts` (field ที่ไม่มีค่าจะไม่ถูกส่งมา แทนที่จะเป็น `null`)
ทุก `POST` ที่สร้างข้อมูลรับ `id` จาก client ได้ (frontend สร้าง id เองเพื่อทำ optimistic update) และ `PATCH` ส่ง `null` เพื่อล้างค่า field ที่ optional

| Method | Path | Body | Response |
|---|---|---|---|
| GET | `/health` | | `{ ok: true }` |
| GET | `/curriculum-versions` | | `CurriculumVersion[]` |
| POST | `/curriculum-versions` | `CurriculumVersion` (ไม่มี id ก็ได้) | `CurriculumVersion` |
| PATCH | `/curriculum-versions/:id` | partial | `CurriculumVersion` |
| DELETE | `/curriculum-versions/:id` | — ลบ course templates ด้วย | 204 |
| GET | `/course-templates` | ทั้งหมดทุกหลักสูตร | `CourseTemplate[]` |
| GET | `/curriculum-versions/:id/course-templates` | | `CourseTemplate[]` |
| POST | `/curriculum-versions/:id/course-templates` | `{ code, name, description? }` | `CourseTemplate` |
| PATCH | `/course-templates/:id` | partial | `CourseTemplate` |
| DELETE | `/course-templates/:id` | | 204 |
| GET | `/courses` | | `Course[]` |
| GET | `/courses/:id` | | `Course` |
| GET | `/courses/:id/teachers` | | `ManagedTeacher[]` |
| POST | `/courses` | `Course` (ไม่มี id/createdAt/updatedAt) | `Course` |
| PATCH | `/courses/:id` | partial | `Course` |
| DELETE | `/courses/:id` | — ยกเลิกการ assign อาจารย์ด้วย | 204 |
| GET | `/managed-teachers` | | `ManagedTeacher[]` |
| POST | `/managed-teachers` | `{ title?, name, email, role }` | `ManagedTeacher` |
| POST | `/managed-teachers/import` | array ของด้านบน (ซ้ำตัวเดียว = reject ทั้งชุด) | `ManagedTeacher[]` |
| PATCH | `/managed-teachers/:id` | partial (รวม `status`, `courseIds`) | `ManagedTeacher` |
| PATCH | `/managed-teachers/:id/status` | `{ status: "active" \| "inactive" }` | 204 |
| DELETE | `/managed-teachers/:id` | | 204 |
| POST | `/managed-teachers/:id/courses/:courseId` | — (เรียกซ้ำได้) | 204 |
| DELETE | `/managed-teachers/:id/courses/:courseId` | | 204 |
| GET | `/cohort-students` | | `CohortStudent[]` |
| POST | `/cohort-students` | array ของ `CohortStudent` (ซ้ำตัวเดียว = reject ทั้งชุด) | `CohortStudent[]` |
| PATCH | `/cohort-students` | `{ ids, data }` แก้หลายคนพร้อมกัน เช่น ปิดใช้งานทั้งรุ่น (ไม่เจอคนใด = ไม่แก้เลย, 404) | `CohortStudent[]` |
| PATCH | `/cohort-students/:id` | partial | `CohortStudent` |
| DELETE | `/cohort-students/:id` | | 204 |

### เนื้อหารายวิชา (หน้านักศึกษา + หน้าสร้างงาน)

ทุก resource มี `GET` แบบ "ทั้งหมด" (provider ของ frontend โหลดทีเดียว) และแบบรายวิชา/รายงาน — รายละเอียดครบ + ตัวอย่างที่ยิงได้จริงอยู่ใน Swagger (`/docs`)

| Resource | ทั้งหมด | ของรายวิชา / งาน | สร้าง | แก้ / ลบ |
|---|---|---|---|---|
| รายชื่อนักศึกษาในวิชา | `GET /students` | `GET /courses/:courseId/students` | `POST /courses/:courseId/students` (array) | `PATCH`/`DELETE /students/:id` |
| หมวดคะแนน | `GET /grading-categories` | `GET /courses/:courseId/grading-categories` | `POST` ที่เดียวกัน | `PATCH`/`DELETE /grading-categories/:id` |
| งาน | `GET /assignments` | `GET /courses/:courseId/assignments` | `POST` ที่เดียวกัน | `GET`/`PATCH`/`DELETE /assignments/:id` |
| rubric | `GET /rubrics` | `GET /assignments/:id/rubrics` | `POST` ที่เดียวกัน | `PATCH`/`DELETE /rubrics/:id` |
| งานที่ส่ง | `GET /submissions` | `GET /assignments/:id/submissions` | `POST` ที่เดียวกัน (1 ครั้ง/คน/งาน, ซ้ำ = 409) | `PATCH /submissions/:id` |
| ทีม | `GET /student-groups` | `GET /assignments/:id/groups` | `POST` ที่เดียวกัน (ไม่เกิน `maxGroupSize`) | `PATCH`/`DELETE /student-groups/:id` |

ลบงาน → rubric, งานที่ส่ง และทีมของงานนั้นถูกลบตาม · ลบรายวิชา → เนื้อหาทั้งหมดของรายวิชาถูกลบตาม · ลบหมวดคะแนน → งานยังอยู่แค่ไม่มีหมวด

### ไฟล์

ไฟล์เก็บในตาราง `files` ของ PostgreSQL (ไม่เกิน 10 MB ต่อไฟล์) — ไฟล์แนบที่ `source: "upload"` เก็บ id ของไฟล์ไว้ใน `ref`

| Method | Path | |
|---|---|---|
| POST | `/files` | body = ตัวไฟล์, `Content-Type` = ชนิดไฟล์, `X-File-Name` = ชื่อไฟล์ (URI-encoded) → `{ id, name, mimeType, size }` |
| GET | `/files/:id` | รูป (ยกเว้น SVG) และ PDF เปิดในเบราว์เซอร์ ที่เหลือบังคับดาวน์โหลด และทุกไฟล์ส่งพร้อม `Content-Security-Policy: sandbox` เพื่อไม่ให้ไฟล์ที่อัปโหลดรันสคริปต์ได้ |
| DELETE | `/files/:id` | เรียกซ้ำได้ |

## โครงสร้าง

```
prisma/
  schema.prisma        data model (ดูตารางด้านล่าง)
  migrations/
  seed.ts, seed-data/  ข้อมูลตัวอย่าง
src/
  index.ts             entry point
  app.ts               express app + middleware
  lib/                 prisma client, error handling, serializers (DB row → frontend shape)
  routes/              หนึ่งไฟล์ต่อ domain
```

## ตารางในฐานข้อมูล

ชื่อตาราง/คอลัมน์/enum ใน PostgreSQL เป็น snake_case ทั้งหมด (ในโค้ด Prisma เป็น camelCase แล้ว map ด้วย `@map`) —
ชื่อ path ของ API ยังตามชื่อฝั่ง frontend เพื่อไม่ให้ contract เปลี่ยน

| ตาราง | Prisma model | API | คืออะไร |
|---|---|---|---|
| `curriculum_versions` | `CurriculumVersion` | `/curriculum-versions` | หลักสูตร |
| `course_templates` | `CourseTemplate` | `/course-templates` | รายวิชาในหลักสูตร |
| `courses` | `Course` | `/courses` | รายวิชาที่เปิดสอน (section) |
| `teachers` | `Teacher` | `/managed-teachers` | อาจารย์ / TA |
| `course_teachers` | `CourseTeacher` | `/managed-teachers/:id/courses/:courseId` | อาจารย์ที่ assign ในแต่ละรายวิชา |
| `students` | `Student` | `/cohort-students` | นักศึกษา |
| `enrollments` | `Enrollment` | `/students`, `/courses/:courseId/students` | นักศึกษาในแต่ละรายวิชา (roster) |
| `grading_categories` | `GradingCategory` | `/grading-categories` | หมวดคะแนน |
| `assignments` | `Assignment` | `/assignments` | งาน |
| `rubrics` | `Rubric` | `/rubrics` | เกณฑ์ให้คะแนน (criteria เก็บเป็น JSON) |
| `submissions` | `Submission` | `/submissions` | งานที่นักศึกษาส่ง + คะแนน |
| `student_groups` | `StudentGroup` | `/student-groups` | ทีมของงานกลุ่ม |
| `files` | `StoredFile` | `/files` | ไฟล์ที่อัปโหลด |

`courses.term` เก็บเป็น `'1'` / `'2'` / `'3'` / `'summer'` ·
`enrollments.student_id`, `submissions.student_id`, `student_groups.member_student_ids` เก็บ**รหัสนักศึกษา** (เช่น `69070101`) เป็นข้อความ ไม่ใช่ FK — ตรงกับที่ frontend ใช้

## ยังไม่ได้ทำ

- **Auth** — API ยังไม่มีการยืนยันตัวตน ใครเรียกก็ได้ (frontend ยังไม่มี login จริง/ไม่มี token)
  ผลที่ตามมา: การซ่อนคะแนนก่อนอาจารย์ "ประกาศ" (`studentVisibleSubmission`) ยังทำแค่ฝั่ง frontend — ถ้าเรียก API ตรง ๆ จะเห็นคะแนนได้
- CLO, section roles, grading assignments ยังอยู่ใน localStorage ของ frontend — การ cascade ตอนลบอาจารย์/นักศึกษายังทำฝั่ง client
- ไฟล์ที่ไม่มีใครอ้างถึงแล้ว (เช่น ไฟล์ในงานที่ส่งของงานที่ถูกลบ) ยังไม่ถูกเก็บกวาดอัตโนมัติ
