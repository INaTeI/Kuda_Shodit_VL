/** Minimal helpers for an editor interface. Never embed adminKey in a public bundle. */
const baseUrl = "http://localhost:8000/api/v1";

export interface ImportBatch {
  id: string;
  file_name: string;
  sha256: string;
  size_bytes: number;
  status: "ready" | "invalid" | "applied";
  created_at: string;
  expires_at: string;
  applied_at: string | null;
  report: {
    mode: "dry-run" | "apply" | "rejected";
    filled_rows: number;
    blank_rows: number;
    unique_places: number;
    created: number;
    would_create: number;
    skipped_existing: number;
    errors: Array<{ row: number; error: string }>;
    duplicates_in_file: Array<{ row: number; same_as_row: number; name: string; key: string }>;
    places: Array<{
      row: number;
      name: string;
      place_id: string;
      action: "created" | "would_create" | "skipped_existing";
      categories: string[];
      warnings: string[];
    }>;
  };
}

async function readResponse(response: Response): Promise<ImportBatch> {
  if (!response.ok) {
    const body = await response.json().catch(() => null);
    const detail = body?.detail;
    throw new Error(typeof detail === "string" ? detail : `Ошибка API: ${response.status}`);
  }
  return response.json();
}

export async function previewExcel(file: File, adminKey: string, signal?: AbortSignal): Promise<ImportBatch> {
  const body = new FormData();
  body.append("file", file);
  return readResponse(await fetch(`${baseUrl}/admin/imports/preview`, {
    method: "POST", headers: { "X-Admin-Key": adminKey }, body, signal,
  }));
}

export async function applyExcel(id: string, adminKey: string, signal?: AbortSignal): Promise<ImportBatch> {
  return readResponse(await fetch(`${baseUrl}/admin/imports/${encodeURIComponent(id)}/apply`, {
    method: "POST", headers: { "X-Admin-Key": adminKey }, signal,
  }));
}

export async function getImport(id: string, adminKey: string, signal?: AbortSignal): Promise<ImportBatch> {
  return readResponse(await fetch(`${baseUrl}/admin/imports/${encodeURIComponent(id)}`, {
    headers: { "X-Admin-Key": adminKey }, signal,
  }));
}
