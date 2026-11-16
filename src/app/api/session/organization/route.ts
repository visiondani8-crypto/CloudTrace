import { NextResponse } from "next/server";
import { readJson, withAuth } from "@/lib/api";
import { ORG_COOKIE } from "@/lib/auth/context";
import { SESSION_MAX_AGE_SECONDS } from "@/lib/auth/options";
import { recordOrgSwitch } from "@/lib/services/workspace";
import { switchOrgSchema } from "@/lib/validation/schemas";

/** Selects the active workspace. Only organisations the user belongs to are accepted. */
export const POST = withAuth(async (req, { auth }) => {
  const { organizationId } = switchOrgSchema.parse(await readJson(req));
  const membership = await recordOrgSwitch(auth, organizationId);
  const res = NextResponse.json({ organizationId, name: membership.organizationName });
  res.cookies.set(ORG_COOKIE, organizationId, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production" && (process.env.NEXTAUTH_URL ?? "").startsWith("https://"),
    path: "/",
    maxAge: SESSION_MAX_AGE_SECONDS,
  });
  return res;
});
