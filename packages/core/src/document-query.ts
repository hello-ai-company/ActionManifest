import { classifyFamilyPassage, FAMILY_DOMAINS, FAMILY_TOPICS, validateFamilyLabel, type FamilyReview, type FamilyReviewOptions, type FamilyReviewItem, type FamilyReviewAnnotation } from "./family-review.js";
import type { CanonicalDocument } from "@actionmanifest/schema";
import { assertCanonicalDocument } from "./canonical.js";
import { canonicalText, sha256Hex } from "./hash.js";

/** Read-only, local extractive answers. Never an execution or verification grant. */
export type DocumentQuestionKind = "search" | "deadline" | "cost" | "requirements" | "contact" | "table";
export interface DocumentQuestion {
  kind: DocumentQuestionKind;
  /** Optional subject filter. This is literal/token retrieval, not semantic reasoning. */
  text?: string;
  limit?: number;
  signal?: AbortSignal;
}
export interface DocumentCitation {
  sourceId: string;
  snapshotHash: string;
  /** A page is supplied only when the input actually has page provenance. */
  page?: number;
  container: "text" | "page" | "chunk";
  containerIndex: number;
  paragraph: number;
  /** Half-open UTF-16 offsets into the original container, before normalization. */
  start: number;
  end: number;
  quote: string;
}
export interface DocumentAnswer {
  mode: "local-extractive";
  kind: DocumentQuestionKind;
  sourceId: string;
  snapshotHash: string;
  status: "evidence_found" | "not_found";
  evidence: DocumentCitation[];
  matchedPassages: number;
  hasMore: boolean;
  warnings: string[];
  /** Different literal numeric values, not a semantic contradiction verdict. */
  valueVariants: string[];
}
interface Passage { citation: DocumentCitation; normalized: string; categories: DocumentQuestionKind[] }
const KINDS: DocumentQuestionKind[] = ["search", "deadline", "cost", "requirements", "contact", "table"];
const PATTERNS: Record<Exclude<DocumentQuestionKind, "search">, RegExp> = {
  deadline: /締切|締め切り|期限|期日|提出日|申込.*まで|deadline|due\b|by\s+\d/iu,
  cost: /料金|費用|金額|参加費|支払|円|無料|cost\b|fee\b|price\b|payment\b|[$€£¥]/iu,
  requirements: /必要|持ち物|提出|用意|準備|手順|必須|required\b|must\b|bring\b|submit\b|steps?\b/iu,
  contact: /連絡先|問い合わせ|問合せ|電話|メール|担当|contact\b|email\b|phone\b|[\w.+-]+@[\w.-]+\.[a-z]{2,}/iu,
  table: /\t|\|.*\||^[^,\n]+,[^,\n]+,[^,\n]+$/u,
};
const MAX_CHARACTERS = 2_000_000;
const MAX_PASSAGES = 20_000;
const PASSAGE_LENGTH = 1_000;
/** Bound JSON/data input before Ajv/hash traversal. Accessors and class instances are not documents. */
function checkInputBudget(input: unknown, signal?: AbortSignal): void {
  let nodes = 0; let characters = 0;
  const ancestors = new Set<object>();
  function visit(value: unknown, depth: number): void {
    if ((nodes & 1023) === 0) abort(signal);
    if (++nodes > 100_000 || depth > 16) throw new RangeError("Document exceeds the 100,000-node / 16-level input budget");
    if (typeof value === "string") {
      characters += value.length;
      if (characters > MAX_CHARACTERS * 4) throw new RangeError("Document exceeds the 8,000,000 UTF-16 input budget");
    } else if (value !== null && typeof value === "object") {
      const array = Array.isArray(value);
      const prototype = Object.getPrototypeOf(value);
      if (prototype !== null && prototype !== (array ? Array.prototype : Object.prototype)) throw new TypeError("Document input must contain plain data objects");
      if (ancestors.has(value)) throw new TypeError("Document must not contain circular input");
      if (array && value.length > MAX_PASSAGES) throw new RangeError("Document container exceeds the 20,000-item limit");
      ancestors.add(value);
      const descriptors = Object.getOwnPropertyDescriptors(value);
      const keys = Reflect.ownKeys(descriptors);
      if (keys.length > 100_000) throw new RangeError("Document object exceeds the property budget");
      for (const key of keys) {
        if (array && key === "length") continue;
        if (typeof key !== "string") throw new TypeError("Document input must not contain symbol properties");
        const descriptor = descriptors[key]!;
        if (!("value" in descriptor) || !descriptor.enumerable) throw new TypeError("Document input must contain enumerable data properties, not accessors");
        if (array && !/^(0|[1-9]\d*)$/u.test(key)) throw new TypeError("Document arrays must contain only indexed data");
        characters += key.length;
        if (characters > MAX_CHARACTERS * 4) throw new RangeError("Document key budget exceeded");
        visit(descriptor.value, depth + 1);
      }
      ancestors.delete(value);
    } else if ((typeof value === "number" && !Number.isFinite(value)) || ["function", "symbol", "bigint"].includes(typeof value)) {
      throw new TypeError("Document input contains non-JSON values");
    }
  }
  visit(input, 0);
}

