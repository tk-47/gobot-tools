import { createHash } from "crypto";
import type { SkillIdentifier, FileEntry } from "./types";
import { SCAN_LIMITS } from "./types";

// ---------------------------------------------------------------------------
// HTTP Status → Error Message mapping
// ---------------------------------------------------------------------------
function httpStatusToError(status: number): string | null {
  switch (status) {
    case 401:
      return "GITHUB_TOKEN is set but invalid. Remove it or fix it.";
    case 403:
      return "GitHub API rate limit hit (or repo requires different auth). Try again later.";
    case 404:
      return null; // 404 is handled contextually (not-found vs skill-not-found)
    case 422:
      return "Invalid skill identifier format. Expected: owner/repo@skill-name";
    case 429:
      return "GitHub API rate limit exceeded. Wait or set GITHUB_TOKEN for higher limits.";
    default:
      return null;
  }
}

// ---------------------------------------------------------------------------
// parseSkillIdentifier
// ---------------------------------------------------------------------------
/**
 * Parse `owner/repo@skill-name` into its three components.
 * Throws if the format is invalid.
 */
export function parseSkillIdentifier(input: string): SkillIdentifier {
  const atIndex = input.indexOf("@");
  if (atIndex === -1) {
    throw new Error(
      `Invalid skill identifier: "${input}". Expected format: owner/repo@skill-name`
    );
  }

  const repoPath = input.slice(0, atIndex);
  const skillName = input.slice(atIndex + 1);

  if (!skillName) {
    throw new Error(
      `Invalid skill identifier: "${input}". Skill name cannot be empty.`
    );
  }

  const slashIndex = repoPath.indexOf("/");
  if (slashIndex === -1) {
    throw new Error(
      `Invalid skill identifier: "${input}". Expected format: owner/repo@skill-name`
    );
  }

  const owner = repoPath.slice(0, slashIndex);
  const repo = repoPath.slice(slashIndex + 1);

  if (!owner || !repo) {
    throw new Error(
      `Invalid skill identifier: "${input}". Owner and repo cannot be empty.`
    );
  }

  return { owner, repo, skillName };
}

// ---------------------------------------------------------------------------
// isBinaryContent
// ---------------------------------------------------------------------------
/**
 * Returns true if the buffer contains a null byte in the first 512 bytes.
 * This is a fast heuristic for detecting binary files.
 */
export function isBinaryContent(buffer: Buffer): boolean {
  const checkLength = Math.min(buffer.length, 512);
  for (let i = 0; i < checkLength; i++) {
    if (buffer[i] === 0x00) {
      return true;
    }
  }
  return false;
}

// ---------------------------------------------------------------------------
// getAuthHeaders
// ---------------------------------------------------------------------------
/**
 * Returns Authorization headers if GITHUB_TOKEN is set in the environment.
 */
export function getAuthHeaders(): Record<string, string> {
  const token = process.env.GITHUB_TOKEN;
  if (!token) {
    return {};
  }
  return {
    Authorization: `Bearer ${token}`,
  };
}

// ---------------------------------------------------------------------------
// resolveSkillPath
// ---------------------------------------------------------------------------
/**
 * The 5 path patterns we probe, in order.
 * Returns the directory prefix for the tree API (empty string = repo root).
 */
const SKILL_PATH_PATTERNS = (skillName: string): Array<{ filePath: string; dirPath: string }> => [
  { filePath: `skills/${skillName}/SKILL.md`, dirPath: `skills/${skillName}` },
  { filePath: `skills/${skillName}/skill.md`, dirPath: `skills/${skillName}` },
  { filePath: `${skillName}/SKILL.md`,        dirPath: `${skillName}` },
  { filePath: `${skillName}/skill.md`,        dirPath: `${skillName}` },
  { filePath: `${skillName}.md`,              dirPath: `` },
];

/**
 * Try 5 path patterns against the GitHub Contents API.
 * Returns the directory path (for later use with the Trees API).
 * Throws on fatal HTTP errors or when no pattern matches.
 */
export async function resolveSkillPath(
  id: SkillIdentifier,
  headers: Record<string, string>
): Promise<string> {
  const { owner, repo, skillName } = id;
  const patterns = SKILL_PATH_PATTERNS(skillName);
  const attempted: string[] = [];

  for (const { filePath, dirPath } of patterns) {
    attempted.push(filePath);
    const url = `https://api.github.com/repos/${owner}/${repo}/contents/${filePath}`;

    const response = await fetch(url, {
      headers: {
        Accept: "application/vnd.github+json",
        "X-GitHub-Api-Version": "2022-11-28",
        ...headers,
      },
    });

    if (response.status === 200) {
      return dirPath;
    }

    // Fatal errors that mean we should stop probing
    if (response.status !== 404) {
      const errorMsg = httpStatusToError(response.status);
      if (errorMsg) {
        throw new Error(errorMsg);
      }
      throw new Error(`GitHub API returned unexpected status ${response.status}`);
    }

    // 404 → try next pattern
  }

  // All patterns exhausted
  const pathList = attempted.map((p) => `  - ${p}`).join("\n");
  throw new Error(
    `Skill not found. If this is a private repo, set GITHUB_TOKEN.\n\nAttempted paths:\n${pathList}`
  );
}

// ---------------------------------------------------------------------------
// computeContentHash
// ---------------------------------------------------------------------------
/**
 * Compute a SHA-256 hash over all file contents, sorted lexicographically by path.
 * Format: ---{path1}---\n{content1}\n---{path2}---\n{content2}
 */
