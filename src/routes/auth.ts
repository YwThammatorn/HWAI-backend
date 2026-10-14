// Sign-in endpoints. Real sign-in is Google, for @kmitl.ac.th accounts (POST /auth/google, on when
// GOOGLE_CLIENT_ID is set). Demo sign-in (POST /auth/demo-login) is off unless DEMO_LOGIN=true.
import express, { Router } from "express";
import { z } from "zod";
import { OAuth2Client, type TokenPayload } from "google-auth-library";
import { HttpError, parse } from "../lib/http.js";
import {
  demoAccounts,
  demoLoginEnabled,
  endSession,
  principalOf,
  resolvePrincipal,
  startSession,
  toMe,
} from "../lib/auth.js";

export const authRouter = Router();
authRouter.use("/auth", express.json());

/** Only accounts of this Google Workspace domain may sign in. */
export const GOOGLE_DOMAIN = "kmitl.ac.th";
const googleClientId = () => process.env.GOOGLE_CLIENT_ID?.trim() || undefined;
const google = new OAuth2Client();

// Public: what the login page should offer.
authRouter.get("/auth/config", (_req, res) => {
  const clientId = googleClientId();
  res.json({
    demoLogin: demoLoginEnabled(),
    demoAccounts: demoLoginEnabled() ? demoAccounts() : [],
    google: !!clientId,
    ...(clientId && { googleClientId: clientId, googleDomain: GOOGLE_DOMAIN }),
  });
});

export const googleLoginBody = z.object({ credential: z.string().min(1) });

// The login page's "Sign in with Google" button hands us Google's ID token. Everything is checked
// here, never trusted from the browser: Google's signature and expiry, that it was issued to our
// client (aud), a verified email, and the KMITL Workspace domain (hd). Then the email must belong to
// an existing, active account — nobody registers themselves.
authRouter.post("/auth/google", async (req, res) => {
  const clientId = googleClientId();
  if (!clientId) throw new HttpError(404, "Not found");
  const { credential } = parse(googleLoginBody, req.body);
  let payload: TokenPayload | undefined;
  try {
    payload = (await google.verifyIdToken({ idToken: credential, audience: clientId })).getPayload();
  } catch {
    throw new HttpError(401, "Google sign-in failed — try again");
  }
  const email = payload?.email?.toLowerCase();
  if (!payload || !email || payload.email_verified !== true) throw new HttpError(401, "Google didn't confirm this email");
  if (payload.hd !== GOOGLE_DOMAIN || !email.endsWith(`@${GOOGLE_DOMAIN}`)) {
    throw new HttpError(403, `Sign in with your @${GOOGLE_DOMAIN} account`);
  }
  const principal = await resolvePrincipal(email, false);
  if (!principal) throw new HttpError(403, `${email} has no active account in HWAI — ask an admin to add you`);
  await startSession(res, email, false);
  res.json(toMe(principal));
});

export const demoLoginBody = z.object({ email: z.string().trim().toLowerCase().email() });

// Signs in as an allow-listed account without a password. Skips authentication only — the session
// gets that account's normal permissions, nothing more.
authRouter.post("/auth/demo-login", async (req, res) => {
  if (!demoLoginEnabled()) throw new HttpError(404, "Not found");
  const { email } = parse(demoLoginBody, req.body);
  if (!demoAccounts().includes(email)) throw new HttpError(403, "This account can't use demo sign-in");
  const principal = await resolvePrincipal(email, true);
  if (!principal) throw new HttpError(403, "No active account with this email");
  await startSession(res, email, true);
  console.warn(`[auth] demo sign-in as ${email} from ${req.ip} at ${new Date().toISOString()}`);
  res.json(toMe(principal));
});

authRouter.post("/auth/logout", async (req, res) => {
  await endSession(req, res);
  res.status(204).end();
});

authRouter.get("/auth/me", (req, res) => {
  res.json(toMe(principalOf(req)));
});