function normalize(text: string): string { return text.normalize("NFKC").toLowerCase().replace(/\s+/gu, " ").trim(); }
function terms(text: string): string[] {
  const result = new Set<string>();
  const normalized = normalize(text);
  const cjk = /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}]+/gu;
  for (const word of normalized.match(cjk) ?? []) {
    const chars = Array.from(word);
    for (const char of chars) result.add(char);
    for (let i = 0; i < chars.length - 1; i++) result.add(chars[i]! + chars[i + 1]!);
  }
  for (const word of normalized.replace(cjk, " ").match(/[\p{L}\p{N}]+/gu) ?? []) result.add(word);
  return [...result];
}
function containsSorted(values: number[], target: number): boolean {
  let low = 0; let high = values.length - 1;
  while (low <= high) {
    const mid = (low + high) >>> 1;
    const value = values[mid]!;
    if (value === target) return true;
    if (value < target) low = mid + 1; else high = mid - 1;
  }
  return false;
}
function abort(signal?: AbortSignal): void { signal?.throwIfAborted(); }

/** Immutable per-document index. Retain it for repeated queries; rebuild only when source changes. */
export class DocumentEvidenceIndex {
  readonly sourceId: string;
  readonly snapshotHash: string;
  readonly characterCount: number;
  readonly passageCount: number;
  readonly warnings: readonly string[];
  #passages: Passage[] = [];
  #postings = new Map<string, number[]>();
  #categories = new Map<DocumentQuestionKind, number[]>();
  #familyHints?: ReturnType<typeof classifyFamilyPassage>[];

