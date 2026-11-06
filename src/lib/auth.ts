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
  /** users.id — also the teacher's / student's id when they are one. */
  userId: string;
  email: string;
  name: string;
  /** Signed in through demo sign-in. */
  demo: boolean;
  admin: boolean;
  teacher: { id: string; name: string } | null;
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

/**
 * Who the user with this email (or id) is: one users row, then what they are — admin / teacher / student.
 * Null when there is no such user, they are inactive (users.status: may they sign in at all), or they are
 * nothing that can sign in (e.g. only a demo admin while demo sign-in is off).
 */
export async function resolvePrincipal(by: { email: string } | { id: string }, demo: boolean): Promise<Principal | null> {
  const user = await prisma.user.findUnique({ where: by, include: { admin: true, teacher: true, student: true } });
  if (!user || user.status !== "active") return null;
  const isAdmin = !!user.admin && (!user.admin.demo || demoLoginEnabled());
  if (!isAdmin && !user.teacher && !user.student) return null;
  const ta = user.student ? (await prisma.sectionRole.count({ where: { userId: user.id, role: "ta" } })) > 0 : false;
  return {
    userId: user.id,
    email: user.email,
    name: user.name,
    demo,
    admin: isAdmin,
    teacher: user.teacher && { id: user.id, name: user.name },
    student: user.student && { id: user.id, studentId: user.student.studentId, name: user.name, email: user.email, ta },
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

/** Starts a session for the user and sets its cookie. */
export async function startSession(res: Response, userId: string, demo: boolean) {
  const token = randomBytes(32).toString("base64url");
  const hours = demo ? DEMO_SESSION_HOURS : SESSION_HOURS;
  const expiresAt = new Date(Date.now() + hours * 3600_000);
  // Sweep sessions that have run out (indexed by expires_at) — signing in is rare enough to pay for it.
  await prisma.session.deleteMany({ where: { expiresAt: { lt: new Date() } } });
  await prisma.session.create({ data: { id: hash(token), userId, demo, expiresAt } });
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
  const principal = await resolvePrincipal({ id: session.userId }, session.demo);
  if (!principal) {
    // The account was removed or deactivated after signing in.
    await prisma.session.delete({ where: { id: session.id } }).catch(() => {});
    res.clearCookie(SESSION_COOKIE, cookieOptions());
    return next();
  }
  req.principal = principal;
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
  if (p.teacher) roles.push("teacher");
  if (p.student) roles.push("student");
  // A student who assists in a course also gets the TA role (the TA pages); what they may do there
  // is still decided per course by their section role.
  if (p.student?.ta && !roles.includes("ta")) roles.push("ta");
  return {
    email: p.email,
    name: p.name,
    demo: p.demo,
    roles,
    defaultRole: p.teacher ? "teacher" : p.admin ? "admin" : "student",
    teacher: p.teacher,
    student: p.student,
  };
}
