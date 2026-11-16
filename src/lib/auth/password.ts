import { randomUUID } from "node:crypto";
import bcrypt from "bcryptjs";

const ROUNDS = 12;

export function hashPassword(password: string): Promise<string> {
  return bcrypt.hash(password, ROUNDS);
}

export function verifyPassword(password: string, hash: string): Promise<boolean> {
  return bcrypt.compare(password, hash);
}

let dummyHash: Promise<string> | null = null;

/** A real bcrypt hash of a random value, used to equalise timing for unknown accounts. */
export function getDummyHash(): Promise<string> {
  dummyHash ??= hashPassword(randomUUID());
  return dummyHash;
}

export const MIN_PASSWORD_LENGTH = 12;
