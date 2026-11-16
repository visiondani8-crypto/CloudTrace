import "server-only";
import { notFound } from "next/navigation";
import { AppError } from "@/lib/domain/errors";

/** Converts organisation-scoped NOT_FOUND errors into the contextual 404 page. */
export async function orNotFound<T>(promise: Promise<T>): Promise<T> {
  try {
    return await promise;
  } catch (error) {
    if (error instanceof AppError && error.code === "NOT_FOUND") notFound();
    throw error;
  }
}

export function firstParam(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

export type SearchParams = Promise<Record<string, string | string[] | undefined>>;
