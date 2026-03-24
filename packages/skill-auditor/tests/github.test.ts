import { describe, it, expect, beforeEach, afterEach, mock, spyOn } from "bun:test";
import {
  parseSkillIdentifier,
  isBinaryContent,
  getAuthHeaders,
  computeContentHash,
  resolveSkillPath,
  fetchSkillFiles,
} from "../src/lib/github";
import type { FileEntry } from "../src/lib/types";

// ---------------------------------------------------------------------------
// parseSkillIdentifier
// ---------------------------------------------------------------------------
describe("parseSkillIdentifier", () => {
  it("parses a valid identifier", () => {
    const result = parseSkillIdentifier("owner/repo@skill-name");
    expect(result.owner).toBe("owner");
    expect(result.repo).toBe("repo");
    expect(result.skillName).toBe("skill-name");
  });

  it("throws on missing @ separator", () => {
    expect(() => parseSkillIdentifier("owner/repo")).toThrow();
  });

  it("throws on completely invalid input", () => {
    expect(() => parseSkillIdentifier("invalid")).toThrow();
  });

  it("throws when owner/repo part is missing slash", () => {
    expect(() => parseSkillIdentifier("ownerrepo@skill")).toThrow();
  });

  it("throws when skill name is empty", () => {
    expect(() => parseSkillIdentifier("owner/repo@")).toThrow();
  });
});

