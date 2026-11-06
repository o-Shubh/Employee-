import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

/**
 * Object storage for check-in photos. Phase 1 ships a local-disk driver
 * (mounted volume in Docker). An S3/MinIO driver implements the same interface.
 */
export interface ObjectStorage {
  put(key: string, bytes: Uint8Array, contentType: string): Promise<void>;
  get(key: string): Promise<Uint8Array | null>;
}

const KEY_RE = /^[a-zA-Z0-9][a-zA-Z0-9/_\-.]*$/;

export function localStorageDriver(root = process.env.STORAGE_DIR ?? "./storage"): ObjectStorage {
  const base = path.resolve(root);
  const resolve = (key: string) => {
    if (!KEY_RE.test(key) || key.includes("..")) throw new Error("Invalid storage key");
    const p = path.resolve(base, key);
    if (!p.startsWith(base + path.sep)) throw new Error("Invalid storage key");
    return p;
  };
  return {
    async put(key, bytes) {
      const p = resolve(key);
      await mkdir(path.dirname(p), { recursive: true });
      await writeFile(p, bytes, { flag: "wx" }); // never overwrite
    },
    async get(key) {
      try {
        return new Uint8Array(await readFile(resolve(key)));
      } catch {
        return null;
      }
    },
  };
}

let instance: ObjectStorage | null = null;
export function storage(): ObjectStorage {
  instance ??= localStorageDriver();
  return instance;
}