  constructor(input: CanonicalDocument, options: { signal?: AbortSignal } = {}) {
    abort(options.signal);
    checkInputBudget(input, options.signal);
    const doc = assertCanonicalDocument(input);
    const text = canonicalText(doc);
    if (text.length > MAX_CHARACTERS) throw new RangeError("Document exceeds the 2,000,000 UTF-16 character limit");
    this.sourceId = doc.id;
    // Hash the indexed representation as well as canonical text, so page-only edits invalidate citations.
    this.snapshotHash = sha256Hex(JSON.stringify({ id: doc.id, text: doc.text, pages: doc.pages, chunks: doc.chunks }));
    const warnings: string[] = ["Extractive source passages only; no semantic answer, completeness guarantee, or action authorization."];
    if (doc.sourceHash && doc.sourceHash !== sha256Hex(text)) warnings.push("Input sourceHash does not match canonical text; query uses its own snapshot hash.");
    const pages = doc.pages?.filter(p => p.text.trim());
    const pageText = pages?.slice().sort((a, b) => a.pageNumber - b.pageNumber).map(p => p.text).join("\n");
    // Conflicting alternate representations must not silently replace canonical document text.
    const usePages = pages?.length && (!doc.text || normalize(doc.text) === normalize(pageText ?? ""));
    if (pages?.length && !usePages) warnings.push("Page text differs from canonical text; page locators omitted and canonical text searched.");
    const containers = usePages
      ? doc.pages!.map((p, i) => ({ text: p.text, container: "page" as const, containerIndex: i, page: p.pageNumber }))
      : doc.text?.trim() ? [{ text: doc.text, container: "text" as const, containerIndex: 0 }]
      : (doc.chunks ?? []).map((c, i) => ({ text: c.text, container: "chunk" as const, containerIndex: i, ...(c.pageNumber ? { page: c.pageNumber } : {}) }));
    this.characterCount = containers.reduce((n, c) => n + c.text.length, 0);
    if (this.characterCount > MAX_CHARACTERS) throw new RangeError("Indexed text exceeds the character limit");
    for (const kind of KINDS) this.#categories.set(kind, []);
    for (const container of containers) {
      let paragraph = 0;
      for (const line of container.text.matchAll(/[^\r\n]+/gu)) {
        paragraph++;
        for (let offset = 0; offset < line[0].length;) {
          abort(options.signal);
          if (this.#passages.length >= MAX_PASSAGES) throw new RangeError("Document exceeds the 20,000 passage limit");
          const start = line.index + offset;
          let end = Math.min(line.index + line[0].length, start + PASSAGE_LENGTH);
          if (end < container.text.length && /[\uD800-\uDBFF]/u.test(container.text[end - 1]!)
            && /[\uDC00-\uDFFF]/u.test(container.text[end]!)) end--;
          offset += end - start;
          const quote = container.text.slice(start, end);
          if (!quote.trim()) continue;
          const normalized = normalize(quote);
          const categories = KINDS.filter(k => k === "search" || PATTERNS[k].test(k === "table" ? quote : normalized));
          const citation: DocumentCitation = { sourceId: doc.id, snapshotHash: this.snapshotHash,
            container: container.container, containerIndex: container.containerIndex,
            ...("page" in container ? { page: container.page } : {}), paragraph, start, end, quote };
          const id = this.#passages.length;
          this.#passages.push({ citation, normalized, categories });
          for (const kind of categories) this.#categories.get(kind)!.push(id);
          for (const term of terms(normalized)) {
            if (!this.#postings.has(term)) this.#postings.set(term, []);
            this.#postings.get(term)!.push(id);
          }
        }
      }
    }
    this.passageCount = this.#passages.length;
    this.warnings = Object.freeze([...warnings, "Matching is limited to indexed line segments of at most 1,000 UTF-16 units; cross-segment facts may be missed."]);
    Object.freeze(this);
  }

  query(question: DocumentQuestion): DocumentAnswer {
    abort(question.signal);
    if (!KINDS.includes(question.kind)) throw new TypeError("Unsupported document question kind");
    const limit = question.limit ?? 8;
    if (!Number.isInteger(limit) || limit < 1 || limit > 50) throw new RangeError("Answer limit must be an integer from 1 to 50");
    if ((question.text?.length ?? 0) > 512) throw new RangeError("Question exceeds 512 UTF-16 characters");
    const needle = normalize(question.text ?? "");
    const tokens = terms(needle);
    const warnings = [...this.warnings];
    if (question.kind === "table") warnings.push("Table-like source rows only; column relationships and merged cells are not inferred.");
    if (question.kind === "search" && !tokens.length) return this.#answer(question.kind, [], limit, warnings);
    // Start with the smallest posting set. This keeps repeated scoped queries cheap.
    const sets = [this.#categories.get(question.kind)!, ...tokens.map(t => this.#postings.get(t) ?? [])];
    const smallest = sets.reduce((a, b) => a.length <= b.length ? a : b);
    const matches: number[] = [];
    for (const id of smallest) {
      abort(question.signal);
      if (sets.every(s => containsSorted(s, id))) matches.push(id);
    }
    matches.sort((a, b) => {
      const exactA = needle && this.#passages[a]!.normalized.includes(needle) ? 1 : 0;
      const exactB = needle && this.#passages[b]!.normalized.includes(needle) ? 1 : 0;
      return exactB - exactA || a - b;
    });
    return this.#answer(question.kind, matches, limit, warnings);
  }

  /** One source at a time. No cross-document reconciliation or inferred family identity. */
  familyReview(options: FamilyReviewOptions = {}): FamilyReview {
    abort(options.signal);
    const limit = options.limit ?? 20, offset = options.offset ?? 0;
    if (!Number.isInteger(limit) || limit < 1 || limit > 50 || !Number.isInteger(offset) || offset < 0 || offset > MAX_PASSAGES) throw new RangeError("Invalid family review window");
    if (options.domain !== undefined && !FAMILY_DOMAINS.includes(options.domain)) throw new TypeError("Unsupported family domain");
    if (options.topic !== undefined && !FAMILY_TOPICS.includes(options.topic)) throw new TypeError("Unsupported family topic");
    validateFamilyLabel(options.memberLabel, 128);
    if (!this.#familyHints) {
      const hints: ReturnType<typeof classifyFamilyPassage>[] = [];
      for (let i = 0; i < this.#passages.length; i++) {
        abort(options.signal);
        const citation = this.#passages[i]!.citation;
        const context = this.#passages.slice(Math.max(0, i - 1), i + 2)
          .filter(p => p.citation.container === citation.container && p.citation.containerIndex === citation.containerIndex);
        hints.push(classifyFamilyPassage(citation.quote, context.map(p => p.citation.quote).join("\n")));
      }
      // Publish only a complete cache, owned by this immutable source index.
      this.#familyHints = hints;
    }
    const items: FamilyReviewItem[] = [];
    let candidates = 0, matching = 0;
    for (let i = 0; i < this.#passages.length; i++) {
      abort(options.signal);
      const citation = this.#passages[i]!.citation;
      const hints = this.#familyHints[i]!;
      if (hints.candidate) candidates++;
      if (options.domain && !hints.domains.includes(options.domain) || options.topic && !hints.topics.includes(options.topic)) continue;
      const position = matching++;
      if (position >= offset && items.length < limit) {
        const context = this.#passages.slice(Math.max(0, i - 1), i + 2)
          .filter(p => p.citation.container === citation.container && p.citation.containerIndex === citation.containerIndex)
          .map(p => ({ ...p.citation }));
        items.push({ citation: { ...citation }, context, domains: [...hints.domains], topics: [...hints.topics], flags: [...hints.flags], requiresReview: true });
      }
    }
    const hasMore = matching > offset + items.length;
    const label = options.memberLabel?.trim();
    return { mode: "local-family-evidence", sourceId: this.sourceId, snapshotHash: this.snapshotHash,
      member: label ? { status: "user_selected", label, sourceIdentityVerified: false } : { status: "unassigned", sourceIdentityVerified: false }, items,
      coverage: { indexedCharacters: this.characterCount, indexedPassages: this.passageCount, candidatePassages: candidates, unmatchedPassages: this.passageCount - candidates, matchingPassages: matching, returnedPassages: items.length, offset, hasMore, ...(hasMore ? { nextOffset: offset + items.length } : {}), completeUnderstanding: false },
      warnings: [...this.warnings, "Categories and caution flags are keyword hints only; names, dates, obligations and latest revisions are not resolved.",
        "Member selection is your local annotation, not evidence that the source applies to that person. Check the original recipient and organization.",
        "Relative dates remain original text; no reference date, timezone or calendar date is assumed.",
        "No diagnosis, legal conclusion, emergency dispatch, contact, booking, payment or other action is performed.",
        ...(hasMore ? ["More matching passages exist; continue with nextOffset."] : [])] };
  }

  /** A correction stays separate from source evidence and is invalid after a source change. */
  annotateFamilyCitation(annotation: FamilyReviewAnnotation): FamilyReviewAnnotation {
    checkInputBudget(annotation);
    if (annotation.kind !== "user_annotation") throw new TypeError("Explicit user annotation required");
    this.explainCitation(annotation.citation, 0);
    if (annotation.domain !== undefined && !FAMILY_DOMAINS.includes(annotation.domain) || annotation.topic !== undefined && !FAMILY_TOPICS.includes(annotation.topic)) throw new TypeError("Invalid annotation category");
    validateFamilyLabel(annotation.memberLabel, 128); validateFamilyLabel(annotation.note, 512);
    return { kind: "user_annotation", citation: { ...annotation.citation }, ...(annotation.domain !== undefined ? { domain: annotation.domain } : {}), ...(annotation.topic !== undefined ? { topic: annotation.topic } : {}), ...(annotation.memberLabel !== undefined ? { memberLabel: annotation.memberLabel } : {}), ...(annotation.note !== undefined ? { note: annotation.note } : {}) };
  }

  /** Expand a result with neighboring original lines, preserving conditions and table context. */
  explainCitation(citation: DocumentCitation, radius = 1): DocumentCitation[] {
    checkInputBudget(citation);
    if (!citation || typeof citation !== "object") throw new TypeError("Invalid citation");
    if (!Number.isInteger(radius) || radius < 0 || radius > 3) throw new RangeError("Context radius must be an integer from 0 to 3");
    const index = this.#passages.findIndex(p => p.citation.snapshotHash === citation.snapshotHash
      && p.citation.sourceId === citation.sourceId && p.citation.container === citation.container
      && p.citation.containerIndex === citation.containerIndex && p.citation.start === citation.start
      && p.citation.end === citation.end && p.citation.quote === citation.quote && p.citation.page === citation.page
      && p.citation.paragraph === citation.paragraph);
    if (index < 0) throw new TypeError("Citation does not belong to this document snapshot");
    return this.#passages.slice(Math.max(0, index - radius), index + radius + 1)
      .filter(p => p.citation.container === citation.container && p.citation.containerIndex === citation.containerIndex)
      .map(p => ({ ...p.citation }));
  }

  #answer(kind: DocumentQuestionKind, matches: number[], limit: number, warnings: string[]): DocumentAnswer {
    const evidence = matches.slice(0, limit).map(id => ({ ...this.#passages[id]!.citation }));
    const variants = new Set<string>();
    if (kind === "cost" || kind === "deadline") {
      for (const citation of evidence) {
        const pattern = kind === "cost" ? /(?:[$€£¥]\s*\d[\d,.]*|\d[\d,.]*\s*(?:円|usd\b|eur\b))/giu
          : /\d{4}[-/]\d{1,2}[-/]\d{1,2}|\d{1,2}月\d{1,2}日/gu;
        for (const match of normalize(citation.quote).matchAll(pattern)) variants.add(match[0]);
      }
    }
    if (variants.size > 1) warnings.push("Multiple literal values in returned evidence; compare subjects, conditions and revisions. This is not a contradiction verdict.");
    if (matches.length > limit) warnings.push("More matching passages exist; narrow the subject or raise the result limit.");
    return { mode: "local-extractive", kind, sourceId: this.sourceId, snapshotHash: this.snapshotHash,
      status: matches.length ? "evidence_found" : "not_found", evidence, matchedPassages: matches.length,
      hasMore: matches.length > limit, warnings, valueVariants: [...variants] };
  }
}

export function createDocumentEvidenceIndex(document: CanonicalDocument, options?: { signal?: AbortSignal }): DocumentEvidenceIndex {
  return new DocumentEvidenceIndex(document, options);
}
/** Reject stale or modified citations by reconstructing their original container, never normalized offsets. */
export function verifyDocumentCitation(document: CanonicalDocument, citation: DocumentCitation): boolean {
  try {
    checkInputBudget(document);
    checkInputBudget(citation);
    assertCanonicalDocument(document);
  if (document.id !== citation.sourceId || sha256Hex(JSON.stringify({ id: document.id, text: document.text, pages: document.pages, chunks: document.chunks })) !== citation.snapshotHash) return false;
  if (!["text", "page", "chunk"].includes(citation.container) || !Number.isInteger(citation.containerIndex) || citation.containerIndex < 0) return false;
  if (!Number.isInteger(citation.start) || !Number.isInteger(citation.end) || citation.start < 0 || citation.end <= citation.start) return false;
  const container = citation.container === "text" ? (citation.containerIndex === 0 ? { text: document.text } : undefined)
    : citation.container === "page" ? document.pages?.[citation.containerIndex] : document.chunks?.[citation.containerIndex];
  if (!container?.text) return false;
  let paragraph = 0; let foundParagraph = 0;
  for (const line of container.text.matchAll(/[^\r\n]+/gu)) {
    paragraph++;
    if (citation.start >= line.index && citation.start < line.index + line[0].length) { foundParagraph = paragraph; break; }
  }
  return foundParagraph === citation.paragraph && citation.end <= container.text.length && container.text.slice(citation.start, citation.end) === citation.quote
    && citation.page === ("pageNumber" in container ? container.pageNumber : undefined);
  } catch { return false; }
}
