import { withAuth } from "@/lib/api";
import { AppError } from "@/lib/domain/errors";
import { MAX_IMPORT_BYTES } from "@/lib/evidence/import";
import { importEvidence } from "@/lib/services/evidence";

/** Multipart upload: file, mode=ATOMIC|PARTIAL (default ATOMIC), dryRun=true|false. */
export const POST = withAuth<{ id: string }>(
  async (req, { auth, params }) => {
    const length = Number.parseInt(req.headers.get("content-length") ?? "0", 10);
    if (length > MAX_IMPORT_BYTES + 64 * 1024) throw new AppError("PAYLOAD_TOO_LARGE", "File exceeds the 5 MiB import limit.");
    let form: FormData;
    try {
      form = await req.formData();
    } catch {
      throw new AppError("VALIDATION_ERROR", "Expected a multipart form upload with a file field.");
    }
    const file = form.get("file");
    if (!(file instanceof File)) throw new AppError("VALIDATION_ERROR", "Choose a CSV or JSON file to import.");
    if (file.size > MAX_IMPORT_BYTES) throw new AppError("PAYLOAD_TOO_LARGE", "File exceeds the 5 MiB import limit.");
    const mode = form.get("mode") === "PARTIAL" ? "PARTIAL" : "ATOMIC";
    const dryRun = form.get("dryRun") === "true";
    const bytes = new Uint8Array(await file.arrayBuffer());
    const result = await importEvidence(auth, params.id, { filename: file.name, bytes }, { mode, dryRun });
    const status = dryRun ? 200 : result.outcome === "REJECTED" ? 422 : 201;
    return Response.json(result, { status });
  },
  { minRole: "ANALYST" },
);
