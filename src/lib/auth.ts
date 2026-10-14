// Sign-in sessions and who the caller is.
//
// A session is a random token in an HttpOnly cookie; the database keeps only its SHA-256 (sessions.id).
// Each request turns the session's email into a Principal: an admin row, an active teacher row and/or an
// active student row with that email. Nothing here decides what the caller may do — that is lib/access.ts.
//
// Demo sign-in (POST /api/auth/demo-login) skips *authentication* only: it signs in as an existing,
// allow-listed account without a password, and the account gets exactly its normal permissions.
import { createHash, randomBytes } from "node:crypto";
import type { Request, RequestHandler, Response } from "express";
import { prisma } from "./prisma.js";
import { HttpError } from "./http.js";

export const SESSION_COOKIE = "hwai_session";
const SESSION_HOURS = 7 * 24; // real (Google) sign-in
const DEMO_SESSION_HOURS = 8;

export interface Principal {
  email: string;
  name: string;
  /** Signed in through demo sign-in. */
  demo: boolean;
  admin: boolean;
  teacher: { id: string; role: "teacher" | "ta"; name: string } | null;
  /** The student this account is. `ta`: they are a TA (section role) in at least one course. */
  student: { id: string; studentId: string; name: string; email: string; ta: boolean } | null;
}

declare module "express-serve-static-core" {
  interface Request {
    principal?: Principal;
  }
}

const isProduction = () => process.env.NODE_ENV === "production";

/** Demo sign-in is opt-in (DEMO_LOGIN=true) and never available in production. */
export function demoLoginEnabled() {
  return process.env.DEMO_LOGIN === "true" && !isProduction();
}

/** The accounts demo sign-in may use (DEMO_ACCOUNTS, comma-separated emails). */
export function demoAccounts() {
  return (process.env.DEMO_ACCOUNTS ?? "")
    .split(",")
    .map((e) => e.trim().toLowerCase())
    .filter(Boolean);
}

const hash = (token: string) => createHash("sha256").update(token).digest("hex");

/** Who `email` is, or null when no active account has it. */
export async function resolvePrincipal(email: string, demo: boolean): Promise<Principal | null> {
  const demoMode = demoLoginEnabled();
  const [admin, teacher, student] = await Promise.all([
    prisma.admin.findUnique({ where: { email } }),
    prisma.teacher.findUnique({ where: { email } }),
    prisma.student.findUnique({ where: { email } }),
  ]);
  const isAdmin = !!admin && (!admin.demo || demoMode);
  const activeTeacher = teacher?.status === "active" ? teacher : null;
  const activeStudent = student?.status === "active" ? student : null;
  if (!isAdmin && !activeTeacher && !activeStudent) return null;
  const studentName = activeStudent ? `${activeStudent.firstName} ${activeStudent.lastName}` : "";
  const studentTa = activeStudent ? (await prisma.sectionRole.count({ where: { studentId: activeStudent.id } })) > 0 : false;
  return {
    email,
    name: activeTeacher?.name ?? admin?.name ?? studentName,
    demo,
    admin: isAdmin,
    teacher: activeTeacher && { id: activeTeacher.id, role: activeTeacher.role, name: activeTeacher.name },
    student: activeStudent && {
      id: activeStudent.id,
      studentId: activeStudent.studentId,
      name: studentName,
      email: activeStudent.email,
      ta: studentTa,
    },
  };
}

function cookieOptions(maxAgeMs?: number) {
  return {
    httpOnly: true,
    secure: isProduction(),
    sameSite: "lax" as const,
    path: "/",
    ...(maxAgeMs !== undefined && { maxAge: maxAgeMs }),
  };
}

/** Starts a session for `email` and sets its cookie. */
export async function startSession(res: Response, email: string, demo: boolean) {
  const token = randomBytes(32).toString("base64url");
  const hours = demo ? DEMO_SESSION_HOURS : SESSION_HOURS;
  const expiresAt = new Date(Date.now() + hours * 3600_000);
  await prisma.session.create({ data: { id: hash(token), email, demo, expiresAt } });
  res.cookie(SESSION_COOKIE, token, cookieOptions(hours * 3600_000));
}

function readCookie(req: Request, name: string): string | undefined {
  for (const part of (req.headers.cookie ?? "").split(";")) {
    const i = part.indexOf("=");
    if (i > 0 && part.slice(0, i).trim() === name) return decodeURIComponent(part.slice(i + 1).trim());
  }
  return undefined;
}

export async function endSession(req: Request, res: Response) {
  const token = readCookie(req, SESSION_COOKIE);
  if (token) await prisma.session.deleteMany({ where: { id: hash(token) } });
  res.clearCookie(SESSION_COOKIE, cookieOptions());
}

/** Sets req.principal when the request carries a live session (and its account still exists). */
export const loadPrincipal: RequestHandler = async (req, res, next) => {
  const token = readCookie(req, SESSION_COOKIE);
  if (!token) return next();
  const session = await prisma.session.findUnique({ where: { id: hash(token) } });
  const expired = !session || session.expiresAt <= new Date();
  // A demo session dies the moment demo sign-in is switched off.
  if (expired || (session.demo && !demoLoginEnabled())) {
    if (session) await prisma.session.delete({ where: { id: session.id } }).catch(() => {});
    res.clearCookie(SESSION_COOKIE, cookieOptions());
    return next();
  }
  const principal = await resolvePrincipal(session.email, session.demo);
  if (!principal) {
    // The account was removed or deactivated after signing in.
    await prisma.session.delete({ where: { id: session.id } }).catch(() => {});
    res.clearCookie(SESSION_COOKIE, cookieOptions());
    return next();
  }
  req.principal = principal;
  if (Date.now() - session.lastSeenAt.getTime() > 5 * 60_000) {
    await prisma.session.update({ where: { id: session.id }, data: { lastSeenAt: new Date() } }).catch(() => {});
  }
  next();
};

/** 401 for any request without a signed-in caller. */
export const requireSignIn: RequestHandler = (req, _res, next) => {
  if (!req.principal) throw new HttpError(401, "Sign in first");
  next();
};

/** The signed-in caller (only after requireSignIn). */
export function principalOf(req: Request): Principal {
  if (!req.principal) throw new HttpError(401, "Sign in first");
  return req.principal;
}

/**
 * Cookies ride along on any request to the API, so a state-changing request must come from one of
 * the frontend's origins (when the browser says where it comes from). Blocks cross-site form posts.
 */
export function originGuard(origins: string[]): RequestHandler {
  return (req, _res, next) => {
    if (["GET", "HEAD", "OPTIONS"].includes(req.method)) return next();
    const origin = req.get("origin");
    const sameOrigin = origin === `${req.protocol}://${req.get("host")}`; // Swagger UI at /docs
    if (origin && !sameOrigin && !origins.includes(origin)) throw new HttpError(403, "Request from an unknown origin");
    next();
  };
}

/** What GET /api/auth/me returns — the frontend builds its AuthUser from it. */
export function toMe(p: Principal) {
  const roles: ("admin" | "teacher" | "ta" | "student")[] = [];
  if (p.admin) roles.push("admin");
  if (p.teacher) roles.push(p.teacher.role);
  if (p.student) roles.push("student");
  // A student who assists in a course also gets the TA role (the TA pages); what they may do there
  // is still decided per course by their section role.
  if (p.student?.ta && !roles.includes("ta")) roles.push("ta");
  return {
    email: p.email,
    name: p.name,
    demo: p.demo,
    roles,
    defaultRole: p.teacher?.role ?? (p.admin ? "admin" : "student"),
    teacher: p.teacher,
    student: p.student,
  };
}
