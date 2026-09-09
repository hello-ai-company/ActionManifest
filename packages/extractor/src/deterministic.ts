import {
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

function isExemption(text: string): boolean {
  return (
    /再提出する必要はありません|前回(?:すでに|既に)?.{0,16}提出した方は不要|提出不要/.test(text) ||
    /already submitted.{0,40}not (?:need|required)/i.test(text)
  );
}

function mergeTemporal(event: Action, alt: Temporal, evidenceText: string): void {
  const t = event.temporal ?? { type: "unknown" as const, raw_text: alt.raw_text };
  const alternatives = [...(t.alternatives ?? []), alt];
  event.temporal = { ...t, alternatives };
  if (!event.evidence.some((e) => e.text === evidenceText)) {
    event.evidence.push({ source_id: event.evidence[0]!.source_id, text: evidenceText });
  }
}

export function extractDeterministically(doc: CanonicalDocument): Action[] {
  const source = doc.text ?? "";
  const ctx = extractYearContext(source);
  const sentences = splitSentences(source);
  const actions: Action[] = [];

  const make = (
    partial: Omit<Action, "id" | "status" | "inference" | "evidence"> & {
      evidenceText: string;
      extraEvidence?: string[];
      inference?: Action["inference"];
    },
  ): Action => {
    const evidence = [
      { source_id: doc.id, page: 1, text: partial.evidenceText },
      ...(partial.extraEvidence ?? []).map((text) => ({
        source_id: doc.id,
        page: 1,
        text,
      })),
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
    if (isCancellationContext(sentence)) continue;
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
        mergeTemporal(event, alt, sentence);
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
      const obj = extractObject(sentence) ?? "提出物";
      const submit = [...actions]
        .reverse()
        .find((a) => a.kind === "submit" && (!a.object || obj.includes(a.object) || a.object.includes(obj.replace(/再/, "")) || a.title.includes("提出")));
      const condition =
        sentence.match(/前回すでに参加確認票を提出した方は、再提出する必要はありません。?/)?.[0] ??
        sentence;
      if (submit) {
        submit.conditions = [
          ...new Set([...(submit.conditions ?? []), "前回すでに提出した方は再提出不要", condition.replace(/[。．.]$/, "")]),
        ];
        if (!submit.evidence.some((e) => e.text === sentence)) {
          submit.evidence.push({ source_id: doc.id, page: 1, text: sentence });
        }
        continue;
      }
      // Standalone "提出不要" — emit prohibited submit, not a required task.
      const mod = detectModality(sentence);
      actions.push(
        make({
          kind: "submit",
          title: `${obj}は提出不要`,
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

    if (isNegation(sentence) && actions.length > 0) {
      const last = actions[actions.length - 1]!;
      last.conditions = [...new Set([...(last.conditions ?? []), sentence.replace(/[。．.]$/, "")])];
      if (!last.evidence.some((e) => e.text === sentence)) {
        last.evidence.push({ source_id: doc.id, page: 1, text: sentence });
      }
      continue;
    }

    if (isNegation(sentence) && /提出/.test(sentence)) {
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

  return actions.map((a, i) => ({ ...a, id: newActionId(i) }));
}
