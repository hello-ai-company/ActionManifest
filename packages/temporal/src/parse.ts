import type { Temporal } from "@actionmanifest/core";

/** 令和1 = 2019 → year = 2018 + n */
export function reiwaToGregorian(reiwa: number): number {
  return 2018 + reiwa;
}

export function heiseiToGregorian(heisei: number): number {
  return 1988 + heisei;
}

export function showaToGregorian(showa: number): number {
  return 1925 + showa;
}

export interface YearContext {
  year?: number;
  raw?: string;
}

const ERA_RE =
  /(?:(令和|平成|昭和)\s*(\d+)年|(\d{4})年)/g;

export function extractYearContext(text: string): YearContext {
  let last: YearContext = {};
  for (const m of text.matchAll(ERA_RE)) {
    const era = m[1];
    const n = m[2] ? Number(m[2]) : undefined;
    const greg = m[3] ? Number(m[3]) : undefined;
    if (era === "令和" && n) last = { year: reiwaToGregorian(n), raw: m[0] };
    else if (era === "平成" && n) last = { year: heiseiToGregorian(n), raw: m[0] };
    else if (era === "昭和" && n) last = { year: showaToGregorian(n), raw: m[0] };
    else if (greg) last = { year: greg, raw: m[0] };
  }
  return last;
}

function pad(n: number): string {
  return String(n).padStart(2, "0");
}

function ymd(year: number, month: number, day: number): string {
  return `${year}-${pad(month)}-${pad(day)}`;
}

function base(partial: Omit<Temporal, "raw_text"> & { raw_text?: string }, raw: string): Temporal {
  return { ...partial, raw_text: raw };
}

const MONTH_DECADE: Record<string, "early" | "mid" | "late"> = {
  上旬: "early",
  中旬: "mid",
  下旬: "late",
};

/**
 * Parse Japanese/English temporal expressions.
 * Never invent a calendar day for 頃/上旬/中旬/下旬.
 * Year-less month+day may inherit year from document context (inferred).
 */
