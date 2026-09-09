import { readFile } from "node:fs/promises";
import { basename, extname } from "node:path";
import {
  DocumentAdapterError,
  UnsupportedInputError,
  assertCanonicalDocument,
  ensureSourceHash,
  type CanonicalDocument,
} from "@actionmanifest/core";
import type { AdapterInput, DocumentAdapter } from "./types.js";

function guessLanguage(text: string): string | undefined {
  if (/[぀-ヿ一-龯]/.test(text)) return "ja";
  if (/[A-Za-z]/.test(text)) return "en";
  return undefined;
}

function guessMediaType(path: string | undefined): string {
  switch (extname(path ?? "").toLowerCase()) {
    case ".md":
      return "text/markdown";
    case ".csv":
      return "text/csv";
    default:
      return "text/plain";
  }
}

/**
 * Plain Text adapter — the simplest reference adapter and the regression
 * baseline for the integration contract. A plain-text input has no page
 * geometry, so the document is a single page and no bbox is ever invented.
 */
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
    let mediaType: string;

    if (input.kind === "text") {
      text = input.text;
      id = input.id ?? "stdin";
      title = input.title;
      language = input.language ?? guessLanguage(text);
      mediaType = guessMediaType(undefined);
    } else if (input.kind === "path") {
      try {
        text = await readFile(input.path, "utf8");
      } catch (e) {
        throw new DocumentAdapterError(`Failed to read ${input.path}`, e);
      }
      id = input.id ?? basename(input.path);
      title = input.title ?? basename(input.path);
      language = input.language ?? guessLanguage(text);
      mediaType = guessMediaType(input.path);
    } else {
      throw new UnsupportedInputError("PlainTextAdapter cannot handle Docling JSON", {
        received: input.kind,
      });
    }

    const pages = [
      {
        pageNumber: 1,
        text,
        chunks: [{ text, pageNumber: 1, sourceReference: `${id}#p1` }],
      },
    ];

    // Adapters validate their own output at the trust boundary: an empty or
    // contract-violating document fails here, never downstream.
    return assertCanonicalDocument(
      ensureSourceHash({
        id,
        title,
        mediaType,
        language,
        text,
        pages,
        chunks: pages[0]?.chunks,
      }),
    );
  }
}
