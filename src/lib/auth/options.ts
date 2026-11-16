import "server-only";
import type { NextAuthOptions } from "next-auth";
import CredentialsProvider from "next-auth/providers/credentials";
import { z } from "zod";
import { getAuthSecret } from "@/lib/config";
import { prisma } from "@/lib/db";
import { LIMITS, rateLimit } from "@/lib/rate-limit";
import { getDummyHash, verifyPassword } from "./password";

const credentialsSchema = z.object({
  email: z.string().trim().toLowerCase().email().max(254),
  password: z.string().min(1).max(200),
});

function clientIp(headers: Record<string, unknown> | undefined): string {
  const forwarded = headers?.["x-forwarded-for"];
  const value = Array.isArray(forwarded) ? forwarded[0] : forwarded;
  return typeof value === "string" ? value.split(",")[0].trim() : "local";
}

export const SESSION_MAX_AGE_SECONDS = 8 * 60 * 60;

export const authOptions: NextAuthOptions = {
  secret: getAuthSecret(),
  session: { strategy: "jwt", maxAge: SESSION_MAX_AGE_SECONDS },
  pages: { signIn: "/login", error: "/login" },
  providers: [
    CredentialsProvider({
      name: "CloudTrace account",
      credentials: {
        email: { label: "Email", type: "email" },
        password: { label: "Password", type: "password" },
      },
      async authorize(raw, req) {
        const parsed = credentialsSchema.safeParse(raw ?? {});
        if (!parsed.success) return null;
        const { email, password } = parsed.data;

        const ip = clientIp(req?.headers as Record<string, unknown> | undefined);
        const perEmail = rateLimit(`signin:email:${email}`, LIMITS.signInPerEmail.limit, LIMITS.signInPerEmail.windowMs);
        const perIp = rateLimit(`signin:ip:${ip}`, LIMITS.signInPerIp.limit, LIMITS.signInPerIp.windowMs);
        if (!perEmail.allowed || !perIp.allowed) {
          throw new Error("RATE_LIMITED");
        }

        const user = await prisma.user.findUnique({
          where: { email },
          include: { memberships: { select: { id: true } } },
        });
        // Compare against a dummy hash when the account is unknown to equalise timing.
        const ok = await verifyPassword(password, user?.passwordHash ?? (await getDummyHash()));
        if (!user || !ok || user.memberships.length === 0) return null;

        await prisma.user.update({ where: { id: user.id }, data: { lastLoginAt: new Date() } });
        return { id: user.id, email: user.email, name: user.name };
      },
    }),
  ],
  callbacks: {
    async jwt({ token, user }) {
      if (user) token.sub = user.id;
      return token;
    },
    async session({ session, token }) {
      if (session.user && token.sub) (session.user as { id?: string }).id = token.sub;
      return session;
    },
  },
  logger: {
    // Keep auth library logs free of credentials and tokens.
    error(code) {
      console.error(`[auth] ${code}`);
    },
    warn(code) {
      if (code !== "DEBUG_ENABLED") console.warn(`[auth] ${code}`);
    },
    debug() {},
  },
};
