import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "../generated/prisma/client.js";

const url = process.env.DATABASE_URL;
// `?schema=` picks the Postgres schema, as it does for the Prisma CLI (migrate); node-postgres ignores the
// parameter, so the adapter is told explicitly. Without it, Prisma's default (public).
const schema = url ? (new URL(url).searchParams.get("schema") ?? undefined) : undefined;
const adapter = new PrismaPg({ connectionString: url }, schema ? { schema } : undefined);

export const prisma = new PrismaClient({ adapter });
