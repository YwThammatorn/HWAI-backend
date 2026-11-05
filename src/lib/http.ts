import type { ErrorRequestHandler } from "express";
import { z } from "zod";
import { Prisma } from "../generated/prisma/client.js";

export class HttpError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}

/** Parse `data` with `schema`, throwing a 400 HttpError listing every issue on failure. */
export function parse<S extends z.ZodType>(schema: S, data: unknown): z.infer<S> {
  const result = schema.safeParse(data);
  if (!result.success) {
    const detail = result.error.issues.map((i) => `${i.path.join(".") || "body"}: ${i.message}`).join("; ");
    throw new HttpError(400, detail);
  }
  return result.data;
}

/** A readable 409 for each unique rule people can actually run into (by index name). */
const UNIQUE_MESSAGES: Record<string, string> = {
  curriculum_versions_program_effective_from_key: "This program already has a curriculum version starting that year",
  course_templates_version_code_key: "This curriculum already has a course with that code",
  courses_active_section_key:
    "An active section with this subject, academic year, term and section number already exists",
  enrollments_course_id_student_id_key: "This student is already on this course's roster",
  enrollments_course_id_sequence_number_key: "That number is already taken on this course's roster",
  students_student_id_key: "A student with this student ID already exists",
  students_email_key: "A student with this email already exists",
  teachers_email_key: "A teacher with this email already exists",
  submissions_assignment_id_student_id_key: "This student has already handed in this assignment",
};

/** A readable 400 for each CHECK constraint (the routes validate the same rules first). */
const CHECK_MESSAGES: Record<string, string> = {
  grading_categories_weight_check: "A category's weight must be more than 0 and at most 100",
  assignments_max_points_check: "Max points must be more than 0",
  assignments_max_group_size_check: "A team size must be between 2 and 20",
  curriculum_versions_effective_range_check: "A curriculum version can't end before it starts",
  submissions_scores_check: "A score can't be negative",
  students_email_lower_check: "Emails are stored in lower case",
  teachers_email_lower_check: "Emails are stored in lower case",
  admins_email_lower_check: "Emails are stored in lower case",
};

type AdapterCause = {
  originalCode?: string;
  originalMessage?: string;
  constraint?: { fields?: string[]; index?: string };
};

/**
 * The frontend's ApiError uses the raw response body as its message, so errors are sent as
 * `{ error }` JSON — readable both as text and as JSON.
 */
export const errorHandler: ErrorRequestHandler = (err, _req, res, _next) => {
  if (err instanceof HttpError) {
    res.status(err.status).json({ error: err.message });
    return;
  }
  if (err instanceof Prisma.PrismaClientKnownRequestError) {
    if (err.code === "P2025") {
      res.status(404).json({ error: "Not found" });
      return;
    }
    if (err.code === "P2002") {
      // Driver adapters report the columns under driverAdapterError, the classic engine under target.
      const meta = err.meta as
        | {
            target?: string[] | string;
            driverAdapterError?: { cause?: { constraint?: { fields?: string[]; index?: string } } };
          }
        | undefined;
      const constraint = meta?.driverAdapterError?.cause?.constraint;
      const known = constraint?.index && UNIQUE_MESSAGES[constraint.index];
      const target = meta?.target ?? constraint?.fields ?? constraint?.index ?? "field";
      res.status(409).json({ error: known || `Already exists (unique: ${Array.isArray(target) ? target.join(", ") : target})` });
      return;
    }
    // A CHECK constraint (Postgres 23514) — reported by the driver adapter, not as its own Prisma code.
    const cause = (err.meta as { driverAdapterError?: { cause?: AdapterCause } } | undefined)?.driverAdapterError?.cause;
    if (cause?.originalCode === "23514") {
      const name = cause.originalMessage?.match(/check constraint "([^"]+)"/)?.[1];
      res.status(400).json({ error: (name && CHECK_MESSAGES[name]) || "A value breaks a rule of this record" });
      return;
    }
    if (err.code === "P2003") {
      res.status(400).json({ error: "Referenced record does not exist" });
      return;
    }
  }
  if (err?.type === "entity.too.large") {
    res.status(413).json({ error: `Too large (limit ${Math.round(err.limit / 1024 / 1024)} MB)` });
    return;
  }
  if (err?.type === "entity.parse.failed") {
    res.status(400).json({ error: "Invalid JSON body" });
    return;
  }
  console.error(err);
  res.status(500).json({ error: "Internal server error" });
};
