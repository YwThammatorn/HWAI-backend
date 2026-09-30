// Teams for group assignments (HWAI-frontend/src/lib/studentGroups.ts).
import { Router } from "express";
import { z } from "zod";
import { prisma } from "../lib/prisma.js";
import { HttpError, parse } from "../lib/http.js";
import { idOverride, toStudentGroup } from "../lib/content.js";

export const studentGroupsRouter = Router();

const members = z.array(z.string().trim().min(1)).transform((ids) => [...new Set(ids)]);
export const groupCreate = z.object({
  ...idOverride,
  assignmentId: z.string().optional(), // the path's assignmentId wins
  courseId: z.string().optional(), // taken from the assignment
  name: z.string().trim().min(1),
  memberStudentIds: members,
});
// Exactly what the frontend's updateGroup() may change.
export const groupUpdate = z.object({ name: z.string().trim().min(1), memberStudentIds: members }).partial();

studentGroupsRouter.get("/student-groups", async (_req, res) => {
  const rows = await prisma.studentGroup.findMany({ orderBy: { createdAt: "asc" } });
  res.json(rows.map(toStudentGroup));
});

studentGroupsRouter.get("/assignments/:id/groups", async (req, res) => {
  const rows = await prisma.studentGroup.findMany({ where: { assignmentId: req.params.id }, orderBy: { createdAt: "asc" } });
  res.json(rows.map(toStudentGroup));
});

studentGroupsRouter.post("/assignments/:id/groups", async (req, res) => {
  const { assignmentId: _a, courseId: _c, ...data } = parse(groupCreate, req.body);
  const assignment = await prisma.assignment.findUnique({ where: { id: req.params.id }, select: { courseId: true, submissionType: true, maxGroupSize: true } });
  if (!assignment) throw new HttpError(404, "Assignment not found");
  if (assignment.submissionType !== "group") throw new HttpError(400, "Not a group assignment");
  if (assignment.maxGroupSize !== null && data.memberStudentIds.length > assignment.maxGroupSize) {
    throw new HttpError(400, `A team can have at most ${assignment.maxGroupSize} members`);
  }
  const row = await prisma.studentGroup.create({ data: { ...data, assignmentId: req.params.id, courseId: assignment.courseId } });
  res.status(201).json(toStudentGroup(row));
});

studentGroupsRouter.patch("/student-groups/:id", async (req, res) => {
  const data = parse(groupUpdate, req.body);
  const row = await prisma.studentGroup.update({ where: { id: req.params.id }, data });
  res.json(toStudentGroup(row));
});

// Members' submissions keep their group_id (grading still groups them by team).
studentGroupsRouter.delete("/student-groups/:id", async (req, res) => {
  await prisma.studentGroup.delete({ where: { id: req.params.id } });
  res.status(204).end();
});
