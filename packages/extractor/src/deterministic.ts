import {
  locateEvidence,
  newActionId,
  type Action,
  type ActionKind,
  type CanonicalDocument,
  type Temporal,
} from "@actionmanifest/core";
import {
  detectKind,
  detectModality,
  extractYearContext,
  isCancellationContext,
  isNegation,
  isPastCompletedContext,
  isReferenceContext,
  parseTemporals,
  primaryTemporal,
} from "@actionmanifest/temporal";

export function splitSentences(text: string): string[] {
  const normalized = text.replace(/\r\n/g, "\n").trim();
  const parts = normalized
    .split(/(?<=[。．.!?！？])\s*|\n+/)
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
  return parts.length ? parts : [normalized];
}

function extractObject(text: string): string | undefined {
  const jp = text.match(
    /([^\s、,]{2,24}(?:票|書|届|願|金|費|弁当|水筒|タオル|契約|請求|申請|報告書|確認票))/,
  );
  if (jp) return jp[1];
  const items = text.match(/弁当[、,]?\s*水筒[、,]?\s*タオル/);
  if (items) return items[0];
  const en = text.match(/\b([A-Z][A-Za-z]+(?:\s+[A-Za-z]+){0,4}\s(?:form|slip|invoice|contract|fee))\b/);
  return en?.[1];
}

function eventTitle(text: string): string {
  const m =
    text.match(/([一-龯ぁ-んァ-ンA-Za-z]{2,12}(?:遠足|行事|説明会|総会|集会|保護者会|運動会|健康診断|発表会|校外学習|式))/) ??
    text.match(/開催する([^\s。]+)/);
  if (m) return `${m[1]}を実施する`.replace(/を実施するを実施する/, "を実施する");
  return text.replace(/[。．.]$/, "").slice(0, 40);
}

function isRainAlternative(text: string): boolean {
  return /雨天(?:の場合)?(?:は)?.{0,20}(?:延期|順延)/.test(text) || /雨天順延/.test(text) || /in case of rain/i.test(text);
}

function isInstitutionalFiller(text: string): boolean {
  if (/提出|持参|支払|振り込|署名|参加を希望|徴収|必着|消印|実施|開催|運動会|健康診断|遠足/.test(text)) {
    return false;
  }
  if (/\d{1,2}月/.test(text) || /\b(?:January|February|March|April|May|June|July|August|September|October|November|December)\b/i.test(text)) {
    return false;
  }
  return /お知らせします|ご連絡します|会場は|継続します|announced later/i.test(text);
}

/**
 * A genuine eligibility / prior-submission EXEMPTION ("再提出不要", "提出した方は不要",
 * "already submitted … not required"). A blanket negation like "(X の)提出は不要"
 * / "提出する必要はありません" is NOT an exemption — it retracts the requirement for
 * everyone and is handled by the negation branch (which fails verification).
 */
function isExemption(text: string): boolean {
  return (
    /再提出(?:する必要はありません|不要)/.test(text) ||
    /前回(?:すでに|既に)?.{0,16}提出した方は(?:不要|再提出)/.test(text) ||
    /(?:すでに|既に)?提出済みの方は(?:再提出)?不要/.test(text) ||
    /already submitted.{0,40}not (?:need|required)/i.test(text)
  );
}

/**
 * Canonical subject/object for internal target resolution (benchmark-safe; not a
 * schema field). Lowercases, strips punctuation, leading imperative verbs
 * ("please submit", "bring", …) and determiners ("the"/"a"/"an"), and normalizes
 * whitespace so "Please submit the permission form" / "The permission form" /
 * "permission form" resolve to the same target. No stemming / NLP dependency.
 */
