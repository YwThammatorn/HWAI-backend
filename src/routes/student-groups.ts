// Teams for group assignments (HWAI-frontend/src/lib/studentGroups.ts).
import { Router } from "express";
import { z } from "zod";
import { prisma } from "../lib/prisma.js";
import { HttpError, parse } from "../lib/http.js";
import { idOverride, toStudentGroup } from "../lib/content.js";
import { courseFilter, courseOfAssignment, requireMember, visibleCourses } from "../lib/access.js";
import { principalOf } from "../lib/auth.js";

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

// Members of a course see its teams (a student picks teammates who aren't taken yet). Staff manage any
// team; a student forms a team they're on, from classmates enrolled in the course and not on another
// team for the assignment, and may change or delete only a team they're on.

/** Checks a student's team change: they stay on it (unless leaving), members are enrolled and free. */
async function assertStudentTeam(
  me: string,
  courseId: string,
  assignmentId: string,
  members: string[],
  opts: { groupId?: string; leaving?: boolean },
) {
  if (!opts.leaving && !members.includes(me)) throw new HttpError(403, "You can only form a team you're on");
  const enrolled = await prisma.enrollment.findMany({
    where: { courseId, studentId: { in: members }, OR: [{ enrollmentStatus: null }, { enrollmentStatus: { not: "withdrawn" } }] },
    select: { studentId: true },
  });
  const ok = new Set(enrolled.map((e) => e.studentId));
  const outsiders = members.filter((id) => !ok.has(id));
  if (outsiders.length > 0) throw new HttpError(400, `Not enrolled in this course: ${outsiders.join(", ")}`);
  const taken = await prisma.studentGroup.findMany({
    where: { assignmentId, memberStudentIds: { hasSome: members }, ...(opts.groupId && { id: { not: opts.groupId } }) },
    select: { memberStudentIds: true },
  });
  const busy = members.filter((id) => taken.some((g) => g.memberStudentIds.includes(id)));
  if (busy.length > 0) throw new HttpError(409, `Already on another team: ${busy.join(", ")}`);
}

async function findGroup(id: string) {
  const g = await prisma.studentGroup.findUnique({ where: { id } });
  if (!g) throw new HttpError(404, "Team not found");
  return g;
}

studentGroupsRouter.get("/student-groups", async (req, res) => {
  const courseId = courseFilter(await visibleCourses(principalOf(req)));
  const rows = await prisma.studentGroup.findMany({ where: courseId && { courseId }, orderBy: { createdAt: "asc" } });
  res.json(rows.map(toStudentGroup));
});

studentGroupsRouter.get("/assignments/:id/groups", async (req, res) => {
  await requireMember(req, await courseOfAssignment(req.params.id));
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
  const access = await requireMember(req, assignment.courseId);
  if (!access.staff) {
    await assertStudentTeam(principalOf(req).student!.studentId, assignment.courseId, req.params.id, data.memberStudentIds, {});
  }
  const row = await prisma.studentGroup.create({ data: { ...data, assignmentId: req.params.id, courseId: assignment.courseId } });
  res.status(201).json(toStudentGroup(row));
});

studentGroupsRouter.patch("/student-groups/:id", async (req, res) => {
  const data = parse(groupUpdate, req.body);
  const group = await findGroup(req.params.id);
  const access = await requireMember(req, group.courseId);
  if (!access.staff) {
    const me = principalOf(req).student!.studentId;
    if (!group.memberStudentIds.includes(me)) throw new HttpError(403, "You're not on this team");
    if (data.memberStudentIds) {
      const leaving = !data.memberStudentIds.includes(me);
      // Leaving takes only yourself off — nobody else changes.
      if (leaving && data.memberStudentIds.some((id) => !group.memberStudentIds.includes(id) || id === me)) {
        throw new HttpError(403, "Leaving a team only removes you");
      }
      if (leaving && data.memberStudentIds.length !== group.memberStudentIds.length - 1) {
        throw new HttpError(403, "Leaving a team only removes you");
      }
      // Otherwise members can only be added — nobody takes a teammate off.
      if (!leaving && group.memberStudentIds.some((id) => !data.memberStudentIds!.includes(id))) {
        throw new HttpError(403, "Only staff can remove a teammate");
      }
      await assertStudentTeam(me, group.courseId, group.assignmentId, data.memberStudentIds, { groupId: group.id, leaving });
    }
  }
  const row = await prisma.studentGroup.update({ where: { id: req.params.id }, data });
  res.json(toStudentGroup(row));
});

// Members' submissions keep their group_id (grading still groups them by team).
studentGroupsRouter.delete("/student-groups/:id", async (req, res) => {
  const group = await findGroup(req.params.id);
  const access = await requireMember(req, group.courseId);
  // A student deletes a team only by being its last member to leave.
  const me = access.staff ? null : principalOf(req).student!.studentId;
  if (me !== null && (group.memberStudentIds.length !== 1 || group.memberStudentIds[0] !== me)) {
    throw new HttpError(403, "Only a team's last member can delete it");
  }
  await prisma.studentGroup.delete({ where: { id: req.params.id } });
  res.status(204).end();
});
