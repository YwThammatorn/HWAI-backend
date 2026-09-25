# HWAI-backend
[KMITL Project] AI Agent Web Application Backend Section

Express 5 + Prisma 7 + PostgreSQL API สำหรับ [HWAI-frontend](../HWAI-frontend).
ตอนนี้รองรับเฉพาะหน้า **admin** (`/admin/users`, `/admin/courses`, `/admin/curriculum`) — หน้า teacher/student ยังใช้ localStorage เหมือนเดิม

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
| PATCH | `/cohort-students/:id` | partial | `CohortStudent` |
| DELETE | `/cohort-students/:id` | | 204 |

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

`courses.term` เก็บเป็น `'1'` / `'2'` / `'3'` / `'summer'`

## ยังไม่ได้ทำ

- **Auth** — API ยังไม่มีการยืนยันตัวตน ใครเรียกก็ได้ (frontend ยังไม่มี login จริง/ไม่มี token)
- Section roles / grading assignments ยังอยู่ใน localStorage ของ frontend — การ cascade ตอนลบอาจารย์/นักศึกษายังทำฝั่ง client
- Domain อื่น ๆ ของ teacher/student (assignments, submissions, rubrics ฯลฯ)
