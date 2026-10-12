// Sign-in endpoints. Real sign-in will be Google (accounts @kmitl.ac.th) — added once there is a
// Client ID. Until then the only way in is demo sign-in, which is off unless DEMO_LOGIN=true.
import express, { Router } from "express";
import { z } from "zod";
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

// Public: what the login page should offer.
authRouter.get("/auth/config", (_req, res) => {
  res.json({ demoLogin: demoLoginEnabled(), demoAccounts: demoLoginEnabled() ? demoAccounts() : [], google: false });
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
