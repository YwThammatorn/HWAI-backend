// Uploaded files, stored in PostgreSQL (table `files`). Used by assignment attachments, submissions
// and teaching materials: their `ref` is the file id when `source` is "upload".
//
// Upload: POST /api/files with the raw file as the body, its type in Content-Type and its name
// (URI-encoded) in X-File-Name. Returns { id, name, mimeType, size }.
import express, { Router } from "express";
import { prisma } from "../lib/prisma.js";
import { HttpError } from "../lib/http.js";

export const MAX_FILE_BYTES = 10 * 1024 * 1024;

export const filesRouter = Router();

filesRouter.post(
  "/files",
  express.raw({ type: () => true, limit: MAX_FILE_BYTES }),
  async (req, res) => {
    const data = req.body;
    if (!Buffer.isBuffer(data) || data.length === 0) throw new HttpError(400, "Send the file as the request body");
    let name = "file";
    try {
      name = decodeURIComponent(req.get("x-file-name") ?? "") || name;
    } catch {
      throw new HttpError(400, "X-File-Name must be URI-encoded");
    }
    const mimeType = req.get("content-type")?.split(";")[0].trim() || "application/octet-stream";
    const row = await prisma.storedFile.create({
      data: { name, mimeType, size: data.length, data: new Uint8Array(data) },
      select: { id: true, name: true, mimeType: true, size: true },
    });
    res.status(201).json(row);
  },
);

// Only types that can't run script open in the browser (images, PDFs); anything else — HTML, SVG,
// unknown — is served as a download, and every response is sandboxed, so an uploaded file can never
// execute on the API's origin.
const INLINE_TYPES = /^(image\/(png|jpe?g|gif|webp|avif|bmp)|application\/pdf)$/i;

filesRouter.get("/files/:id", async (req, res) => {
  const file = await prisma.storedFile.findUniqueOrThrow({ where: { id: req.params.id } });
  const disposition = INLINE_TYPES.test(file.mimeType) ? "inline" : "attachment";
  res.set({
    "Content-Type": file.mimeType,
    "Content-Length": String(file.size),
    "Content-Disposition": `${disposition}; filename*=UTF-8''${encodeURIComponent(file.name)}`,
    "Content-Security-Policy": "sandbox",
    "X-Content-Type-Options": "nosniff",
    "Cache-Control": "private, max-age=31536000, immutable", // a file id's content never changes
  });
  res.end(Buffer.from(file.data));
});

// Idempotent: deleting a file that is already gone is fine (the frontend frees files best-effort).
filesRouter.delete("/files/:id", async (req, res) => {
  await prisma.storedFile.deleteMany({ where: { id: req.params.id } });
  res.status(204).end();
});