function canonicalTarget(s: string): string {
  return s
    .toLowerCase()
    .replace(/[.,!?;:「」『』“”"'()]/g, "")
    .replace(/^\s*(?:please\s+)?(?:submit|send|bring|complete|return|file|pay|attend)\s+/i, "")
    .replace(/^\s*(?:the|a|an)\s+/i, "")
    .replace(/\s+/g, " ")
    .trim();
}

/** Whether `obj` names `action` — by JP substring or canonical (EN-safe) identity. */
function targetMatches(action: Action, obj: string): boolean {
  if (!obj) return false;
  if (
    (action.object && (action.object.includes(obj) || obj.includes(action.object))) ||
    action.title.includes(obj)
  ) {
    return true;
  }
  const co = canonicalTarget(obj);
  if (co.length < 2) return false;
  for (const raw of [action.object, action.title]) {
    if (!raw) continue;
    const c = canonicalTarget(raw);
    if (c.length >= 2 && (c === co || c.includes(co) || co.includes(c))) return true;
  }
  return false;
}

/** Event/subject nouns used to match a cancellation sentence to a prior Action. */
function cancellationSubjects(text: string): string[] {
  const subjects: string[] = [];
  const jp = text.match(
    /([一-龥ぁ-んァ-ンー]{1,14}(?:説明会|保護者会|懇談会|面談|遠足|行事|運動会|健康診断|発表会|校外学習|総会|集会|検診|集金|式典))/g,
  );
  if (jp) subjects.push(...jp);
  const jpGeneric = text.match(/([一-龥ァ-ンー]{2,10}会)(?=は|が|を|に|の|、|。|$)/g);
  if (jpGeneric) subjects.push(...jpGeneric);
  const obj = extractObject(text);
  if (obj) subjects.push(obj);
  const en = text.match(/\b(meeting|event|trip|fair|session|ceremony|briefing|assembly|reception|open house|checkup|inspection)\b/gi);
  if (en) subjects.push(...en.map((s) => s.toLowerCase()));
  // Dedupe, keep tokens of length >= 2.
  return [...new Set(subjects)].filter((s) => s.replace(/\s/g, "").length >= 2);
}

function actionMatchesSubject(action: Action, subject: string): boolean {
  const s = subject.trim();
  if (s.length < 2) return false;
  const title = action.title.toLowerCase();
  const obj = (action.object ?? "").toLowerCase();
  const ls = s.toLowerCase();
  return (
    action.title.includes(s) ||
    title.includes(ls) ||
    (obj.length > 0 && (obj.includes(ls) || ls.includes(obj)))
  );
}

function mergeTemporal(event: Action, alt: Temporal, evidenceText: string, doc: CanonicalDocument): void {
  const t = event.temporal ?? { type: "unknown" as const, raw_text: alt.raw_text };
  const alternatives = [...(t.alternatives ?? []), alt];
  event.temporal = { ...t, alternatives };
  if (!event.evidence.some((e) => e.text === evidenceText)) {
    event.evidence.push(locate(doc, event.evidence[0]!.source_id, evidenceText));
  }
}

/**
 * Build an Evidence object for a quote, attributing page/bbox/section from the
 * CanonicalDocument. When the quote cannot be located, locators are omitted —
 * never fabricated (unknown stays unknown).
 */
function locate(doc: CanonicalDocument, sourceId: string, quote: string): Action["evidence"][number] {
  const at = locateEvidence(doc, quote);
  return {
    source_id: sourceId,
    text: quote,
    ...(at?.page != null ? { page: at.page } : {}),
    ...(at?.bbox ? { bbox: at.bbox } : {}),
    ...(at?.section ? { section: at.section } : {}),
    ...(at?.sourceReference ? { source_reference: at.sourceReference } : {}),
  };
}

export function extractDeterministically(doc: CanonicalDocument): Action[] {
  const source = doc.text ?? "";
  const ctx = extractYearContext(source);
  const sentences = splitSentences(source);
  const actions: Action[] = [];
  const cancellationSentences: string[] = [];

  const make = (
    partial: Omit<Action, "id" | "status" | "inference" | "evidence"> & {
      evidenceText: string;
      extraEvidence?: string[];
      inference?: Action["inference"];
    },
  ): Action => {
    const evidence = [
      locate(doc, doc.id, partial.evidenceText),
      ...(partial.extraEvidence ?? []).map((text) => locate(doc, doc.id, text)),
    ];
    return {
      id: newActionId(actions.length),
      kind: partial.kind,
      title: partial.title,
      description: partial.description,
      object: partial.object,
      modality: partial.modality,
      actor: partial.actor,
      temporal: partial.temporal,
      evidence,
      confidence: partial.confidence,
      inference: partial.inference ?? "explicit",
      status: "proposed",
      conditions: partial.conditions,
      notes: partial.notes,
    };
  };

  for (const sentence of sentences) {
    if (isInstitutionalFiller(sentence)) continue;

    // Conservative guards (Phase 1.2): never assert an active Action for a
    // cancelled event, a reference/quoted old instruction, or a completed past
    // event. Preferring omission over a confident-wrong Action is the trust order.
    // Cancellations are also recorded so a cancellation in a LATER sentence can
    // deactivate a matching Action created by an EARLIER sentence.
    if (isCancellationContext(sentence)) {
      cancellationSentences.push(sentence);
      continue;
    }
    if (isReferenceContext(sentence)) continue;
    if (isPastCompletedContext(sentence)) continue;

    if (isRainAlternative(sentence)) {
      const event = [...actions].reverse().find((a) => a.kind === "event");
      const temps = parseTemporals(sentence, ctx);
      const dated = temps.find((t) => t.date && t.type === "exact") ?? temps.find((t) => t.date);
      const alt: Temporal = {
        type: "conditional",
        date: dated?.date,
        month: dated?.month,
        day: dated?.day,
        year: dated?.year ?? ctx.year,
        precision: dated?.precision ?? "day",
        raw_text: sentence.replace(/[。．.]$/, ""),
        condition: sentence.includes("雨天") ? "雨天" : "rain",
        certainty: "high",
      };
      if (event) {
        mergeTemporal(event, alt, sentence, doc);
        continue;
      }
      actions.push(
        make({
          kind: "event",
          title: "雨天時の代替日",
          modality: "unknown",
          actor: { certainty: "unknown" },
          temporal: alt,
          evidenceText: sentence,
        }),
      );
      continue;
    }

    if (isExemption(sentence)) {
      const obj = extractObject(sentence);
      const submits = actions.filter((a) => a.kind === "submit");
      // Attach the exemption to its OWN target. With a single submit there is no
      // ambiguity. With multiple submits, require an object match — never attach to
      // an arbitrary submit just because its title contains 提出.
      let submit: Action | undefined;
      if (submits.length === 1) {
        submit = submits[0];
      } else if (obj) {
        submit = [...submits].reverse().find((a) => targetMatches(a, obj));
      }
      if (submit) {
        submit.conditions = [
          ...new Set([...(submit.conditions ?? []), "前回すでに提出した方は再提出不要", sentence.replace(/[。．.]$/, "")]),
        ];
        if (!submit.evidence.some((e) => e.text === sentence)) {
          submit.evidence.push(locate(doc, doc.id, sentence));
        }
        continue;
      }
      // Standalone exemption with no resolvable target — emit prohibited, not required.
      const mod = detectModality(sentence);
      actions.push(
        make({
          kind: "submit",
          title: `${obj ?? "提出物"}は提出不要`,
          object: obj,
          modality: "prohibited",
          actor: mod.actor,
          temporal: primaryTemporal(sentence, ctx),
          evidenceText: sentence,
          conditions: mod.conditions,
        }),
      );
      continue;
    }

    // Blanket negation ("(X の)提出は不要" / "no longer required"). Resolve the
    // target by object identity and attach the negation to THAT Action so the
    // verifier fails it. NEVER attach to the last Action by position. If no target
    // can be identified, emit a prohibited submit (do not resurrect a requirement)
    // or omit — but never contaminate an unrelated Action.
    if (isNegation(sentence)) {
      const negObj = extractObject(sentence);
      const target = negObj
        ? [...actions].reverse().find((a) => targetMatches(a, negObj))
        : undefined;
      if (target) {
        target.conditions = [
          ...new Set([...(target.conditions ?? []), sentence.replace(/[。．.]$/, "")]),
        ];
        if (!target.evidence.some((e) => e.text === sentence)) {
          target.evidence.push(locate(doc, doc.id, sentence));
        }
        continue;
      }
      if (/提出|submit/i.test(sentence)) {
        const mod = detectModality(sentence);
        actions.push(
          make({
            kind: "submit",
            title: `${negObj ?? "提出物"}は提出不要`,
            object: negObj,
            modality: "prohibited",
            actor: mod.actor,
            temporal: primaryTemporal(sentence, ctx),
            evidenceText: sentence,
            conditions: mod.conditions,
          }),
        );
      }
      // Non-submit negation with no identifiable target → omit (do not mis-attach).
      continue;
    }

    const kind = detectKind(sentence) as ActionKind;
    const mod = detectModality(sentence);
    const temporal = primaryTemporal(sentence, ctx);
    const object = extractObject(sentence);

    let title: string;
    if (kind === "event") title = eventTitle(sentence);
    else if (kind === "submit") title = object ? `${object}を提出する` : "提出する";
    else if (kind === "prepare") title = object ? `${object}を持参する` : sentence.slice(0, 40);
    else if (kind === "pay") title = object ? `${object}を支払う` : "支払う";
    else title = sentence.replace(/[。．.]$/, "").slice(0, 48);

    // Skip purely narrative sentences with no action cue
    if (kind === "other" && mod.modality === "unknown" && !temporal) continue;

    const conditions = [...mod.conditions];
    if (/参加を希望する方/.test(sentence)) {
      conditions.unshift("参加を希望する");
    }

    actions.push(
      make({
        kind,
        title,
        object,
        modality: mod.modality === "unknown" && kind === "event" ? "required" : mod.modality,
        actor: mod.actor,
        temporal,
        evidenceText: sentence,
        conditions: conditions.length ? conditions : undefined,
      }),
    );
  }

  // Cross-sentence cancellation: a cancellation sentence deactivates a matching
  // Action created by an earlier sentence, without touching unrelated Actions.
  let result = actions;
  if (cancellationSentences.length > 0) {
    const subjects = [...new Set(cancellationSentences.flatMap(cancellationSubjects))];
    if (subjects.length > 0) {
      result = result.filter((a) => !subjects.some((s) => actionMatchesSubject(a, s)));
    }
  }

  return result.map((a, i) => ({ ...a, id: newActionId(i) }));
}
