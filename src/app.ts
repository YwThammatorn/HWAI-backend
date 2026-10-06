import express from "express";
import cors from "cors";
import swaggerUi from "swagger-ui-express";
import { openapiSpec } from "./openapi.js";
import { errorHandler } from "./lib/http.js";
import { curriculumRouter } from "./routes/curriculum.js";
import { coursesRouter } from "./routes/courses.js";
import { managedTeachersRouter } from "./routes/managed-teachers.js";
import { cohortStudentsRouter } from "./routes/cohort-students.js";
import { enrollmentsRouter } from "./routes/enrollments.js";
import { gradingCategoriesRouter } from "./routes/grading-categories.js";
import { assignmentsRouter } from "./routes/assignments.js";
import { studentGroupsRouter } from "./routes/student-groups.js";
import { courseStaffRouter } from "./routes/course-staff.js";
import { filesRouter } from "./routes/files.js";

export function createApp() {
  const app = express();

  const origins = (process.env.CORS_ORIGIN ?? "http://localhost:3000").split(",").map((o) => o.trim());
  app.use(cors({ origin: origins }));
  // Before express.json(): an upload's body is the raw file, whatever its Content-Type (even JSON).
  app.use("/api", filesRouter);
  app.use(express.json({ limit: "5mb" })); // CSV imports post whole arrays

  app.get("/api/health", (_req, res) => {
    res.json({ ok: true });
  });

  // API playground: Swagger UI at /docs, raw spec at /openapi.json
  app.get("/openapi.json", (_req, res) => {
    res.json(openapiSpec);
  });
  app.use("/docs", swaggerUi.serve, swaggerUi.setup(openapiSpec, { customSiteTitle: "HWAI API" }));
  app.get("/", (_req, res) => {
    res.redirect("/docs");
  });

  app.use("/api", curriculumRouter, coursesRouter, managedTeachersRouter, cohortStudentsRouter);
  app.use(
    "/api",
    enrollmentsRouter,
    gradingCategoriesRouter,
    assignmentsRouter,
    studentGroupsRouter,
    courseStaffRouter,
  );

  app.use("/api", (_req, res) => {
    res.status(404).json({ error: "Not found" });
  });
  app.use(errorHandler);

  return app;
}
