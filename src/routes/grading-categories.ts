import { Router } from "express";
import { z } from "zod";
import { prisma } from "../lib/prisma.js";
import { parse } from "../lib/http.js";
import { idOverride, toGradingCategory } from "../lib/content.js";

export const gradingCategoriesRouter = Router();

const fields = z.object({
  name: z.string().trim().min(1),
  weight: z.number().min(0).max(100),
});
export const categoryCreate = fields.extend({ ...idOverride, courseId: z.string().optional() }); // path wins
export const categoryUpdate = fields.partial();

gradingCategoriesRouter.get("/grading-categories", async (_req, res) => {
  const rows = await prisma.gradingCategory.findMany({ orderBy: { createdAt: "asc" } });
  res.json(rows.map(toGradingCategory));
});

gradingCategoriesRouter.get("/courses/:courseId/grading-categories", async (req, res) => {
  const rows = await prisma.gradingCategory.findMany({ where: { courseId: req.params.courseId }, orderBy: { createdAt: "asc" } });
  res.json(rows.map(toGradingCategory));
});

gradingCategoriesRouter.post("/courses/:courseId/grading-categories", async (req, res) => {
  const { courseId: _ignored, ...data } = parse(categoryCreate, req.body);
  const row = await prisma.gradingCategory.create({ data: { ...data, courseId: req.params.courseId } });
  res.status(201).json(toGradingCategory(row));
});

gradingCategoriesRouter.patch("/grading-categories/:id", async (req, res) => {
  const data = parse(categoryUpdate, req.body);
  const row = await prisma.gradingCategory.update({ where: { id: req.params.id }, data });
  res.json(toGradingCategory(row));
});

// Assignments in this category keep existing; their category_id is cleared (FK: SET NULL).
gradingCategoriesRouter.delete("/grading-categories/:id", async (req, res) => {
  await prisma.gradingCategory.delete({ where: { id: req.params.id } });
  res.status(204).end();
});
