import type { DocumentCitation } from "./document-query.js";

/** Display hints, never extracted obligations, inferred identities or execution grants. */
export const FAMILY_DOMAINS = ["school", "lessons", "childcare", "health", "travel", "homework", "library", "safety", "household", "other"] as const;
export type FamilyDomain = typeof FAMILY_DOMAINS[number];
export const FAMILY_TOPICS = ["schedule", "deadline", "requirements", "submission", "reservation", "contact", "cost", "other"] as const;
export type FamilyTopic = typeof FAMILY_TOPICS[number];
export type FamilyReviewFlag = "conditional" | "negated" | "revision" | "relative_date";
export interface FamilyReviewOptions {
  domain?: FamilyDomain;
  topic?: FamilyTopic;
  /** Explicit local user label only. Never inferred from source text or used to filter evidence. */
  memberLabel?: string;
  offset?: number;
  limit?: number;
  signal?: AbortSignal;
}
export interface FamilyReviewItem {
  citation: DocumentCitation;
  context: DocumentCitation[];
  domains: FamilyDomain[];
  topics: FamilyTopic[];
  /** Cues anywhere in the returned context, not a semantic determination. */
  flags: FamilyReviewFlag[];
  requiresReview: true;
}
export interface FamilyReview {
  mode: "local-family-evidence";
  sourceId: string;
  snapshotHash: string;
  member: { status: "unassigned" | "user_selected"; label?: string; sourceIdentityVerified: false };
  items: FamilyReviewItem[];
  coverage: { indexedCharacters: number; indexedPassages: number; candidatePassages: number; unmatchedPassages: number; matchingPassages: number; returnedPassages: number; offset: number; hasMore: boolean; nextOffset?: number; completeUnderstanding: false };
  warnings: string[];
}
export interface FamilyReviewAnnotation {
  kind: "user_annotation";
  citation: DocumentCitation;
  domain?: FamilyDomain;
  topic?: FamilyTopic;
  memberLabel?: string;
  note?: string;
}
// Shared cue strings are deliberately compatible with Foundation NSRegularExpression.
export const FAMILY_DOMAIN_PATTERNS: Record<Exclude<FamilyDomain, "other">, string> = {
  school: "学校|小学校|中学校|高校|授業|登校|下校|保護者会|(?<![a-z0-9_])school(?![a-z0-9_])|(?<![a-z0-9_])classroom(?![a-z0-9_])",
  lessons: "習い事|塾|教室|レッスン|ピアノ|水泳|(?<![a-z0-9_])lesson(?![a-z0-9_])|(?<![a-z0-9_])tutoring(?![a-z0-9_])",
  childcare: "保育|幼稚園|こども園|送迎|お迎え|(?<![a-z0-9_])nursery(?![a-z0-9_])|(?<![a-z0-9_])kindergarten(?![a-z0-9_])|(?<![a-z0-9_])daycare(?![a-z0-9_])",
  health: "病院|医院|クリニック|受診|診療|予防接種|健診|薬|(?<![a-z0-9_])hospital(?![a-z0-9_])|(?<![a-z0-9_])clinic(?![a-z0-9_])|(?<![a-z0-9_])doctor(?![a-z0-9_])|(?<![a-z0-9_])medical(?![a-z0-9_])",
  travel: "旅行|旅程|宿泊|ホテル|航空|飛行機|新幹線|パスポート|(?<![a-z0-9_])travel(?![a-z0-9_])|(?<![a-z0-9_])flight(?![a-z0-9_])|(?<![a-z0-9_])hotel(?![a-z0-9_])|(?<![a-z0-9_])passport(?![a-z0-9_])",
  homework: "宿題|課題|自由研究|家庭学習|(?<![a-z0-9_])homework(?![a-z0-9_])|(?<![a-z0-9_])assignment(?![a-z0-9_])",
  library: "図書館|図書室|貸出|返却|貸し出し|(?<![a-z0-9_])library(?![a-z0-9_])|(?<![a-z0-9_])borrow(?![a-z0-9_])",
  safety: "警察|交番|防災|避難|消防|事故|緊急|迷子|(?<![a-z0-9_])police(?![a-z0-9_])|(?<![a-z0-9_])emergency(?![a-z0-9_])|(?<![a-z0-9_])evacuation(?![a-z0-9_])",
  household: "家事|掃除|ごみ|ゴミ|買い物|食事|家計|介護|ペット|(?<![a-z0-9_])household(?![a-z0-9_])|(?<![a-z0-9_])chore(?![a-z0-9_])|(?<![a-z0-9_])grocery(?![a-z0-9_])|(?<![a-z0-9_])caregiving(?![a-z0-9_])|(?<![a-z0-9_])pet(?![a-z0-9_])",
};
export const FAMILY_TOPIC_PATTERNS: Record<Exclude<FamilyTopic, "other">, string> = {
  schedule: "日時|日程|予定|開催|集合|出発|開始|開館|休館|(?<![a-z0-9_])schedule(?![a-z0-9_])|(?<![a-z0-9_])meeting(?![a-z0-9_])|(?<![a-z0-9_])start(?![a-z0-9_])",
  deadline: "締切|締め切り|期限|期日|提出日|申込.*まで|(?<![a-z0-9_])deadline(?![a-z0-9_])|(?<![a-z0-9_])due(?![a-z0-9_])|(?<![a-z0-9_])by\\s+[0-9]",
  requirements: "必要|持ち物|用意|準備|手順|必須|(?<![a-z0-9_])required(?![a-z0-9_])|(?<![a-z0-9_])must(?![a-z0-9_])|(?<![a-z0-9_])bring(?![a-z0-9_])|(?<![a-z0-9_])steps?(?![a-z0-9_])",
  submission: "提出|申請|届出|申し込み|申込|同意書|(?<![a-z0-9_])submit|(?<![a-z0-9_])submission(?![a-z0-9_])|(?<![a-z0-9_])application(?![a-z0-9_])|(?<![a-z0-9_])consent(?![a-z0-9_])",
  reservation: "予約|予約変更|キャンセル|予約取消|(?<![a-z0-9_])reservation(?![a-z0-9_])|(?<![a-z0-9_])booking(?![a-z0-9_])|(?<![a-z0-9_])appointment(?![a-z0-9_])",
  contact: "連絡先|問い合わせ|問合せ|電話|メール|担当|(?<![a-z0-9_])contact(?![a-z0-9_])|(?<![a-z0-9_])email(?![a-z0-9_])|(?<![a-z0-9_])phone(?![a-z0-9_])|[a-z0-9_.+-]+@[a-z0-9_.-]+\\.[a-z]{2,}",
  cost: "料金|費用|金額|参加費|支払|円|無料|(?<![a-z0-9_])cost(?![a-z0-9_])|(?<![a-z0-9_])fee(?![a-z0-9_])|(?<![a-z0-9_])price(?![a-z0-9_])|(?<![a-z0-9_])payment(?![a-z0-9_])|[$€£¥]",
};
export const FAMILY_FLAG_PATTERNS: Record<FamilyReviewFlag, string> = {
  conditional: "場合|のみ|ただし|但し|除く|対象|希望者|雨天|条件|(?<![a-z0-9_])if(?![a-z0-9_])|(?<![a-z0-9_])unless(?![a-z0-9_])|(?<![a-z0-9_])except(?![a-z0-9_])|(?<![a-z0-9_])only(?![a-z0-9_])",
  negated: "不要|必要ありません|しない|ありません|禁止|中止|取消|取り消|(?<![a-z0-9_])not(?![a-z0-9_])|(?<![a-z0-9_])no(?![a-z0-9_])|(?<![a-z0-9_])cancel|(?<![a-z0-9_])do not(?![a-z0-9_])",
  revision: "訂正|変更|改訂|旧版|前回|以前|取り消|取消|最新版|修正|更新|(?<![a-z0-9_])correct|(?<![a-z0-9_])revis|(?<![a-z0-9_])supersed|(?<![a-z0-9_])previous(?![a-z0-9_])|(?<![a-z0-9_])updated(?![a-z0-9_])",
  relative_date: "今日|明日|明後日|昨日|来週|今週|来月|今月|翌日|翌週|後日|[0-9]+日後|(?<![a-z0-9_])today(?![a-z0-9_])|(?<![a-z0-9_])tomorrow(?![a-z0-9_])|(?<![a-z0-9_])yesterday(?![a-z0-9_])|(?<![a-z0-9_])next week(?![a-z0-9_])|(?<![a-z0-9_])next month(?![a-z0-9_])|(?<![a-z0-9_])in [0-9]+ days",
};
const domains = Object.entries(FAMILY_DOMAIN_PATTERNS).map(([key, value]) => [key as FamilyDomain, new RegExp(value, "iu")] as const);
const topics = Object.entries(FAMILY_TOPIC_PATTERNS).map(([key, value]) => [key as FamilyTopic, new RegExp(value, "iu")] as const);
const flags = Object.entries(FAMILY_FLAG_PATTERNS).map(([key, value]) => [key as FamilyReviewFlag, new RegExp(value, "iu")] as const);
function normalized(text: string): string { return text.normalize("NFKC").toLowerCase(); }
export function classifyFamilyPassage(quote: string, context: string): { domains: FamilyDomain[]; topics: FamilyTopic[]; flags: FamilyReviewFlag[]; candidate: boolean } {
  const text = normalized(quote);
  const foundDomains = domains.filter(([, regex]) => regex.test(text)).map(([key]) => key);
  const foundTopics = topics.filter(([, regex]) => regex.test(text)).map(([key]) => key);
  const contextText = normalized(context);
  const foundFlags = flags.filter(([, regex]) => regex.test(contextText)).map(([key]) => key);
  return { domains: foundDomains.length ? foundDomains : ["other"], topics: foundTopics.length ? foundTopics : ["other"], flags: foundFlags, candidate: foundDomains.length > 0 || foundTopics.length > 0 };
}
export function validateFamilyLabel(value: unknown, maximum: number): void {
  if (value !== undefined && (typeof value !== "string" || value.length > maximum || Array.from(value).some(c => { const code = c.charCodeAt(0); return code < 32 && code !== 9 && code !== 10 && code !== 13; }))) throw new RangeError("Invalid local review label");
}
