import "server-only";
import { randomUUID } from "node:crypto";
import { NextResponse, type NextRequest } from "next/server";
import { Prisma } from "@prisma/client";
import { ZodError } from "zod";
import { getAuthContext, requireRole, type AuthContext } from "@/lib/auth/context";
import { redactSecrets } from "@/lib/config";
import type { Role } from "@/lib/domain/enums";
import { AppError, type ErrorDetail } from "@/lib/domain/errors";

export function errorResponse(code: string, message: string, status: number, details?: ErrorDetail[], extraHeaders?: HeadersInit) {
  return NextResponse.json(
    { error: { code, message, ...(details && details.length ? { details } : {}) } },
    { status, headers: { "Cache-Control": "no-store", ...extraHeaders } },
  );
}

function sameOrigin(req: NextRequest): boolean {
  const origin = req.headers.get("origin");
  if (!origin) return true; // same-origin fetches from older browsers / server tools
  const host = req.headers.get("x-forwarded-host") ?? req.headers.get("host");
  try {
    return new URL(origin).host === host;
  } catch {
    return false;
  }
}

export function toErrorResponse(error: unknown): NextResponse {
  if (error instanceof AppError) {
    return errorResponse(error.code, error.message, error.status, error.details);
  }
  if (error instanceof ZodError) {
    return errorResponse(
      "VALIDATION_ERROR",
      "Some fields are invalid.",
      400,
      error.issues.slice(0, 50).map((i) => ({ path: i.path.join("."), message: i.message })),
    );
  }
  if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
    return errorResponse("CONFLICT", "A record with the same unique value already exists.", 409);
  }
  const requestId = randomUUID();
  const message = error instanceof Error ? error.message : String(error);
  console.error(`[api] request ${requestId} failed: ${redactSecrets(message).slice(0, 500)}`);
  return errorResponse("INTERNAL_ERROR", `Unexpected server error. Request ID: ${requestId}`, 500);
}

type RouteParams = Record<string, string>;

export interface HandlerContext<P extends RouteParams> {
  auth: AuthContext;
  params: P;
}

/**
 * Wraps a route handler with: session verification (401), role check (403),
 * same-origin check for state-changing requests, and uniform JSON errors.
 * Every service called inside also enforces organisation scoping.
 */
export function withAuth<P extends RouteParams = RouteParams>(
  handler: (req: NextRequest, ctx: HandlerContext<P>) => Promise<unknown>,
  options: { minRole?: Role } = {},
) {
  return async (req: NextRequest, segment: { params: Promise<P> }) => {
    try {
      if (req.method !== "GET" && req.method !== "HEAD" && !sameOrigin(req)) {
        return errorResponse("FORBIDDEN", "Cross-origin request rejected.", 403);
      }
      const auth = await getAuthContext();
      if (!auth) return errorResponse("UNAUTHENTICATED", "Sign in to continue.", 401);
      if (options.minRole) requireRole(auth, options.minRole);
      const params = (await segment.params) ?? ({} as P);
      const result = await handler(req, { auth, params });
      if (result instanceof Response) return result;
      return NextResponse.json(result ?? { ok: true }, { headers: { "Cache-Control": "no-store" } });
    } catch (error) {
      return toErrorResponse(error);
    }
  };
}

export async function readJson(req: NextRequest, maxBytes = 256 * 1024): Promise<unknown> {
  const type = req.headers.get("content-type") ?? "";
  if (!type.includes("application/json")) {
    throw new AppError("VALIDATION_ERROR", "Expected an application/json request body.");
  }
  const text = await req.text();
  if (text.length > maxBytes) throw new AppError("PAYLOAD_TOO_LARGE", "Request body is too large.");
  try {
    return JSON.parse(text);
  } catch {
    throw new AppError("VALIDATION_ERROR", "Request body is not valid JSON.");
  }
}

export function searchParamsObject(req: NextRequest): Record<string, string | string[]> {
  const out: Record<string, string | string[]> = {};
  for (const key of new Set(req.nextUrl.searchParams.keys())) {
    const all = req.nextUrl.searchParams.getAll(key);
    out[key] = all.length > 1 ? all : all[0];
  }
  return out;
}
