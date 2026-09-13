/** SHA-256 hex digest of a File's contents, via the browser's Web Crypto API
 * (no library dependency). Used by Task 11/12's `attachment` table, whose
 * `checksum` column is NOT NULL and is shown to the uploading officer at
 * confirmation time so a re-upload can be verified against what was
 * actually stored. */
export async function sha256Hex(file: File): Promise<string> {
  const buffer = await file.arrayBuffer();
  const digest = await crypto.subtle.digest("SHA-256", buffer);
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}
