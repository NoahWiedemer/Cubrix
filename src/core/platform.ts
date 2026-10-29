// File I/O that works in the Tauri shell (native dialogs) and in a plain browser (dev).
export const isTauri = typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;

export interface FileFilter {
  name: string;
  extensions: string[];
}

function browserDownload(name: string, data: Uint8Array | string, mime: string) {
  const blob = new Blob([data as BlobPart], { type: mime });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}

/** Returns the chosen path (or file name in the browser), or null when cancelled. */
export async function saveFile(
  defaultName: string,
  filter: FileFilter,
  data: Uint8Array | string,
  existingPath?: string | null,
): Promise<string | null> {
  if (!isTauri) {
    browserDownload(defaultName, data, "application/octet-stream");
    return defaultName;
  }
  const { save } = await import("@tauri-apps/plugin-dialog");
  const { writeFile, writeTextFile } = await import("@tauri-apps/plugin-fs");
  const path = existingPath ?? (await save({ defaultPath: defaultName, filters: [filter] }));
  if (!path) return null;
  if (typeof data === "string") await writeTextFile(path, data);
  else await writeFile(path, data);
  return path;
}

export async function openTextFile(filter: FileFilter): Promise<{ path: string; text: string } | null> {
  if (!isTauri) {
    return new Promise((resolve) => {
      const input = document.createElement("input");
      input.type = "file";
      input.accept = filter.extensions.map((e) => "." + e).join(",");
      input.onchange = async () => {
        const file = input.files?.[0];
        resolve(file ? { path: file.name, text: await file.text() } : null);
      };
      input.click();
    });
  }
  const { open } = await import("@tauri-apps/plugin-dialog");
  const { readTextFile } = await import("@tauri-apps/plugin-fs");
  const path = await open({ multiple: false, directory: false, filters: [filter] });
  if (!path || Array.isArray(path)) return null;
  return { path, text: await readTextFile(path) };
}

export function baseName(path: string): string {
  return path.split(/[\\/]/).pop() ?? path;
}