export function computeContentHash(files: FileEntry[]): string {
  const sorted = [...files].sort((a, b) => a.path.localeCompare(b.path));
  const combined = sorted
    .map((f) => `---${f.path}---\n${f.content}`)
    .join("\n");
  return createHash("sha256").update(combined).digest("hex");
}

// ---------------------------------------------------------------------------
// Individual file content hash
// ---------------------------------------------------------------------------
function hashFileContent(content: string): string {
  return createHash("sha256").update(content).digest("hex");
}

// ---------------------------------------------------------------------------
// fetchSkillFiles
// ---------------------------------------------------------------------------
interface GitHubTreeItem {
  path: string;
  type: string;
  sha: string;
  size?: number;
  url: string;
}

interface GitHubTreeResponse {
  tree: GitHubTreeItem[];
  truncated: boolean;
}

interface GitHubBlobResponse {
  content: string;
  encoding: string;
}

/**
 * Full orchestration:
 * 1. Resolve skill path (via Contents API)
 * 2. Fetch recursive git tree using HEAD as tree reference
 * 3. Check file count limit
 * 4. Fetch file contents, applying per-file and total size limits
 * 5. Detect binary content
 * 6. Return FileEntry[] with errors
 *
 * Tree API strategy: GitHub supports `git/trees/HEAD?recursive=1` which avoids
 * needing to resolve the default branch SHA separately.
 */
export async function fetchSkillFiles(
  id: SkillIdentifier
): Promise<{ files: FileEntry[]; errors: string[] }> {
  const errors: string[] = [];
  const files: FileEntry[] = [];
  const authHeaders = getAuthHeaders();

  const requestHeaders: Record<string, string> = {
    Accept: "application/vnd.github+json",
    "X-GitHub-Api-Version": "2022-11-28",
    ...authHeaders,
  };

  // Step 1: Resolve skill path
  let dirPath: string;
  try {
    dirPath = await resolveSkillPath(id, authHeaders);
  } catch (e: any) {
    errors.push(e.message);
    return { files, errors };
  }

  const { owner, repo, skillName } = id;

  // Step 2: Fetch recursive git tree using HEAD
  // GitHub supports using "HEAD" as the tree_sha parameter to get the default branch tree
  const treeUrl = `https://api.github.com/repos/${owner}/${repo}/git/trees/HEAD?recursive=1`;
  const treeResp = await fetch(treeUrl, { headers: requestHeaders });

  if (!treeResp.ok) {
    const errMsg = httpStatusToError(treeResp.status);
    errors.push(errMsg ?? `GitHub API error fetching tree: ${treeResp.status}`);
    return { files, errors };
  }

  const treeData = (await treeResp.json()) as GitHubTreeResponse;

  if (treeData.truncated) {
    errors.push(
      "Warning: GitHub returned a truncated tree. Some files may be missing."
    );
  }

  // Filter to blobs under our dirPath
  const relevantItems = treeData.tree.filter((item) => {
    if (item.type !== "blob") return false;
    if (dirPath === "") {
      // Flat file case — only include the single skill file
      return item.path === `${skillName}.md`;
    }
    // Directory case — include all blobs under the directory
    return item.path.startsWith(dirPath + "/");
  });

  // Normalize paths relative to dirPath
  const normalizedItems = relevantItems.map((item) => ({
    ...item,
    relativePath:
      dirPath === "" ? item.path : item.path.slice(dirPath.length + 1),
  }));

  // Step 3: Check file count limit
  if (normalizedItems.length > SCAN_LIMITS.maxFiles) {
    errors.push(
      `Too many files: ${normalizedItems.length} files found, maximum is ${SCAN_LIMITS.maxFiles}.`
    );
    return { files, errors };
  }

  // Step 4: Check per-file and total size limits, fetch content
  let totalSize = 0;
  for (const item of normalizedItems) {
    const fileSize = item.size ?? 0;

    if (fileSize > SCAN_LIMITS.maxFileSizeBytes) {
      errors.push(
        `Skipped ${item.relativePath}: file size ${fileSize} bytes exceeds limit of ${SCAN_LIMITS.maxFileSizeBytes} bytes.`
      );
      continue;
    }

    totalSize += fileSize;
    if (totalSize > SCAN_LIMITS.maxTotalSizeBytes) {
      errors.push(
        `Total size exceeded ${SCAN_LIMITS.maxTotalSizeBytes / 1024}KB limit. Aborting.`
      );
      return { files, errors };
    }

    // Fetch blob content via the blob URL provided in the tree response
    const blobResp = await fetch(item.url, { headers: requestHeaders });
    if (!blobResp.ok) {
      const errMsg = httpStatusToError(blobResp.status);
      errors.push(
        errMsg ??
          `Failed to fetch ${item.relativePath}: HTTP ${blobResp.status}`
      );
      continue;
    }

    const blobData = (await blobResp.json()) as GitHubBlobResponse;
    const rawContent =
      blobData.encoding === "base64"
        ? Buffer.from(blobData.content.replace(/\n/g, ""), "base64").toString(
            "utf-8"
          )
        : blobData.content;

    // Step 5: Check for binary content
    const contentBuf = Buffer.from(rawContent);
    if (isBinaryContent(contentBuf)) {
      errors.push(`Skipped binary file: ${item.relativePath}`);
      continue;
    }

    const lineCount = rawContent.split("\n").length;
    files.push({
      path: item.relativePath,
      lines: lineCount,
      content: rawContent,
      contentHash: hashFileContent(rawContent),
    });
  }

  return { files, errors };
}
