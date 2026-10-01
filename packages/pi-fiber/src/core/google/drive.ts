/** Google Drive helpers used as a Mosaic hosting adapter (D1): upload → anyone-with-link reader → revoke/delete. */
import { readFileSync } from "node:fs";
import { basename } from "node:path";

const UPLOAD = "https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&fields=id,name";
const FILES = "https://www.googleapis.com/drive/v3/files";

export async function driveUpload(token: string, path: string, mimeType = "text/csv", name = `sailor-${Date.now()}-${basename(path)}`): Promise<string> {
  const boundary = `sailor${Date.now()}`;
  const meta = JSON.stringify({ name, mimeType });
  const data = readFileSync(path);
  const body = Buffer.concat([
    Buffer.from(`--${boundary}\r\ncontent-type: application/json; charset=UTF-8\r\n\r\n${meta}\r\n--${boundary}\r\ncontent-type: ${mimeType}\r\n\r\n`),
    data,
    Buffer.from(`\r\n--${boundary}--`),
  ]);
  const res = await fetch(UPLOAD, { method: "POST", headers: { authorization: `Bearer ${token}`, "content-type": `multipart/related; boundary=${boundary}` }, body });
  const j: any = await res.json();
  if (!res.ok) throw new Error(`Drive upload failed: ${j.error?.message ?? res.status}`);
  return j.id;
}

export async function driveMakePublic(token: string, fileId: string): Promise<{ url: string; permissionId: string }> {
  const res = await fetch(`${FILES}/${fileId}/permissions?fields=id`, { method: "POST", headers: { authorization: `Bearer ${token}`, "content-type": "application/json" }, body: JSON.stringify({ role: "reader", type: "anyone" }) });
  const j: any = await res.json();
  if (!res.ok) throw new Error(`Drive sharing failed: ${j.error?.message ?? res.status} (your Workspace admin may block public links — use S3/R2 hosting or a manual URL).`);
  return { url: `https://drive.google.com/uc?export=download&id=${fileId}`, permissionId: j.id };
}

export async function driveRevoke(token: string, fileId: string, permissionId: string): Promise<void> {
  await fetch(`${FILES}/${fileId}/permissions/${permissionId}`, { method: "DELETE", headers: { authorization: `Bearer ${token}` } });
}

export async function driveDelete(token: string, fileId: string): Promise<void> {
  await fetch(`${FILES}/${fileId}`, { method: "DELETE", headers: { authorization: `Bearer ${token}` } });
}
