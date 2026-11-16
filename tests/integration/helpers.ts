import { PrismaClient } from "@prisma/client";
import type { AuthContext } from "@/lib/auth/context";
import { AppError } from "@/lib/domain/errors";
import { seedDatabase } from "../../prisma/seed";

export const TEST_PASSWORD = "integration-test-password-123";
export const db = new PrismaClient();

let seeded: Promise<unknown> | null = null;
export function ensureSeeded() {
  seeded ??= seedDatabase(db, TEST_PASSWORD);
  return seeded;
}

/** Builds a server-verified context the way getAuthContext() does, from real memberships. */
export async function contextFor(email: string, orgSlug?: string): Promise<AuthContext> {
  const user = await db.user.findUniqueOrThrow({
    where: { email },
    include: { memberships: { include: { organization: true } } },
  });
  const memberships = user.memberships.map((m) => ({
    organizationId: m.organizationId,
    organizationName: m.organization.name,
    organizationSlug: m.organization.slug,
    role: m.role as AuthContext["role"],
  }));
  const active = memberships.find((m) => !orgSlug || m.organizationSlug === orgSlug)!;
  return {
    userId: user.id,
    userName: user.name,
    userEmail: user.email,
    organizationId: active.organizationId,
    organizationName: active.organizationName,
    organizationSlug: active.organizationSlug,
    role: active.role,
    memberships,
  };
}

export async function expectAppError(promise: Promise<unknown>, code: AppError["code"]) {
  try {
    await promise;
  } catch (error) {
    if (error instanceof AppError && error.code === code) return error;
    throw new Error(`Expected AppError ${code}, got ${error instanceof Error ? `${error.name}: ${error.message}` : String(error)}`);
  }
  throw new Error(`Expected AppError ${code}, but the call succeeded`);
}

export async function incidentId(organizationSlug: string, caseNumber: string) {
  const org = await db.organization.findUniqueOrThrow({ where: { slug: organizationSlug } });
  const incident = await db.incident.findUniqueOrThrow({ where: { organizationId_caseNumber: { organizationId: org.id, caseNumber } } });
  return incident.id;
}

export const NORTHSTAR = "northstar-demo";
export const HARBOR = "harbor-isolation-test";
