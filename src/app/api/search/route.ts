import { withAuth } from "@/lib/api";
import { globalSearch } from "@/lib/services/workspace";

export const GET = withAuth(async (req, { auth }) => globalSearch(auth, req.nextUrl.searchParams.get("q") ?? ""));
