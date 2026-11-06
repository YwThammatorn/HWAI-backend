// Accounts: a users row (email, title, name, status — shared by everyone) plus what the person is — an
// admin, a teacher, a student (subtype rows keyed by user_id). The admin pages create and remove teachers and
// students; these helpers keep the user row and the subtypes in step.
import type { Prisma } from "../generated/prisma/client.js";
import { HttpError } from "./http.js";

type Tx = Prisma.TransactionClient;
export type Kind = "teacher" | "student";

/** The users columns of a teacher's / student's fields. */
export const USER_FIELDS = ["title", "name", "email", "status"] as const;

/** Splits API fields into the users row's and the subtype's. */
export function splitUserFields<T extends Record<string, unknown>>(data: T) {
  const user: Record<string, unknown> = {};
  const rest: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(data)) {
    if (v === undefined) continue;
    ((USER_FIELDS as readonly string[]).includes(k) ? user : rest)[k] = v;
  }
  return { user, rest };
}

/**
 * The user who becomes a teacher / student. A new email makes a new user (with the client's id when given).
 * An email that is already a user — say, an admin who now teaches — gets the new subtype on that user, whose
 * own name / title / status stay as they are. 409 when they already are one, or would be both teacher and
 * student (a teacher is never also a student).
 */
export async function userFor(
  tx: Tx,
  kind: Kind,
  data: { id?: string; email: string; title?: string | null; name: string; status?: "active" | "inactive" },
): Promise<string> {
  const existing = await tx.user.findUnique({
    where: { email: data.email },
    select: { id: true, teacher: { select: { userId: true } }, student: { select: { userId: true } } },
  });
  if (!existing) {
    const user = await tx.user.create({
      data: {
        ...(data.id && { id: data.id }),
        email: data.email,
        title: data.title ?? null,
        name: data.name,
        ...(data.status && { status: data.status }),
      },
      select: { id: true },
    });
    return user.id;
  }
  if (existing[kind]) throw new HttpError(409, `A ${kind} with this email already exists`);
  const other = kind === "teacher" ? "student" : "teacher";
  if (existing[other]) throw new HttpError(409, `This email belongs to a ${other} — a teacher is never also a student`);
  return existing.id;
}

/**
 * Takes away being a teacher / student: the subtype row goes (the database then drops what hangs off it —
 * course assignments for a teacher; rosters, submissions and teams for a student), and so do section roles
 * that only that kind can hold (a TA is a student; a co-teacher / teacher is a teacher). A user who is then
 * nothing at all is deleted too (and signed out).
 */
export async function removeKind(tx: Tx, kind: Kind, userId: string) {
  if (kind === "teacher") {
    await tx.teacher.delete({ where: { userId } });
    await tx.sectionRole.deleteMany({ where: { userId, role: { in: ["teacher", "coTeacher"] } } });
  } else {
    await tx.student.delete({ where: { userId } });
    await tx.sectionRole.deleteMany({ where: { userId, role: "ta" } });
  }
  const left = await tx.user.findUnique({
    where: { id: userId },
    select: { admin: { select: { userId: true } }, teacher: { select: { userId: true } }, student: { select: { userId: true } } },
  });
  if (left && !left.admin && !left.teacher && !left.student) await tx.user.delete({ where: { id: userId } });
}
