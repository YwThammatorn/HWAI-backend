-- Sign-in: admins (a demo admin counts only while demo sign-in is on), sessions (hashes of the cookie
-- tokens), unique student emails (sign-in finds students by email) and who uploaded each file.
-- Adds only — no existing rows change.

-- AlterTable
ALTER TABLE "files" ADD COLUMN     "uploaded_by" TEXT;

-- CreateTable
CREATE TABLE "admins" (
    "id" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "demo" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "admins_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "sessions" (
    "id" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "demo" BOOLEAN NOT NULL DEFAULT false,
    "expires_at" TIMESTAMP(3) NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "last_seen_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "sessions_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "admins_email_key" ON "admins"("email");

-- CreateIndex
CREATE INDEX "sessions_email_idx" ON "sessions"("email");

-- CreateIndex
CREATE UNIQUE INDEX "students_email_key" ON "students"("email");

