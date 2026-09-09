import { readFile } from "node:fs/promises";
import { basename } from "node:path";
import {
  DocumentAdapterError,
  ensureSourceHash,
  type CanonicalDocument,
} from "@actionmanifest/core";
import type { AdapterInput, DocumentAdapter } from "./types.js";

function guessLanguage(text: string): string | undefined {
  if (/[\u3040-\u30ff\u4e00-\u9faf]/.test(text)) return "ja";
  if (/[A-Za-z]/.test(text)) return "en";
  return undefined;
}

export class PlainTextAdapter implements DocumentAdapter {
  readonly id = "plain-text";

  canHandle(input: AdapterInput): boolean {
    if (input.kind === "text") return true;
    if (input.kind === "path") {
      return /\.(txt|md|text|csv)$/i.test(input.path) || !/\.[a-z0-9]+$/i.test(input.path);
    }
    return false;
  }

  async toCanonical(input: AdapterInput): Promise<CanonicalDocument> {
    let text: string;
    let id: string;
    let title: string | undefined;
    let language: string | undefined;

    if (input.kind === "text") {
      text = input.text;
      id = input.id ?? "stdin";
      title = input.title;
      language = input.language ?? guessLanguage(text);
    } else if (input.kind === "path") {
      try {
        text = await readFile(input.path, "utf8");
      } catch (e) {
        throw new DocumentAdapterError(`Failed to read ${input.path}`, e);
      }
      id = input.id ?? basename(input.path);
      title = input.title ?? basename(input.path);
      language = input.language ?? guessLanguage(text);
    } else {
      throw new DocumentAdapterError("PlainTextAdapter cannot handle Docling JSON");
    }

    const pages = [
      {
        pageNumber: 1,
        text,
        chunks: [{ text, pageNumber: 1, sourceReference: `${id}#p1` }],
      },
    ];

    return ensureSourceHash({
      id,
      title,
      language,
      text,
      pages,
      chunks: pages[0]?.chunks,
    });
  }
}
