import { open } from "node:fs/promises";
import { constants } from "node:fs";
import { ActionManifestError } from "@actionmanifest/core";

/** Bound reads before parsing; do not trust stat alone if the file grows. */
export async function readMatoeInput(path: string, limit: number): Promise<string> {
  const file = await open(path, constants.O_RDONLY | constants.O_NONBLOCK);
  try {
    const metadata = await file.stat();
    if (!metadata.isFile() || metadata.size > limit) {
      throw new ActionManifestError("MATOE_INPUT_INVALID", "Input must be a regular file within the size limit");
    }
    const buffer = Buffer.alloc(limit + 1);
    let length = 0;
    while (length < buffer.length) {
      const { bytesRead } = await file.read(buffer, length, buffer.length - length, length);
      if (!bytesRead) break;
      length += bytesRead;
    }
    if (length > limit) throw new ActionManifestError("MATOE_INPUT_INVALID", "Input size limit exceeded");
    // Invalid UTF-8 must not silently change the bytes used for OCR hashing.
    return new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(buffer.subarray(0, length));
  } finally {
    await file.close();
  }
}