export function parseTemporals(text: string, ctx: YearContext = {}): Temporal[] {
  const found: Temporal[] = [];
  const seen = new Set<string>();

  const push = (t: Temporal) => {
    const key = `${t.type}|${t.raw_text}|${t.date ?? ""}|${t.condition ?? ""}`;
    if (seen.has(key)) return;
    seen.add(key);
    found.push(t);
  };

  // 令和8年10月15日 / 平成31年4月1日
  const eraFull =
    /(令和|平成|昭和)\s*(\d+)年\s*(\d{1,2})月\s*(\d{1,2})日/g;
  for (const m of text.matchAll(eraFull)) {
    const era = m[1];
    const n = Number(m[2]);
    const month = Number(m[3]);
    const day = Number(m[4]);
    const year =
      era === "令和"
        ? reiwaToGregorian(n)
        : era === "平成"
          ? heiseiToGregorian(n)
          : showaToGregorian(n);
    push(
      base(
        {
          type: "exact",
          date: ymd(year, month, day),
          year,
          month,
          day,
          precision: "day",
          certainty: "high",
        },
        m[0],
      ),
    );
  }

  // 2026年10月5日
  const gregFull = /(\d{4})年\s*(\d{1,2})月\s*(\d{1,2})日/g;
  for (const m of text.matchAll(gregFull)) {
    const year = Number(m[1]);
    const month = Number(m[2]);
    const day = Number(m[3]);
    push(
      base(
        {
          type: "exact",
          date: ymd(year, month, day),
          year,
          month,
          day,
          precision: "day",
          certainty: "high",
        },
        m[0],
      ),
    );
  }

  // 10月上旬 / 10月中旬 / 10月下旬 — MUST remain approximate
  const decadeRe = /(\d{1,2})月(上旬|中旬|下旬)/g;
  for (const m of text.matchAll(decadeRe)) {
    const month = Number(m[1]);
    push(
      base(
        {
          type: "approximate",
          month,
          year: ctx.year,
          decade: MONTH_DECADE[m[2] ?? ""] ?? "early",
          precision: "decade_of_month",
          certainty: "medium",
        },
        m[0],
      ),
    );
  }

  // 10月頃 / 10月ごろ — MUST NOT become YYYY-MM-01
  const approxMonth = /(\d{1,2})月(?:頃|ころ|ごろ)/g;
  for (const m of text.matchAll(approxMonth)) {
    const month = Number(m[1]);
    push(
      base(
        {
          type: "approximate",
          month,
          year: ctx.year,
          precision: "month",
          certainty: "low",
        },
        m[0],
      ),
    );
  }

  // 10月5日まで / 10月5日までに
  const untilRe = /(\d{1,2})月\s*(\d{1,2})日まで(?:に)?/g;
  for (const m of text.matchAll(untilRe)) {
    const month = Number(m[1]);
    const day = Number(m[2]);
    const date = ctx.year ? ymd(ctx.year, month, day) : undefined;
    push(
      base(
        {
          type: date ? "exact" : "unknown",
          date,
          month,
          day,
          year: ctx.year,
          precision: "day",
          deadline_qualifier: "until",
          end: date,
          certainty: ctx.year ? "high" : "unknown",
        },
        m[0],
      ),
    );
  }

  // 10月5日 (not already consumed as まで / era full)
  const mdRe = /(\d{1,2})月\s*(\d{1,2})日(?!まで)/g;
  for (const m of text.matchAll(mdRe)) {
    const start = m.index ?? 0;
    const prefix = text.slice(Math.max(0, start - 12), start);
    if (/(令和|平成|昭和|\d{4}年)/.test(prefix)) continue;
    const month = Number(m[1]);
    const day = Number(m[2]);
    const date = ctx.year ? ymd(ctx.year, month, day) : undefined;
    push(
      base(
        {
          type: date ? "exact" : "unknown",
          date,
          month,
          day,
          year: ctx.year,
          precision: "day",
          certainty: ctx.year ? "medium" : "unknown",
        },
        m[0],
      ),
    );
  }

  // ISO dates
  const iso = /\b(\d{4})-(\d{2})-(\d{2})\b/g;
  for (const m of text.matchAll(iso)) {
    push(
      base(
        {
          type: "exact",
          date: m[0],
          year: Number(m[1]),
          month: Number(m[2]),
          day: Number(m[3]),
          precision: "day",
          certainty: "high",
        },
        m[0],
      ),
    );
  }

  // English: October 5, 2026 / Oct 5, 2026
  const enFull =
    /\b(January|February|March|April|May|June|July|August|September|October|November|December|Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Sept|Oct|Nov|Dec)\.?\s+(\d{1,2})(?:st|nd|rd|th)?,?\s+(\d{4})\b/gi;
  const months: Record<string, number> = {
    january: 1, february: 2, march: 3, april: 4, may: 5, june: 6,
    july: 7, august: 8, september: 9, october: 10, november: 11, december: 12,
    jan: 1, feb: 2, mar: 3, apr: 4, jun: 6, jul: 7, aug: 8, sep: 9, sept: 9,
    oct: 10, nov: 11, dec: 12,
  };
  for (const m of text.matchAll(enFull)) {
    const month = months[m[1]!.toLowerCase()];
    const day = Number(m[2]);
    const year = Number(m[3]);
    if (!month) continue;
    push(
      base(
        {
          type: "exact",
          date: ymd(year, month, day),
          year,
          month,
          day,
          precision: "day",
          certainty: "high",
        },
        m[0],
      ),
    );
  }

  // English approximate: early October / around October / mid-October
  const enApprox =
    /\b(early|mid(?:-)?|late|around|about)\s+(January|February|March|April|May|June|July|August|September|October|November|December)\b/gi;
  for (const m of text.matchAll(enApprox)) {
    const month = months[m[2]!.toLowerCase()];
    if (!month) continue;
    const q = m[1]!.toLowerCase().replace("-", "");
    const decade = q.startsWith("early") ? "early" : q.startsWith("late") ? "late" : q.startsWith("mid") ? "mid" : undefined;
    push(
      base(
        {
          type: "approximate",
          month,
          year: ctx.year,
          decade,
          precision: decade ? "decade_of_month" : "month",
          certainty: "low",
        },
        m[0],
      ),
    );
  }

  if (/雨天順延|雨天の場合は/.test(text) || /postponed if rain|rain date|in case of rain/i.test(text)) {
    const altDate = found.find((t) => t.date && /延期|順延|rain/i.test(text));
    push(
      base(
        {
          type: "conditional",
          condition: text.includes("雨天") ? "雨天" : "rain",
          date: altDate?.date,
          month: altDate?.month,
          day: altDate?.day,
          year: altDate?.year ?? ctx.year,
          precision: altDate?.precision ?? "unknown",
          certainty: "medium",
        },
        text.match(/雨天順延|雨天の場合は[^。]*/)?.[0] ??
          text.match(/in case of rain[^.]*/i)?.[0] ??
          "雨天順延",
      ),
    );
  }

  if (/予備日/.test(text) || /backup date|reserve date/i.test(text)) {
    push(
      base(
        {
          type: "conditional",
          condition: "予備日",
          precision: "unknown",
          certainty: "medium",
        },
        text.match(/予備日[^。]*/)?.[0] ?? "予備日",
      ),
    );
  }

  if (/必着/.test(text) || /must arrive|must be received/i.test(text)) {
    const existing = found.find((t) => t.date);
    push(
      base(
        {
          type: existing?.type ?? "unknown",
          date: existing?.date,
          month: existing?.month,
          day: existing?.day,
          year: existing?.year ?? ctx.year,
          precision: existing?.precision ?? "day",
          deadline_qualifier: "must_arrive",
          certainty: "high",
        },
        "必着",
      ),
    );
  }

  if (/消印有効/.test(text) || /postmark/i.test(text)) {
    const existing = found.find((t) => t.date);
    push(
      base(
        {
          type: existing?.type ?? "unknown",
          date: existing?.date,
          month: existing?.month,
          day: existing?.day,
          year: existing?.year ?? ctx.year,
          precision: existing?.precision ?? "day",
          deadline_qualifier: "postmark_valid",
          certainty: "high",
        },
        "消印有効",
      ),
    );
  }

  if (/当日/.test(text) || /\bon the day\b/i.test(text)) {
    push(
      base(
        {
          type: "relative",
          precision: "day",
          deadline_qualifier: "on_day",
          certainty: "medium",
        },
        text.includes("当日") ? "当日" : "on the day",
      ),
    );
  }

  if (/後日/.test(text) || /at a later date|later submission/i.test(text)) {
    push(
      base(
        {
          type: "relative",
          precision: "unknown",
          deadline_qualifier: "later",
          certainty: "low",
        },
        text.includes("後日") ? "後日" : "later",
      ),
    );
  }

  return found;
}

export function primaryTemporal(text: string, ctx: YearContext = {}): Temporal | undefined {
  const all = parseTemporals(text, ctx);
  const scored = all.map((t) => {
    let score = 0;
    if (t.type === "exact" && t.date) score += 5;
    if (t.deadline_qualifier === "until") score += 2;
    if (t.type === "approximate") score += 3;
    if (t.type === "conditional") score += 2;
    if (t.type === "relative") score += 1;
    return { t, score };
  });
  scored.sort((a, b) => b.score - a.score);
  return scored[0]?.t;
}

export function isApproximateCue(text: string): boolean {
  return /頃|ころ|ごろ|上旬|中旬|下旬|around|about|early|mid-|late\s/i.test(text);
}

export function isNegation(text: string): boolean {
  return /必要はありません|する必要はありません|提出不要|再提出不要|しなくて(?:も)?よい|不要です|禁止|\bno need\b|\bnot required\b|\bdo not\b|\bunnecessary\b/i.test(
    text,
  );
}
