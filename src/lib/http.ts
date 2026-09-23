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
      const target = meta?.target ?? constraint?.fields ?? constraint?.index ?? "field";
      res.status(409).json({ error: `Already exists (unique: ${Array.isArray(target) ? target.join(", ") : target})` });
      return;
    }
    if (err.code === "P2003") {
      res.status(400).json({ error: "Referenced record does not exist" });
      return;
    }
  }
  if (err?.type === "entity.parse.failed") {
    res.status(400).json({ error: "Invalid JSON body" });
    return;
  }
  console.error(err);
  res.status(500).json({ error: "Internal server error" });
};
