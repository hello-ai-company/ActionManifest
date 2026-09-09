import type { Actor, ActorCertainty, Modality } from "@actionmanifest/core";
import { isNegation } from "./parse.js";

export interface ModalityHit {
  modality: Modality;
  actor: Actor;
  conditions: string[];
  negated: boolean;
  cues: string[];
}

const CONDITION_CUES: Array<{ re: RegExp; label: string }> = [
  { re: /希望者のみ|参加を希望する方|希望する方/, label: "希望者のみ" },
  { re: /参加者のみ|参加する方/, label: "参加者のみ" },
  { re: /各自持参/, label: "各自持参" },
  { re: /当日徴収/, label: "当日徴収" },
  { re: /後日提出/, label: "後日提出" },
  { re: /前回(?:すでに|既に)?(?:.{0,12})提出した方は(?:再提出)?(?:する)?必要はありません|前回提出した方は不要/, label: "前回提出した方は不要" },
  { re: /applicants only|those who wish|optional for/i, label: "applicants only" },
  { re: /participants only/i, label: "participants only" },
  { re: /already submitted/i, label: "already submitted — no resubmit" },
];

export function detectModality(text: string): ModalityHit {
  const cues: string[] = [];
  const conditions: string[] = [];
  const negated = isNegation(text);

  for (const c of CONDITION_CUES) {
    if (c.re.test(text)) {
      cues.push(c.label);
      conditions.push(c.label);
    }
  }

  let modality: Modality = "unknown";
  if (negated || /提出不要/.test(text)) {
    modality = "prohibited";
    cues.push("negation");
  } else if (/必須|必ず|してください|すること|必着/.test(text) || /must|required|please submit/i.test(text)) {
    modality = "required";
    cues.push("imperative");
  } else if (/推奨|望ましい|おすすめ/.test(text) || /recommended|should/i.test(text)) {
    modality = "recommended";
  } else if (/任意|希望者のみ/.test(text) || /optional/i.test(text)) {
    modality = "optional";
  } else if (/各自持参|持参してください/.test(text)) {
    modality = "required";
  } else if (/当日徴収/.test(text)) {
    modality = "required";
  }

  if (conditions.includes("希望者のみ") && modality === "required") {
    // Conditional requirement: still required for eligible people.
    conditions.push("参加希望者に限り必須");
  }

  let certainty: ActorCertainty = "unknown";
  let actorText: string | undefined;
  let role: string | undefined;

  if (/希望者|those who wish|applicants/i.test(text)) {
    certainty = "explicit";
    actorText = text.match(/参加を希望する方|希望者|those who wish to participate|applicants/i)?.[0];
    role = "applicant";
  } else if (/参加者|participants/i.test(text)) {
    certainty = "explicit";
    actorText = text.match(/参加者|participants/i)?.[0];
    role = "participant";
  } else if (/保護者|保護者の方/.test(text)) {
    certainty = "explicit";
    actorText = "保護者";
    role = "guardian";
  } else if (/各自/.test(text)) {
    certainty = "implicit";
    role = "participant";
  }

  const actor: Actor = {
    certainty,
    ...(actorText ? { text: actorText } : {}),
    ...(role ? { role } : {}),
  };

  return { modality, actor, conditions, negated, cues };
}

export function detectKind(text: string): string {
  if (/提出不要|再提出する必要はありません/.test(text) && /提出/.test(text)) return "submit";
  if (/提出|郵送|submit|application form|confirmation slip|file the return/i.test(text)) return "submit";
  if (/持参|用意|prepare|bring/i.test(text)) return "prepare";
  if (/支払|納入|徴収|振込|振り込|pay|fee|invoice/i.test(text)) return "pay";
  if (/署名|押印|サイン|sign the /i.test(text)) return "sign";
  if (/返信|回答|reply|respond|rsvp/i.test(text)) return "reply";
  if (/問い合わせ|連絡してください|contact us/i.test(text)) return "contact";
  if (/確認してください|ご確認|review the|please review/i.test(text)) return "review";
  if (/お読み|一読|read /i.test(text)) return "read";
  if (/出席|please attend|参加してください/.test(text)) return "attend";
  if (
    /実施|開催|遠足|行事|運動会|健康診断|発表会|保護者会|説明会|イベント|office move|open house|inspection|will (?:be )?held|takes place/i.test(
      text,
    )
  ) {
    return "event";
  }
  if (/締切|期限|deadline|due /i.test(text)) return "deadline";
  return "other";
}
