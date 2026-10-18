// Save a blob to the user's computer: a native "Save as" dialog where the
// browser supports it (Chrome/Edge), otherwise a regular download.

interface SaveFilePickerWindow {
  showSaveFilePicker?: (opts: {
    suggestedName: string;
    types?: { description: string; accept: Record<string, string[]> }[];
  }) => Promise<{ createWritable(): Promise<{ write(data: Blob): Promise<void>; close(): Promise<void> }> }>;
}

/** Resolves false if the user cancelled the dialog. */
export async function saveBlobToDisk(blob: Blob, fileName: string): Promise<boolean> {
  const picker = (window as unknown as SaveFilePickerWindow).showSaveFilePicker;
  if (picker) {
    const ext = fileName.slice(fileName.lastIndexOf("."));
    const mime = blob.type.split(";")[0] || "application/octet-stream";
    try {
      const handle = await picker({ suggestedName: fileName, types: [{ description: "Recording", accept: { [mime]: [ext] } }] });
      const writable = await handle.createWritable();
      await writable.write(blob);
      await writable.close();
      return true;
    } catch (err) {
      if (err instanceof DOMException && err.name === "AbortError") return false;
      // Some contexts (iframes, unusual MIME types) reject the picker; fall back to a download.
    }
  }
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = fileName;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 60_000);
  return true;
}
