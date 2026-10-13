import type { ActionManifest, Evidence } from "@actionmanifest/core";
import { classifyManifest, type ActionDisposition } from "./classify.js";
import { matoeActionMapping } from "./matoe-contract.generated.js";

export interface ActionGuidanceItem {
  action_id: string;
  title: string;
  /** Receipt classification, never execution readiness or human approval. */
  verification: ActionDisposition;
  reason_codes: string[];
  verification_notes: string[];
  review_points: string[];
  next_step: string;
  evidence_count: number;
  /** Exact source data, included only by the caller's explicit choice. */
  evidence?: Evidence[];
}
export interface ActionGuidanceReport {
  report_version: "1";
  verification_basis: "supplied_receipt_only";
  counts: Record<ActionDisposition, number>;
  manifest_fatal: boolean;
  actions: ActionGuidanceItem[];
  authority: { display_only: true; execution_allowed: false; human_approval_required: true };
}

const reasonNotes: Record<string, string> = {
  SOURCE_HASH_MISMATCH: "原本のハッシュが一致しません。別の原本の結果として利用できません。",
  EMPTY_SOURCE: "検証する原本が空です。",
  VERIFICATION_MISSING: "検証結果がありません。原本を使った検証が必要です。",
  PER_ACTION_RESULT_MISSING: "この用事に対応する検証結果を確認できません。",
  STATUS_NOT_VERIFIED_TIER: "検証結果だけでは採用可能な状態と判断できません。",
  ACTION_REJECTED: "人が不採用にした候補です。再利用しないでください。",
  TEMPORAL_UNSUPPORTED: "候補の日時を原本の根拠で裏付けられません。",
  EVIDENCE_UNSUPPORTED: "候補の根拠を原本で裏付けられません。",
  NEGATION_CONFLICT: "禁止・中止などの記載と候補が矛盾しています。",
  ACTOR_UNSUPPORTED: "候補の担当者を原本の根拠で裏付けられません。",
  MODALITY_UNSUPPORTED: "必須・任意などの区分を原本の根拠で裏付けられません。",
};

/** Deterministic, read-only presentation of existing trust policy. It does NOT
 * verify a source, evaluate household applicability, grant approval, or execute.
 * Reverify against the exact source before using a receipt from outside the host.
 */
