/** Opens a PDF Blob in a new browser tab — used by both PO and GRN detail
 * screens' Print action. The object URL is revoked shortly after, once the
 * new tab has had a chance to load it. */
export function openPdfBlob(blob: Blob): void {
  const url = URL.createObjectURL(blob);
  window.open(url, '_blank', 'noopener,noreferrer');
  setTimeout(() => URL.revokeObjectURL(url), 30_000);
}
