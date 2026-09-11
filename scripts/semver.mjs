/**
 * Shared SemVer 2.0 parser for release identity and protected v* tags.
 * Prerelease is the parsed identifier field, never a raw hyphen substring.
 */

/** @typedef {{
 *   raw: string,
 *   major: number,
 *   minor: number,
 *   patch: number,
 *   prerelease: string | null,
 *   build: string | null,
 * }} SemVer */

const SEMVER_RE =
  /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-([0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*))?(?:\+([0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*))?$/;

/**
 * @param {unknown} version
 * @returns {SemVer | null}
 */
export function parseSemver(version) {
  if (typeof version !== "string" || !version) return null;
  const m = SEMVER_RE.exec(version);
  if (!m) return null;
  return {
    raw: version,
    major: Number(m[1]),
    minor: Number(m[2]),
    patch: Number(m[3]),
    prerelease: m[4] ?? null,
    build: m[5] ?? null,
  };
}

/**
 * @param {unknown} version
 * @returns {boolean}
 */
export function isPrerelease(version) {
  const parsed = parseSemver(version);
  if (!parsed) {
    throw new Error(`not a valid semver: ${String(version)}`);
  }
  return parsed.prerelease !== null;
}

/**
 * Dist-tag from a parsed version. Prerelease → next; stable → latest.
 * @param {unknown} version
 * @returns {"next" | "latest"}
 */
export function distTagForVersion(version) {
  return isPrerelease(version) ? "next" : "latest";
}

/**
 * Protected release git tag: exactly `v` + valid SemVer.
 * @param {unknown} tag
 * @returns {(SemVer & { tag: string, version: string, distTag: "next" | "latest" }) | null}
 */
export function parseProtectedReleaseTag(tag) {
  if (typeof tag !== "string" || !tag.startsWith("v") || tag.length < 2) return null;
  const version = tag.slice(1);
  const parsed = parseSemver(version);
  if (!parsed) return null;
  if (tag !== `v${parsed.raw}`) return null;
  return {
    ...parsed,
    tag,
    version: parsed.raw,
    distTag: parsed.prerelease !== null ? "next" : "latest",
  };
}

/**
 * @param {unknown} tag
 * @param {string} [packageVersion]
 */
export function assertProtectedReleaseTag(tag, packageVersion) {
  const parsed = parseProtectedReleaseTag(tag);
  if (!parsed) {
    throw new Error(
      `protected release tag must match v<valid-semver> only (got ${String(tag)})`,
    );
  }
  if (packageVersion !== undefined) {
    const pkg = parseSemver(packageVersion);
    if (!pkg) {
      throw new Error(`package version is not valid semver: ${packageVersion}`);
    }
    if (parsed.version !== pkg.raw) {
      throw new Error(
        `tag ${parsed.tag} version ${parsed.version} != package version ${pkg.raw}`,
      );
    }
  }
  return parsed;
}
