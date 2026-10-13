import { createDocumentEvidenceIndex, type CanonicalDocument, type DocumentQuestion, type DocumentCitation } from "@actionmanifest/core";

/** Offline facade; caller chooses the local output destination and explicitly requests source excerpts. */
export function answerDocumentQuestion(document: CanonicalDocument, question: DocumentQuestion, contextRadius = 1) {
  const index = createDocumentEvidenceIndex(document, { signal: question.signal });
  const answer = index.query(question);
  const context: DocumentCitation[] = [];
  const seen = new Set<string>();
  for (const citation of answer.evidence) {
    for (const item of index.explainCitation(citation, contextRadius)) {
      const key = `${item.container}:${item.containerIndex}:${item.start}`;
      if (!seen.has(key)) { context.push(item); seen.add(key); }
    }
  }
  return { ...answer, context };
}
