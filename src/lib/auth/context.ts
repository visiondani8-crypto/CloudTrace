import "server-only";
import { cache } from "react";
import { cookies, headers } from "next/headers";
import { redirect } from "next/navigation";
import { getServerSession } from "next-auth";
import { prisma } from "@/lib/db";
import { hasRole, isOneOf, ROLES, type Role } from "@/lib/domain/enums";
import { AppError } from "@/lib/domain/errors";
import { authOptions } from "./options";

export const ORG_COOKIE = "ct_org";

export interface MembershipSummary {
  organizationId: string;
  organizationName: string;
  organizationSlug: string;
  role: Role;
}

/** Server-verified identity and active organisation for the current request. */
export interface AuthContext {
  userId: string;
  userName: string;
  userEmail: string;
  organizationId: string;
  organizationName: string;
  organizationSlug: string;
  role: Role;
  memberships: MembershipSummary[];
}

/**
 * Resolves the session (verified JWT) and loads memberships from the database
 * on every request, so role changes take effect immediately. The active
 * organisation comes from a cookie but is only honoured if the user is a member.
 */
export const getAuthContext = cache(async (): Promise<AuthContext | null> => {
  const session = await getServerSession(authOptions);
  const userId = (session?.user as { id?: string } | undefined)?.id;
  if (!userId) return null;

  const user = await prisma.user.findUnique({
    where: { id: userId },
    include: { memberships: { include: { organization: true }, orderBy: { createdAt: "asc" } } },
  });
  if (!user || user.memberships.length === 0) return null;

  const memberships: MembershipSummary[] = user.memberships
    .filter((m) => isOneOf(ROLES, m.role))
    .map((m) => ({
      organizationId: m.organizationId,
      organizationName: m.organization.name,
      organizationSlug: m.organization.slug,
      role: m.role as Role,
    }));
  if (memberships.length === 0) return null;

  const requestedOrg = (await cookies()).get(ORG_COOKIE)?.value;
  const active = memberships.find((m) => m.organizationId === requestedOrg) ?? memberships[0];

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
});

/** For server components: redirects to sign-in when there is no valid session. */
export async function requirePageContext(): Promise<AuthContext> {
  const ctx = await getAuthContext();
  if (!ctx) {
    const h = await headers();
    const path = h.get("x-ct-pathname") ?? "/overview";
    redirect(`/login?returnTo=${encodeURIComponent(path)}`);
  }
  return ctx;
}

export function requireRole(ctx: AuthContext, minimum: Role, message?: string): void {
  if (!hasRole(ctx.role, minimum)) {
    throw new AppError(
      "FORBIDDEN",
      message ??
        (minimum === "OWNER"
          ? "Only workspace owners can perform this action."
          : "Your role allows viewing, not editing."),
    );
  }
}

export function can(ctx: Pick<AuthContext, "role">, minimum: Role): boolean {
  return hasRole(ctx.role, minimum);
}