// ---------------------------------------------------------------------------
// isBinaryContent
// ---------------------------------------------------------------------------
describe("isBinaryContent", () => {
  it("returns false for plain text", () => {
    expect(isBinaryContent(Buffer.from("hello world"))).toBe(false);
  });

  it("returns true when null byte is present in first 512 bytes", () => {
    expect(isBinaryContent(Buffer.from([0x00, 0x01, 0x02]))).toBe(true);
  });

  it("returns true when null byte appears within first 512 bytes", () => {
    const buf = Buffer.alloc(100, 65); // 'A' * 100
    buf[50] = 0x00;
    expect(isBinaryContent(buf)).toBe(true);
  });

  it("returns false when null byte appears after first 512 bytes", () => {
    const buf = Buffer.alloc(600, 65); // 'A' * 600
    buf[513] = 0x00;
    expect(isBinaryContent(buf)).toBe(false);
  });

  it("returns false for empty buffer", () => {
    expect(isBinaryContent(Buffer.alloc(0))).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// getAuthHeaders
// ---------------------------------------------------------------------------
describe("getAuthHeaders", () => {
  const originalToken = process.env.GITHUB_TOKEN;

  afterEach(() => {
    if (originalToken === undefined) {
      delete process.env.GITHUB_TOKEN;
    } else {
      process.env.GITHUB_TOKEN = originalToken;
    }
  });

  it("returns empty object when GITHUB_TOKEN is not set", () => {
    delete process.env.GITHUB_TOKEN;
    expect(getAuthHeaders()).toEqual({});
  });

  it("returns Authorization header when GITHUB_TOKEN is set", () => {
    process.env.GITHUB_TOKEN = "test-token-abc123";
    const headers = getAuthHeaders();
    expect(headers["Authorization"]).toBe("Bearer test-token-abc123");
  });
});

// ---------------------------------------------------------------------------
// computeContentHash
// ---------------------------------------------------------------------------
describe("computeContentHash", () => {
  const files: FileEntry[] = [
    {
      path: "a.md",
      lines: 1,
      content: "hello",
      contentHash: "",
    },
    {
      path: "b.md",
      lines: 1,
      content: "world",
      contentHash: "",
    },
  ];

  it("produces a consistent hash", () => {
    const h1 = computeContentHash(files);
    const h2 = computeContentHash(files);
    expect(h1).toBe(h2);
    expect(h1).toMatch(/^[0-9a-f]{64}$/); // SHA-256 hex
  });

  it("produces the same hash regardless of input order", () => {
    const reversed = [...files].reverse();
    expect(computeContentHash(files)).toBe(computeContentHash(reversed));
  });

  it("produces different hashes for different content", () => {
    const other: FileEntry[] = [
      { path: "a.md", lines: 1, content: "different", contentHash: "" },
    ];
    expect(computeContentHash(files)).not.toBe(computeContentHash(other));
  });

  it("includes path separators in the hash input", () => {
    // Two identical content blobs but different paths → different hashes
    const f1: FileEntry[] = [
      { path: "x.md", lines: 1, content: "same", contentHash: "" },
    ];
    const f2: FileEntry[] = [
      { path: "y.md", lines: 1, content: "same", contentHash: "" },
    ];
    expect(computeContentHash(f1)).not.toBe(computeContentHash(f2));
  });
});

// ---------------------------------------------------------------------------
// resolveSkillPath (mocked fetch)
// ---------------------------------------------------------------------------
describe("resolveSkillPath", () => {
  const id = { owner: "myorg", repo: "myrepo", skillName: "my-skill" };
  const headers = {};

  afterEach(() => {
    // Restore globalThis.fetch after each test
    // @ts-ignore
    delete globalThis._fetchMock;
  });

  it("returns directory path for first found pattern (skills/{name}/SKILL.md)", async () => {
    let callCount = 0;
    globalThis.fetch = mock(async (url: string) => {
      callCount++;
      // First pattern succeeds
      if (url.includes("skills/my-skill/SKILL.md")) {
        return new Response(JSON.stringify({ type: "file" }), { status: 200 });
      }
      return new Response(null, { status: 404 });
    }) as typeof fetch;

    const path = await resolveSkillPath(id, headers);
    expect(path).toBe("skills/my-skill");
    expect(callCount).toBe(1);
  });

  it("falls through patterns in order and returns correct directory", async () => {
    // Pattern 1 (skills/{name}/SKILL.md) and 2 (skills/{name}/skill.md) fail
    // Pattern 3 ({name}/SKILL.md) succeeds
    globalThis.fetch = mock(async (url: string) => {
      if (
        url.includes("skills/my-skill/SKILL.md") ||
        url.includes("skills/my-skill/skill.md")
      ) {
        return new Response(null, { status: 404 });
      }
      if (url.includes("my-skill/SKILL.md")) {
        return new Response(JSON.stringify({ type: "file" }), { status: 200 });
      }
      return new Response(null, { status: 404 });
    }) as typeof fetch;

    const path = await resolveSkillPath(id, headers);
    expect(path).toBe("my-skill");
  });

  it("resolves to empty string for flat .md pattern (pattern 5)", async () => {
    // All patterns fail except the last one: {name}.md
    globalThis.fetch = mock(async (url: string) => {
      if (url.endsWith("my-skill.md")) {
        return new Response(JSON.stringify({ type: "file" }), { status: 200 });
      }
      return new Response(null, { status: 404 });
    }) as typeof fetch;

    const path = await resolveSkillPath(id, headers);
    expect(path).toBe(""); // flat file pattern — directory is repo root
  });

  it("throws with all attempted paths when skill not found", async () => {
    globalThis.fetch = mock(async () => {
      return new Response(null, { status: 404 });
    }) as typeof fetch;

    await expect(resolveSkillPath(id, headers)).rejects.toThrow(
      "Skill not found"
    );
  });

  it("lists all 5 attempted paths in not-found error", async () => {
    globalThis.fetch = mock(async () => {
      return new Response(null, { status: 404 });
    }) as typeof fetch;

    try {
      await resolveSkillPath(id, headers);
      expect(true).toBe(false); // should not reach here
    } catch (e: any) {
      expect(e.message).toContain("skills/my-skill/SKILL.md");
      expect(e.message).toContain("skills/my-skill/skill.md");
      expect(e.message).toContain("my-skill/SKILL.md");
      expect(e.message).toContain("my-skill/skill.md");
      expect(e.message).toContain("my-skill.md");
    }
  });

  it("throws correct message for 401", async () => {
    globalThis.fetch = mock(async () => {
      return new Response(null, { status: 401 });
    }) as typeof fetch;

    await expect(resolveSkillPath(id, headers)).rejects.toThrow(
      "GITHUB_TOKEN is set but invalid"
    );
  });

  it("throws correct message for 403", async () => {
    globalThis.fetch = mock(async () => {
      return new Response(null, { status: 403 });
    }) as typeof fetch;

    await expect(resolveSkillPath(id, headers)).rejects.toThrow(
      "GitHub API rate limit hit"
    );
  });

  it("throws correct message for 429", async () => {
    globalThis.fetch = mock(async () => {
      return new Response(null, { status: 429 });
    }) as typeof fetch;

    await expect(resolveSkillPath(id, headers)).rejects.toThrow(
      "GitHub API rate limit exceeded"
    );
  });

  it("throws correct message for 422", async () => {
    globalThis.fetch = mock(async () => {
      return new Response(null, { status: 422 });
    }) as typeof fetch;

    await expect(resolveSkillPath(id, headers)).rejects.toThrow(
      "Invalid skill identifier format"
    );
  });
});

// ---------------------------------------------------------------------------
// fetchSkillFiles (mocked fetch)
// ---------------------------------------------------------------------------
describe("fetchSkillFiles", () => {
  const id = { owner: "myorg", repo: "myrepo", skillName: "my-skill" };

  // Tree items use full repo paths (as GitHub API returns them).
  // The skill resolves to dirPath "skills/my-skill", so items live under that prefix.
  const treeItem = (relativeName: string, size: number = 100) => ({
    path: `skills/my-skill/${relativeName}`,
    type: "blob",
    sha: "abc123",
    size,
    url: `https://api.github.com/repos/myorg/myrepo/git/blobs/abc123`,
  });

  // Mock helper: resolveSkillPath uses /contents/ with pattern matching.
  // The first pattern tried is skills/my-skill/SKILL.md — return 200 to accept it.
  // Then fetchSkillFiles fetches /git/trees/HEAD?recursive=1.
  // Blob fetches go to the blob URL (git/blobs/abc123).

  it("aborts when file count exceeds 20", async () => {
    // Build 21 tree items
    const items = Array.from({ length: 21 }, (_, i) =>
      treeItem(`file${i}.md`, 100)
    );

    globalThis.fetch = mock(async (url: string) => {
      // Resolve skill path — first pattern check
      if (url.includes("/contents/skills/my-skill/SKILL.md")) {
        return new Response(JSON.stringify({ type: "file" }), { status: 200 });
      }
      // Trees API
      if (url.includes("/git/trees/HEAD")) {
        return new Response(
          JSON.stringify({ tree: items, truncated: false }),
          { status: 200 }
        );
      }
      return new Response(null, { status: 404 });
    }) as typeof fetch;

    const result = await fetchSkillFiles(id);
    expect(result.errors.some((e) => e.includes("20"))).toBe(true);
    expect(result.files.length).toBe(0);
  });

  it("skips files over 100KB and records error", async () => {
    const items = [
      treeItem("big-file.md", 200 * 1024), // 200 KB — over limit
      treeItem("small-file.md", 100),
    ];

    globalThis.fetch = mock(async (url: string) => {
      if (url.includes("/contents/skills/my-skill/SKILL.md")) {
        return new Response(JSON.stringify({ type: "file" }), { status: 200 });
      }
      if (url.includes("/git/trees/HEAD")) {
        return new Response(
          JSON.stringify({ tree: items, truncated: false }),
          { status: 200 }
        );
      }
      // Blob content for small file
      const content = Buffer.from("small content").toString("base64");
      return new Response(
        JSON.stringify({ content, encoding: "base64" }),
        { status: 200 }
      );
    }) as typeof fetch;

    const result = await fetchSkillFiles(id);
    const bigFileError = result.errors.find((e) =>
      e.includes("big-file.md")
    );
    expect(bigFileError).toBeDefined();
    const smallFile = result.files.find(
      (f) => f.path === "small-file.md" && !f.skipped
    );
    expect(smallFile).toBeDefined();
  });

  it("aborts when total size exceeds 500KB", async () => {
    // Six files of 90KB each = 540KB total, each individually under 100KB limit
    const items = Array.from({ length: 6 }, (_, i) =>
      treeItem(`chunk${i}.md`, 90 * 1024)
    );

    globalThis.fetch = mock(async (url: string) => {
      if (url.includes("/contents/skills/my-skill/SKILL.md")) {
        return new Response(JSON.stringify({ type: "file" }), { status: 200 });
      }
      if (url.includes("/git/trees/HEAD")) {
        return new Response(
          JSON.stringify({ tree: items, truncated: false }),
          { status: 200 }
        );
      }
      return new Response(null, { status: 404 });
    }) as typeof fetch;

    const result = await fetchSkillFiles(id);
    expect(result.errors.some((e) => e.includes("500"))).toBe(true);
  });

  it("adds warning to errors when tree is truncated", async () => {
    const items = [treeItem("file.md", 100)];

    globalThis.fetch = mock(async (url: string) => {
      if (url.includes("/contents/skills/my-skill/SKILL.md")) {
        return new Response(JSON.stringify({ type: "file" }), { status: 200 });
      }
      if (url.includes("/git/trees/HEAD")) {
        return new Response(
          JSON.stringify({ tree: items, truncated: true }),
          { status: 200 }
        );
      }
      const content = Buffer.from("# hello").toString("base64");
      return new Response(
        JSON.stringify({ content, encoding: "base64" }),
        { status: 200 }
      );
    }) as typeof fetch;

    const result = await fetchSkillFiles(id);
    expect(result.errors.some((e) => e.toLowerCase().includes("truncat"))).toBe(
      true
    );
  });

  it("returns files with correct structure on success", async () => {
    const items = [treeItem("SKILL.md", 50)];
    const rawContent = "# My Skill\nThis is the skill.";
    const b64 = Buffer.from(rawContent).toString("base64");

    globalThis.fetch = mock(async (url: string) => {
      if (url.includes("/contents/skills/my-skill/SKILL.md")) {
        return new Response(JSON.stringify({ type: "file" }), { status: 200 });
      }
      if (url.includes("/git/trees/HEAD")) {
        return new Response(
          JSON.stringify({ tree: items, truncated: false }),
          { status: 200 }
        );
      }
      // Blob content
      return new Response(
        JSON.stringify({ content: b64, encoding: "base64" }),
        { status: 200 }
      );
    }) as typeof fetch;

    const result = await fetchSkillFiles(id);
    expect(result.errors.length).toBe(0);
    expect(result.files.length).toBe(1);
    const file = result.files[0];
    expect(file.path).toBe("SKILL.md");
    expect(file.content).toBe(rawContent);
    expect(file.lines).toBeGreaterThan(0);
    expect(file.contentHash).toMatch(/^[0-9a-f]{64}$/);
  });

  it("skips binary files and records error", async () => {
    const items = [treeItem("image.bin", 100)];
    // Binary content (has null byte)
    const binaryContent = Buffer.from([0x00, 0x01, 0x02, 0x03]);
    const b64 = binaryContent.toString("base64");

    globalThis.fetch = mock(async (url: string) => {
      if (url.includes("/contents/skills/my-skill/SKILL.md")) {
        return new Response(JSON.stringify({ type: "file" }), { status: 200 });
      }
      if (url.includes("/git/trees/HEAD")) {
        return new Response(
          JSON.stringify({ tree: items, truncated: false }),
          { status: 200 }
        );
      }
      return new Response(
        JSON.stringify({ content: b64, encoding: "base64" }),
        { status: 200 }
      );
    }) as typeof fetch;

    const result = await fetchSkillFiles(id);
    expect(
      result.errors.some((e) => e.includes("image.bin"))
    ).toBe(true);
  });

  it("propagates 401 error correctly", async () => {
    globalThis.fetch = mock(async () => {
      return new Response(null, { status: 401 });
    }) as typeof fetch;

    const result = await fetchSkillFiles(id);
    expect(result.errors.some((e) => e.includes("GITHUB_TOKEN is set but invalid"))).toBe(true);
    expect(result.files.length).toBe(0);
  });

  it("propagates 403 error correctly", async () => {
    globalThis.fetch = mock(async () => {
      return new Response(null, { status: 403 });
    }) as typeof fetch;

    const result = await fetchSkillFiles(id);
    expect(result.errors.some((e) => e.includes("rate limit hit"))).toBe(true);
  });

  it("propagates 429 error correctly", async () => {
    globalThis.fetch = mock(async () => {
      return new Response(null, { status: 429 });
    }) as typeof fetch;

    const result = await fetchSkillFiles(id);
    expect(result.errors.some((e) => e.includes("rate limit exceeded"))).toBe(true);
  });
});
