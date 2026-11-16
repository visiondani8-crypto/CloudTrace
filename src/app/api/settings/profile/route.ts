import { readJson, withAuth } from "@/lib/api";
import { updateProfile } from "@/lib/services/workspace";

export const PATCH = withAuth(async (req, { auth }) => updateProfile(auth, await readJson(req)));
