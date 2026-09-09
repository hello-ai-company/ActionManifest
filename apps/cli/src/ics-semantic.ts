/**
 * Minimal RFC 5545 semantic reader for universal conformance checks.
 *
 * Deliberately NOT a calendar library: it unfolds content lines, splits
 * components, and compares properties as sets — the smallest subset needed
 * to decide whether two calendar streams are semantically equivalent.
 * Property ordering, PRODID value, legal fold positions, DTSTAMP lexical
 * details, and extra X-* properties are all tolerated; normative content
 * (component types, UID, DTSTART/DUE, SUMMARY, COMMENT, trust markers) must
 * match.
 */

export interface IcsComponent {
  type: string;
  /** key: "NAME;PARAM=VALUE…" with params sorted; values in document order. */
  props: Map<string, string[]>;
  children: IcsComponent[];
}

export interface ExpectedComponent {
  type: string;
  /** Subset match: each listed prop must exist with exactly these values (order-insensitive). */
  props?: Record<string, string[]>;
  /** These props must NOT exist on the component. */
  forbid_props?: string[];
}

function normalizeParams(raw: string): string {
  if (!raw) return "";
  return raw
    .split(";")
    .filter((p) => p.length > 0)
    .sort()
    .map((p) => `;${p}`)
    .join("");
}

/** Parse an iCalendar stream into a component tree. Throws on malformed input. */
export function parseIcs(ics: string): IcsComponent {
  const unfolded = ics.replace(/\r\n[ \t]/g, "");
  const lines = unfolded.split("\r\n").filter((l) => l.length > 0);
  const stack: IcsComponent[] = [];
  let root: IcsComponent | undefined;

  for (const line of lines) {
    const m = line.match(/^([A-Za-z0-9-]+)((?:;[^:]*)?):(.*)$/);
    if (!m) throw new Error(`malformed content line: ${JSON.stringify(line)}`);
    const [, name, rawParams, value] = m as [string, string, string, string];
    if (name === "BEGIN") {
      const comp: IcsComponent = { type: value, props: new Map(), children: [] };
      const parent = stack[stack.length - 1];
      if (parent) parent.children.push(comp);
      else if (!root) root = comp;
      else throw new Error("multiple root components");
      stack.push(comp);
    } else if (name === "END") {
      const top = stack.pop();
      if (!top || top.type !== value) {
        throw new Error(`END:${value} without matching BEGIN`);
      }
    } else {
      const current = stack[stack.length - 1];
      if (!current) throw new Error(`property outside component: ${JSON.stringify(line)}`);
      const key = `${name}${normalizeParams(rawParams)}`;
      current.props.set(key, [...(current.props.get(key) ?? []), value]);
    }
  }
  if (stack.length > 0) throw new Error(`unclosed component: ${stack[stack.length - 1]!.type}`);
  if (!root) throw new Error("no root component");
  return root;
}

function flatten(root: IcsComponent): IcsComponent[] {
  return [root, ...root.children.flatMap(flatten)];
}

function sortedEqual(a: string[], b: string[]): boolean {
  return [...a].sort().join("") === [...b].sort().join("");
}

/**
 * Match expected components against a parsed calendar. Returns undefined on
 * match, or a human-readable mismatch detail. Semantics-preserving
 * serialization differences never fail; normative differences always do.
 */
export function matchComponents(
  root: IcsComponent,
  expected: ExpectedComponent[],
): string | undefined {
  const all = flatten(root);
  for (const exp of expected) {
    const candidates = all.filter((c) => c.type === exp.type);
    if (candidates.length === 0) return `missing component ${exp.type}`;
    let matched = false;
    let lastDetail = `no ${exp.type} matches expected properties`;
    for (const comp of candidates) {
      let detail: string | undefined;
      for (const [key, values] of Object.entries(exp.props ?? {})) {
        const actual = comp.props.get(key);
        if (!actual) {
          detail = `${exp.type}.${key}: missing (expected ${JSON.stringify(values)})`;
          break;
        }
        if (!sortedEqual(actual, values)) {
          detail = `${exp.type}.${key}: expected ${JSON.stringify(values)}, got ${JSON.stringify(actual)}`;
          break;
        }
      }
      if (!detail) {
        for (const forbidden of exp.forbid_props ?? []) {
          const present = [...comp.props.keys()].some(
            (k) => k === forbidden || k.startsWith(`${forbidden};`),
          );
          if (present) detail = `${exp.type}.${forbidden}: forbidden property present`;
        }
      }
      if (!detail) {
        matched = true;
        break;
      }
      lastDetail = detail;
    }
    if (!matched) return lastDetail;
  }
  return undefined;
}