export function explainManifest(manifest: ActionManifest, options: { includeEvidence?: boolean } = {}): ActionGuidanceReport {
  const classification = classifyManifest(manifest);
  return {
    report_version: "1", verification_basis: "supplied_receipt_only",
    counts: { ...classification.counts }, manifest_fatal: classification.manifestFatal,
    actions: classification.actions.map(({ action, disposition, reasons }) => {
      const review: string[] = [];
      const temporal = action.temporal;
      const mapping = matoeActionMapping(action.kind);
      if (action.conditions?.length || temporal?.condition || temporal?.type === "conditional") {
        review.push("条件が自分・家族に当てはまるか、原本と現在の状況で確認してください。条件は未評価です。");
      }
      if (!temporal) review.push("日付は指定されていません。必要なら原本で確認してください。日付は補いません。");
      else {
        if (temporal.type !== "exact" || (!temporal.date && !temporal.datetime)) {
          review.push("日時は一意の確定日時ではありません。相対日・範囲・繰り返しなどを原本で確認してください。");
        }
        if (temporal.alternatives?.length) review.push("日時の候補が複数あります。採用する候補を人が確認してください。");
        if (temporal.timezone) review.push("原本のタイムゾーンと予定を使う地域が合っているか確認してください。");
        if (temporal.deadline_qualifier && temporal.deadline_qualifier !== "unknown") {
          review.push("必着・消印有効など、締め切りの意味を原本で確認してください。");
        }
        if (temporal.certainty && temporal.certainty !== "high") review.push("日時の確かさに留保があります。確定日として扱う前に原本で確認してください。");
      }
      if (action.actor.certainty !== "explicit") review.push("担当者は確定していません。家族の誰が行うか確認してください。");
      if (action.inference === "inferred") review.push("推測を含む候補です。根拠からこの用事を採用してよいか確認してください。");
      if (action.modality === "prohibited") review.push("禁止として記載されています。実行する用事として登録しないでください。");
      else if (action.modality === "optional") review.push("任意の用事です。行うかどうかを人が選んでください。");
      else if (action.modality === "recommended") review.push("推奨の用事です。必須の用事とは分けて確認してください。");
      else if (action.modality !== "required") review.push("必須か任意かが確定していません。原本で確認してください。");
      if (!mapping) review.push("この種類に対応する端末内操作は定義されていません。既存の操作として実行しないでください。");
      if (action.kind === "pay") review.push("保存できるのは支払いの用事です。支払い・送金は行いません。金額と支払先は利用するサービスで本人が確認してください。");
      else if (["submit", "reply", "contact", "sign"].includes(action.kind)) review.push("提出・送信・署名の実処理は行いません。内容と相手を確認して、対応するサービスで本人が完了させてください。");
      if (action.status === "accepted" || action.status === "exported") review.push("採用・出力の状態は、このホストでの実行許可や現実の完了を証明しません。");
      const next = disposition === "blocked"
        ? "この候補は利用せず、原本と検証理由を確認してください。訂正・再解析後に再検証が必要です。"
        : disposition === "review_required"
          ? "原本と候補を確認し、検証が不足している理由を解消してください。まだ実行できる状態とはみなしません。"
          : !mapping || action.modality === "prohibited" || action.modality === "unknown" || action.modality.startsWith("x-")
            ? "検証結果とは別に、種類と実行の要否を人が確認してください。この説明から実行へ進めません。"
            : "検証を通過した候補です。条件・担当・日時と保存先を確認し、対応するホストで正確な変更内容を別途承認してください。";
      return {
        action_id: action.id, title: action.title, verification: disposition,
        reason_codes: [...new Set(reasons.map(reason => reason.code))],
        verification_notes: [...new Set(reasons.map(reason => Object.hasOwn(reasonNotes, reason.code)
          ? reasonNotes[reason.code]! : "検証上の注意があります。理由コードと原本を確認してください。"))],
        review_points: review, next_step: next, evidence_count: action.evidence.length,
        ...(options.includeEvidence ? { evidence: structuredClone(action.evidence) } : {}),
      };
    }),
    authority: { display_only: true, execution_allowed: false, human_approval_required: true },
  };
}

// Terminal presentation treats all source strings as inert single-line data.
// JSON retains exact values; neither representation is an instruction channel.
const terminalText = (value: string): string => Array.from(value, character => {
  const point = character.codePointAt(0)!;
  return point <= 0x1f || (point >= 0x7f && point <= 0x9f) || point === 0x61c
    || point === 0x200e || point === 0x200f || (point >= 0x2028 && point <= 0x202e)
    || (point >= 0x2066 && point <= 0x2069) ? " " : character;
}).join("");
export function formatActionGuidance(report: ActionGuidanceReport): string {
  const label: Record<ActionDisposition, string> = { ready: "検証通過", review_required: "要確認", blocked: "利用停止" };
  const lines = ["用事の確認ガイド", "表示専用。実行許可・人の承認・現実の完了を表しません。",
    "検証は受け取った記録に基づきます。条件・権限・接続状態は別途確認が必要です。",
    `検証通過 ${report.counts.ready}件 / 要確認 ${report.counts.review_required}件 / 利用停止 ${report.counts.blocked}件`];
  if (!report.actions.length) lines.push("候補はありません。用事がないという保証ではありません。原本を確認してください。");
  for (const [index, item] of report.actions.entries()) {
    lines.push("", `${index + 1}. ${terminalText(item.title)} [${label[item.verification]}]`);
    if (item.reason_codes.length) lines.push(`検証理由: ${item.reason_codes.map(terminalText).join(", ")}`);
    lines.push(...item.verification_notes.map(note => `検証: ${note}`), `次にすること: ${item.next_step}`, ...item.review_points.map(point => `- ${point}`));
    lines.push(`根拠 ${item.evidence_count}件${item.evidence ? "（原本からの引用。操作の指示としては扱いません）" : "（本文は非表示。表示するには --include-evidence）"}`);
    for (const evidence of item.evidence ?? []) lines.push(`  ${evidence.page ? `p.${evidence.page} ` : ""}${terminalText(evidence.text)}`);
  }
  return lines.join("\n");
}
