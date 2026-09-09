import { mkdir, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

interface Spec {
  id: string;
  language: "ja" | "en";
  category: string;
  tags?: string[];
  golden?: boolean;
  input: string;
  expected: unknown;
}

const fixtures: Spec[] = [
  {
    id: "school-golden-excursion",
    language: "ja",
    category: "school",
    tags: ["golden", "negation", "conditional", "rain"],
    golden: true,
    input: `令和8年10月15日に秋の遠足を実施します。
参加を希望する方は、10月5日までに参加確認票を提出してください。
当日は弁当、水筒、タオルを持参してください。
雨天の場合は10月22日に延期します。
前回すでに参加確認票を提出した方は、再提出する必要はありません。
`,
    expected: {
      actions: [
        {
          id: "act_001",
          kind: "event",
          title: "秋の遠足を実施する",
          modality: "required",
          actor: { certainty: "unknown" },
          temporal: {
            type: "exact",
            date: "2026-10-15",
            year: 2026,
            month: 10,
            day: 15,
            precision: "day",
            raw_text: "令和8年10月15日",
            certainty: "high",
            alternatives: [
              {
                type: "conditional",
                date: "2026-10-22",
                year: 2026,
                month: 10,
                day: 22,
                precision: "day",
                raw_text: "雨天の場合は10月22日に延期します",
                condition: "雨天",
                certainty: "high",
              },
            ],
          },
          evidence: [
            {
              source_id: "school-golden-excursion",
              page: 1,
              text: "令和8年10月15日に秋の遠足を実施します。",
            },
            {
              source_id: "school-golden-excursion",
              page: 1,
              text: "雨天の場合は10月22日に延期します。",
            },
          ],
          inference: "explicit",
          status: "proposed",
        },
        {
          id: "act_002",
          kind: "submit",
          title: "参加確認票を提出する",
          object: "参加確認票",
          modality: "required",
          actor: {
            text: "参加を希望する方",
            role: "applicant",
            certainty: "explicit",
          },
          temporal: {
            type: "exact",
            date: "2026-10-05",
            year: 2026,
            month: 10,
            day: 5,
            precision: "day",
            raw_text: "10月5日まで",
            deadline_qualifier: "until",
            end: "2026-10-05",
            certainty: "high",
          },
          evidence: [
            {
              source_id: "school-golden-excursion",
              page: 1,
              text: "参加を希望する方は、10月5日までに参加確認票を提出してください。",
            },
            {
              source_id: "school-golden-excursion",
              page: 1,
              text: "前回すでに参加確認票を提出した方は、再提出する必要はありません。",
            },
          ],
          inference: "explicit",
          status: "proposed",
          conditions: [
            "参加を希望する",
            "希望者のみ",
            "参加希望者に限り必須",
            "前回すでに提出した方は再提出不要",
            "前回すでに参加確認票を提出した方は、再提出する必要はありません",
          ],
        },
        {
          id: "act_003",
          kind: "prepare",
          title: "弁当、水筒、タオルを持参する",
          object: "弁当、水筒、タオル",
          modality: "required",
          actor: { certainty: "unknown" },
          temporal: {
            type: "relative",
            precision: "day",
            raw_text: "当日",
            deadline_qualifier: "on_day",
            certainty: "medium",
          },
          evidence: [
            {
              source_id: "school-golden-excursion",
              page: 1,
              text: "当日は弁当、水筒、タオルを持参してください。",
            },
          ],
          inference: "explicit",
          status: "proposed",
        },
      ],
    },
  },
  {
    id: "school-reiwa-date",
    language: "ja",
    category: "school",
    tags: ["temporal", "reiwa"],
    input: `令和8年10月5日に保護者会を実施します。会場は体育館です。\n`,
    expected: {
      actions: [
        {
          id: "act_001",
          kind: "event",
          title: "保護者会を実施する",
          modality: "required",
          actor: { certainty: "unknown" },
          temporal: {
            type: "exact",
            date: "2026-10-05",
            year: 2026,
            month: 10,
            day: 5,
            precision: "day",
            raw_text: "令和8年10月5日",
            certainty: "high",
          },
          evidence: [
            {
              source_id: "school-reiwa-date",
              page: 1,
              text: "令和8年10月5日に保護者会を実施します。",
            },
          ],
          inference: "explicit",
          status: "proposed",
        },
      ],
    },
  },
  {
    id: "school-deadline-until",
    language: "ja",
    category: "school",
    tags: ["deadline"],
    input: `令和8年度の写真販売です。10月5日までに申込書を提出してください。\n`,
    expected: {
      actions: [
        {
          id: "act_001",
          kind: "submit",
          title: "申込書を提出する",
          object: "申込書",
          modality: "required",
          actor: { certainty: "unknown" },
          temporal: {
            type: "exact",
            date: "2026-10-05",
            month: 10,
            day: 5,
            year: 2026,
            precision: "day",
            raw_text: "10月5日まで",
            deadline_qualifier: "until",
            end: "2026-10-05",
            certainty: "high",
          },
          evidence: [
            {
              source_id: "school-deadline-until",
              page: 1,
              text: "10月5日までに申込書を提出してください。",
            },
          ],
          inference: "explicit",
          status: "proposed",
        },
      ],
    },
  },
  {
    id: "school-early-october",
    language: "ja",
    category: "school",
    tags: ["ambiguity", "approximate"],
    input: `運動会の詳細は10月上旬にお知らせします。現時点で提出物はありません。\n`,
    expected: {
      actions: [
        {
          id: "act_001",
          kind: "event",
          title: "運動会の詳細連絡",
          modality: "unknown",
          actor: { certainty: "unknown" },
          temporal: {
            type: "approximate",
            month: 10,
            decade: "early",
            precision: "decade_of_month",
            raw_text: "10月上旬",
            certainty: "medium",
          },
          evidence: [
            {
              source_id: "school-early-october",
              page: 1,
              text: "運動会の詳細は10月上旬にお知らせします。",
            },
          ],
          inference: "explicit",
          status: "proposed",
        },
      ],
    },
  },
  {
    id: "school-around-october",
    language: "ja",
    category: "school",
    tags: ["ambiguity", "hallucination-guard"],
    input: `健康診断は10月頃の予定です。日程が決まり次第ご連絡します。\n`,
    expected: {
      actions: [
        {
          id: "act_001",
          kind: "event",
          title: "健康診断",
          modality: "unknown",
          actor: { certainty: "unknown" },
          temporal: {
            type: "approximate",
            month: 10,
            precision: "month",
            raw_text: "10月頃",
            certainty: "low",
          },
          evidence: [
            {
              source_id: "school-around-october",
              page: 1,
              text: "健康診断は10月頃の予定です。",
            },
          ],
          inference: "explicit",
          status: "proposed",
        },
      ],
    },
  },
  {
    id: "school-rain-postponement",
    language: "ja",
    category: "school",
    tags: ["conditional"],
    input: `令和8年10月12日に校外学習を実施します。雨天順延とします。\n`,
    expected: {
      actions: [
        {
          id: "act_001",
          kind: "event",
          title: "校外学習を実施する",
          modality: "required",
          actor: { certainty: "unknown" },
          temporal: {
            type: "exact",
            date: "2026-10-12",
            year: 2026,
            month: 10,
            day: 12,
            precision: "day",
            raw_text: "令和8年10月12日",
            certainty: "high",
          },
          evidence: [
            {
              source_id: "school-rain-postponement",
              page: 1,
              text: "令和8年10月12日に校外学習を実施します。",
            },
          ],
          inference: "explicit",
          status: "proposed",
        },
      ],
    },
  },
  {
    id: "school-backup-date",
    language: "ja",
    category: "event",
    tags: ["conditional"],
    input: `発表会は令和8年11月3日です。予備日は11月4日です。\n`,
    expected: {
      actions: [
        {
          id: "act_001",
          kind: "event",
          title: "発表会",
          modality: "required",
          actor: { certainty: "unknown" },
          temporal: {
            type: "exact",
            date: "2026-11-03",
            year: 2026,
            month: 11,
            day: 3,
            precision: "day",
            raw_text: "令和8年11月3日",
            certainty: "high",
          },
          evidence: [
            {
              source_id: "school-backup-date",
              page: 1,
              text: "発表会は令和8年11月3日です。",
            },
          ],
          inference: "explicit",
          status: "proposed",
        },
      ],
    },
  },
  {
    id: "gov-must-arrive",
    language: "ja",
    category: "government",
    tags: ["deadline", "must-arrive"],
    input: `令和8年10月10日必着で申請書を提出してください。\n`,
    expected: {
      actions: [
        {
          id: "act_001",
          kind: "submit",
          title: "申請書を提出する",
          object: "申請書",
          modality: "required",
          actor: { certainty: "unknown" },
          temporal: {
            type: "exact",
            date: "2026-10-10",
            year: 2026,
            month: 10,
            day: 10,
            precision: "day",
            raw_text: "令和8年10月10日",
            deadline_qualifier: "must_arrive",
            certainty: "high",
          },
          evidence: [
            {
              source_id: "gov-must-arrive",
              page: 1,
              text: "令和8年10月10日必着で申請書を提出してください。",
            },
          ],
          inference: "explicit",
          status: "proposed",
        },
      ],
    },
  },
  {
    id: "gov-postmark-valid",
    language: "ja",
    category: "government",
    tags: ["deadline", "postmark"],
    input: `届は令和8年10月20日消印有効です。必要書類を郵送してください。\n`,
    expected: {
      actions: [
        {
          id: "act_001",
          kind: "submit",
          title: "必要書類を提出する",
          modality: "required",
          actor: { certainty: "unknown" },
          temporal: {
            type: "exact",
            date: "2026-10-20",
            year: 2026,
            month: 10,
            day: 20,
            precision: "day",
            raw_text: "令和8年10月20日",
            deadline_qualifier: "postmark_valid",
            certainty: "high",
          },
          evidence: [
            {
              source_id: "gov-postmark-valid",
              page: 1,
              text: "届は令和8年10月20日消印有効です。",
            },
          ],
          inference: "explicit",
          status: "proposed",
        },
      ],
    },
  },
  {
    id: "school-applicants-only",
    language: "ja",
    category: "school",
    tags: ["modality", "optional"],
    input: `英語クラブは希望者のみ参加できます。申込書を提出してください。\n`,
    expected: {
      actions: [
        {
          id: "act_001",
          kind: "submit",
          title: "申込書を提出する",
          object: "申込書",
          modality: "required",
          actor: { certainty: "explicit", text: "希望者", role: "applicant" },
          evidence: [
            {
              source_id: "school-applicants-only",
              page: 1,
              text: "申込書を提出してください。",
            },
          ],
          inference: "explicit",
          status: "proposed",
          conditions: ["希望者のみ"],
        },
      ],
    },
  },
  {
    id: "event-participants-only",
    language: "ja",
    category: "event",
    tags: ["modality"],
    input: `参加者のみ会場地図を配布します。地図が必要な方は受付までお越しください。\n`,
    expected: {
      actions: [
        {
          id: "act_001",
          kind: "other",
          title: "会場地図の配布",
          modality: "unknown",
          actor: { certainty: "explicit", text: "参加者", role: "participant" },
          evidence: [
            {
              source_id: "event-participants-only",
              page: 1,
              text: "参加者のみ会場地図を配布します。",
            },
          ],
          inference: "explicit",
          status: "proposed",
          conditions: ["参加者のみ"],
        },
      ],
    },
  },
  {
    id: "school-bring-own",
    language: "ja",
    category: "school",
    tags: ["prepare"],
    input: `図工の時間は各自持参で鉛筆と消しゴムを用意してください。\n`,
    expected: {
      actions: [
        {
          id: "act_001",
          kind: "prepare",
          title: "鉛筆と消しゴムを持参する",
          modality: "required",
          actor: { certainty: "implicit", role: "participant" },
          evidence: [
            {
              source_id: "school-bring-own",
              page: 1,
              text: "図工の時間は各自持参で鉛筆と消しゴムを用意してください。",
            },
          ],
          inference: "explicit",
          status: "proposed",
          conditions: ["各自持参"],
        },
      ],
    },
  },
  {
    id: "event-collect-on-day",
    language: "ja",
    category: "event",
    tags: ["pay"],
    input: `参加費500円は当日徴収します。事前の振込は不要です。\n`,
    expected: {
      actions: [
        {
          id: "act_001",
          kind: "pay",
          title: "参加費を支払う",
          object: "参加費",
          modality: "required",
          actor: { certainty: "unknown" },
          temporal: {
            type: "relative",
            raw_text: "当日",
            precision: "day",
            deadline_qualifier: "on_day",
            certainty: "medium",
          },
          evidence: [
            {
              source_id: "event-collect-on-day",
              page: 1,
              text: "参加費500円は当日徴収します。",
            },
          ],
          inference: "explicit",
          status: "proposed",
          conditions: ["当日徴収"],
        },
      ],
    },
  },
  {
    id: "workplace-submit-later",
    language: "ja",
    category: "workplace",
    tags: ["relative"],
    input: `報告書は後日提出してください。当日は口頭共有のみです。\n`,
    expected: {
      actions: [
        {
          id: "act_001",
          kind: "submit",
          title: "報告書を提出する",
          object: "報告書",
          modality: "required",
          actor: { certainty: "unknown" },
          temporal: {
            type: "relative",
            raw_text: "後日",
            precision: "unknown",
            deadline_qualifier: "later",
            certainty: "low",
          },
          evidence: [
            {
              source_id: "workplace-submit-later",
              page: 1,
              text: "報告書は後日提出してください。",
            },
          ],
          inference: "explicit",
          status: "proposed",
          conditions: ["後日提出"],
        },
      ],
    },
  },
  {
    id: "gov-no-submit-needed",
    language: "ja",
    category: "government",
    tags: ["negation", "prohibited"],
    input: `今回の変更届は提出不要です。前回の内容を継続します。\n`,
    expected: {
      actions: [
        {
          id: "act_001",
          kind: "submit",
          title: "変更届は提出不要",
          object: "変更届",
          modality: "prohibited",
          actor: { certainty: "unknown" },
          evidence: [
            {
              source_id: "gov-no-submit-needed",
              page: 1,
              text: "今回の変更届は提出不要です。",
            },
          ],
          inference: "explicit",
          status: "proposed",
        },
      ],
    },
  },
  {
    id: "school-already-submitted",
    language: "ja",
    category: "school",
    tags: ["negation"],
    input: `身体測定の同意書について、前回提出した方は不要です。未提出の方のみ提出してください。\n`,
    expected: {
      actions: [
        {
          id: "act_001",
          kind: "submit",
          title: "同意書を提出する",
          object: "同意書",
          modality: "required",
          actor: { certainty: "unknown" },
          evidence: [
            {
              source_id: "school-already-submitted",
              page: 1,
              text: "未提出の方のみ提出してください。",
            },
          ],
          inference: "explicit",
          status: "proposed",
          conditions: ["前回提出した方は不要"],
        },
      ],
    },
  },
  {
    id: "invoice-pay-jp",
    language: "ja",
    category: "invoice",
    tags: ["pay"],
    input: `請求書です。令和8年10月31日までに請求金額を振り込んでください。\n`,
    expected: {
      actions: [
        {
          id: "act_001",
          kind: "pay",
          title: "請求金額を支払う",
          object: "請求金額",
          modality: "required",
          actor: { certainty: "unknown" },
          temporal: {
            type: "exact",
            date: "2026-10-31",
            year: 2026,
            month: 10,
            day: 31,
            precision: "day",
            raw_text: "令和8年10月31日まで",
            deadline_qualifier: "until",
            certainty: "high",
          },
          evidence: [
            {
              source_id: "invoice-pay-jp",
              page: 1,
              text: "令和8年10月31日までに請求金額を振り込んでください。",
            },
          ],
          inference: "explicit",
          status: "proposed",
        },
      ],
    },
  },
  {
    id: "housing-contract-jp",
    language: "ja",
    category: "housing",
    tags: ["sign"],
    input: `賃貸契約書に署名してください。提出期限は令和8年9月30日です。\n`,
    expected: {
      actions: [
        {
          id: "act_001",
          kind: "sign",
          title: "賃貸契約書に署名する",
          object: "賃貸契約書",
          modality: "required",
          actor: { certainty: "unknown" },
          temporal: {
            type: "exact",
            date: "2026-09-30",
            year: 2026,
            month: 9,
            day: 30,
            precision: "day",
            raw_text: "令和8年9月30日",
            certainty: "high",
          },
          evidence: [
            {
              source_id: "housing-contract-jp",
              page: 1,
              text: "賃貸契約書に署名してください。",
            },
          ],
          inference: "explicit",
          status: "proposed",
        },
      ],
    },
  },
  {
    id: "insurance-review-jp",
    language: "ja",
    category: "insurance",
    tags: ["review"],
    input: `更新案内です。補償内容をご確認ください。変更がある場合のみ連絡してください。\n`,
    expected: {
      actions: [
        {
          id: "act_001",
          kind: "review",
          title: "補償内容を確認する",
          modality: "required",
          actor: { certainty: "unknown" },
          evidence: [
            {
              source_id: "insurance-review-jp",
              page: 1,
              text: "補償内容をご確認ください。",
            },
          ],
          inference: "explicit",
          status: "proposed",
        },
      ],
    },
  },
  {
    id: "university-deadline-jp",
    language: "ja",
    category: "university",
    tags: ["submit"],
    input: `大学院出願書類を令和8年12月1日までに提出してください。\n`,
    expected: {
      actions: [
        {
          id: "act_001",
          kind: "submit",
          title: "出願書類を提出する",
          object: "出願書類",
          modality: "required",
          actor: { certainty: "unknown" },
          temporal: {
            type: "exact",
            date: "2026-12-01",
            year: 2026,
            month: 12,
            day: 1,
            precision: "day",
            raw_text: "令和8年12月1日まで",
            deadline_qualifier: "until",
            certainty: "high",
          },
          evidence: [
            {
              source_id: "university-deadline-jp",
              page: 1,
              text: "大学院出願書類を令和8年12月1日までに提出してください。",
            },
          ],
          inference: "explicit",
          status: "proposed",
        },
      ],
    },
  },
  {
    id: "workplace-meeting-en",
    language: "en",
    category: "workplace",
    tags: ["event"],
    input: `The team meeting will be held on October 8, 2026 at 10:00 in Conference Room B.\nPlease attend.\n`,
    expected: {
      actions: [
        {
          id: "act_001",
          kind: "event",
          title: "team meeting",
          modality: "required",
          actor: { certainty: "unknown" },
          temporal: {
            type: "exact",
            date: "2026-10-08",
            year: 2026,
            month: 10,
            day: 8,
            precision: "day",
            raw_text: "October 8, 2026",
            certainty: "high",
          },
          evidence: [
            {
              source_id: "workplace-meeting-en",
              page: 1,
              text: "The team meeting will be held on October 8, 2026 at 10:00 in Conference Room B.",
            },
          ],
          inference: "explicit",
          status: "proposed",
        },
      ],
    },
  },
  {
    id: "invoice-payment-en",
    language: "en",
    category: "invoice",
    tags: ["pay"],
    input: `Invoice 1042. Please pay the balance by 2026-11-15. Bank transfer is preferred.\n`,
    expected: {
      actions: [
        {
          id: "act_001",
          kind: "pay",
          title: "pay the balance",
          modality: "required",
          actor: { certainty: "unknown" },
          temporal: {
            type: "exact",
            date: "2026-11-15",
            year: 2026,
            month: 11,
            day: 15,
            precision: "day",
            raw_text: "2026-11-15",
            certainty: "high",
          },
          evidence: [
            {
              source_id: "invoice-payment-en",
              page: 1,
              text: "Please pay the balance by 2026-11-15.",
            },
          ],
          inference: "explicit",
          status: "proposed",
        },
      ],
    },
  },
  {
    id: "event-rsvp-en",
    language: "en",
    category: "event",
    tags: ["optional", "reply"],
    input: `You are invited to the open house on October 20, 2026. RSVP is optional. Applicants only may tour the lab.\n`,
    expected: {
      actions: [
        {
          id: "act_001",
          kind: "event",
          title: "open house",
          modality: "optional",
          actor: { certainty: "unknown" },
          temporal: {
            type: "exact",
            date: "2026-10-20",
            year: 2026,
            month: 10,
            day: 20,
            precision: "day",
            raw_text: "October 20, 2026",
            certainty: "high",
          },
          evidence: [
            {
              source_id: "event-rsvp-en",
              page: 1,
              text: "You are invited to the open house on October 20, 2026.",
            },
          ],
          inference: "explicit",
          status: "proposed",
        },
        {
          id: "act_002",
          kind: "reply",
          title: "RSVP",
          modality: "optional",
          actor: { certainty: "unknown" },
          evidence: [
            {
              source_id: "event-rsvp-en",
              page: 1,
              text: "RSVP is optional.",
            },
          ],
          inference: "explicit",
          status: "proposed",
        },
      ],
    },
  },
  {
    id: "contract-sign-en",
    language: "en",
    category: "contract",
    tags: ["sign"],
    input: `Please sign the service contract and return it by September 30, 2026.\n`,
    expected: {
      actions: [
        {
          id: "act_001",
          kind: "sign",
          title: "sign the service contract",
          object: "service contract",
          modality: "required",
          actor: { certainty: "unknown" },
          temporal: {
            type: "exact",
            date: "2026-09-30",
            year: 2026,
            month: 9,
            day: 30,
            precision: "day",
            raw_text: "September 30, 2026",
            certainty: "high",
          },
          evidence: [
            {
              source_id: "contract-sign-en",
              page: 1,
              text: "Please sign the service contract and return it by September 30, 2026.",
            },
          ],
          inference: "explicit",
          status: "proposed",
        },
      ],
    },
  },
  {
    id: "housing-inspection-en",
    language: "en",
    category: "housing",
    tags: ["review"],
    input: `The annual apartment inspection will take place on November 2, 2026. Please review the checklist.\n`,
    expected: {
      actions: [
        {
          id: "act_001",
          kind: "event",
          title: "apartment inspection",
          modality: "required",
          actor: { certainty: "unknown" },
          temporal: {
            type: "exact",
            date: "2026-11-02",
            year: 2026,
            month: 11,
            day: 2,
            precision: "day",
            raw_text: "November 2, 2026",
            certainty: "high",
          },
          evidence: [
            {
              source_id: "housing-inspection-en",
              page: 1,
              text: "The annual apartment inspection will take place on November 2, 2026.",
            },
          ],
          inference: "explicit",
          status: "proposed",
        },
      ],
    },
  },
  {
    id: "university-application-en",
    language: "en",
    category: "university",
    tags: ["submit"],
    input: `Submit the application form by December 1, 2026. Transcripts must arrive by that date.\n`,
    expected: {
      actions: [
        {
          id: "act_001",
          kind: "submit",
          title: "submit the application form",
          object: "application form",
          modality: "required",
          actor: { certainty: "unknown" },
          temporal: {
            type: "exact",
            date: "2026-12-01",
            year: 2026,
            month: 12,
            day: 1,
            precision: "day",
            raw_text: "December 1, 2026",
            deadline_qualifier: "must_arrive",
            certainty: "high",
          },
          evidence: [
            {
              source_id: "university-application-en",
              page: 1,
              text: "Submit the application form by December 1, 2026.",
            },
          ],
          inference: "explicit",
          status: "proposed",
        },
      ],
    },
  },
  {
    id: "insurance-claim-en",
    language: "en",
    category: "insurance",
    tags: ["submit"],
    input: `If you wish to file a claim, submit the claim form. Those who already submitted a claim form need not resubmit.\n`,
    expected: {
      actions: [
        {
          id: "act_001",
          kind: "submit",
          title: "submit the claim form",
          object: "claim form",
          modality: "required",
          actor: { certainty: "explicit", role: "applicant" },
          evidence: [
            {
              source_id: "insurance-claim-en",
              page: 1,
              text: "If you wish to file a claim, submit the claim form.",
            },
          ],
          inference: "explicit",
          status: "proposed",
          conditions: ["those who wish", "already submitted — no resubmit"],
        },
      ],
    },
  },
  {
    id: "gov-tax-postmark-en",
    language: "en",
    category: "government",
    tags: ["deadline"],
    input: `File the return by April 15, 2026. A postmark by that date is valid. Payment is due on that day.\n`,
    expected: {
      actions: [
        {
          id: "act_001",
          kind: "submit",
          title: "file the return",
          modality: "required",
          actor: { certainty: "unknown" },
          temporal: {
            type: "exact",
            date: "2026-04-15",
            year: 2026,
            month: 4,
            day: 15,
            precision: "day",
            raw_text: "April 15, 2026",
            deadline_qualifier: "postmark_valid",
            certainty: "high",
          },
          evidence: [
            {
              source_id: "gov-tax-postmark-en",
              page: 1,
              text: "File the return by April 15, 2026.",
            },
          ],
          inference: "explicit",
          status: "proposed",
        },
      ],
    },
  },
  {
    id: "en-around-october",
    language: "en",
    category: "workplace",
    tags: ["ambiguity"],
    input: `The office move is planned around October. An exact date will be announced later. Do not book travel yet.\n`,
    expected: {
      actions: [
        {
          id: "act_001",
          kind: "event",
          title: "office move",
          modality: "unknown",
          actor: { certainty: "unknown" },
          temporal: {
            type: "approximate",
            month: 10,
            precision: "month",
            raw_text: "around October",
            certainty: "low",
          },
          evidence: [
            {
              source_id: "en-around-october",
              page: 1,
              text: "The office move is planned around October.",
            },
          ],
          inference: "explicit",
          status: "proposed",
        },
      ],
    },
  },
];

const root = join(dirname(fileURLToPath(import.meta.url)), "../benchmark/fixtures");

for (const f of fixtures) {
  const dir = join(root, f.language, f.id);
  await mkdir(dir, { recursive: true });
  await writeFile(join(dir, "input.txt"), f.input, "utf8");
  await writeFile(join(dir, "expected.json"), JSON.stringify(f.expected, null, 2) + "\n", "utf8");
  await writeFile(
    join(dir, "meta.json"),
    JSON.stringify(
      {
        id: f.id,
        language: f.language,
        category: f.category,
        tags: f.tags ?? [],
        golden: Boolean(f.golden),
      },
      null,
      2,
    ) + "\n",
    "utf8",
  );
}

console.log(`Wrote ${fixtures.length} fixtures to ${root}`);
