const assert = require("node:assert/strict");
const { createHash } = require("node:crypto");
const Module = require("node:module");
const path = require("node:path");
const { buildSync } = require("esbuild");

class MemoryKV {
  records = new Map();
  async get(key, type) {
    const value = this.records.get(key)?.value ?? null;
    return type === "json" && value !== null ? JSON.parse(value) : value;
  }
  async put(key, value, options = {}) {
    this.records.set(key, {
      value,
      metadata: structuredClone(options.metadata),
      expirationTtl: options.expirationTtl,
    });
  }
  async delete(key) {
    this.records.delete(key);
  }
  async getWithMetadata(key) {
    return structuredClone(
      this.records.get(key) ?? { value: null, metadata: null }
    );
  }
  async list({ prefix = "", limit = 1000, cursor = "0" } = {}) {
    const items = [...this.records]
      .filter(([name]) => name.startsWith(prefix))
      .sort(([a], [b]) => a.localeCompare(b));
    const offset = Number(cursor);
    const end = offset + limit;
    return {
      keys: items.slice(offset, end).map(([name, item]) => ({
        name,
        metadata: structuredClone(item.metadata),
      })),
      list_complete: end >= items.length,
      cursor: end < items.length ? String(end) : undefined,
    };
  }
}

describe("Scoped File Management API", function () {
  let app, env, kv, objects, deletedCaches, signChunkReceipt;
  const originalCaches = global.caches;
  const admin = { Authorization: "Bearer admin-token" };
  const context = {
    waitUntil(promise) {
      promise.catch(() => {});
    },
    passThroughOnException() {},
  };
  const allScopes = ["files:read", "files:write", "files:delete"];
  const send = (url, options = {}) => app.request(url, options, env, context);
  const authorization = (token) => ({ Authorization: `Bearer ${token}` });
  const json = (token, body) => ({
    method: "POST",
    headers: { ...authorization(token), "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const initChunk = async (token, input = {}) => {
    const response = await send(
      "/api/v1/upload/chunk/init",
      json(token, {
        fileType: "doc",
        fileName: "large.bin",
        fileSize: 20 * 1024 * 1024 + 4,
        totalChunks: 2,
        tags: ["private"],
        desc: "chunk API",
        ...input,
      })
    );
    assert.equal(response.status, 200, await response.clone().text());
    return (await response.json()).data;
  };
  const chunkForm = (key, index, bytes) => {
    const form = new FormData();
    form.set("key", key);
    form.set("chunkIndex", String(index));
    form.set("chunkFile", new File([bytes], "part.bin"));
    form.set("returnReceipt", "true");
    return form;
  };
  const putChunk = (token, key, index, bytes) =>
    send("/api/v1/upload/chunk", {
      method: "POST",
      headers: authorization(token),
      body: chunkForm(key, index, bytes),
    });
  const generate = async (scopes = allScopes, expiresInDays = 90) => {
    const response = await send("/settings/file-api/rotate", {
      method: "POST",
      headers: { ...admin, "Content-Type": "application/json" },
      body: JSON.stringify({ scopes, expiresInDays }),
    });
    assert.equal(response.status, 200, await response.clone().text());
    return (await response.json()).data;
  };
  const form = (name = "测试.txt", tags = ["private"], body = "test") => {
    const data = new FormData();
    data.append("file", new File([body], name));
    data.append("tags", JSON.stringify(tags));
    data.append("desc", "from API");
    return data;
  };
  const upload = async (token, data = form()) => {
    const response = await send("/api/v1/files", {
      method: "POST",
      headers: authorization(token),
      body: data,
    });
    assert.equal(response.status, 201, await response.clone().text());
    assert.match(response.headers.get("Location"), /^\/api\/v1\/files\//);
    assert.match(response.headers.get("Cache-Control"), /no-store/);
    return (await response.json()).data;
  };
  const seed = async (key, metadata = {}) => {
    await kv.put(key, "", {
      metadata: {
        fileName: "seed.txt",
        fileSize: 4,
        uploadedAt: Date.now(),
        liked: false,
        tags: ["private"],
        ...metadata,
      },
    });
  };

  before(() => {
    const bundled = buildSync({
      stdin: {
        contents:
          'export { app } from "./functions/app"; export { signChunkReceipt } from "./functions/utils/chunk-upload";',
        resolveDir: path.join(__dirname, ".."),
        loader: "ts",
      },
      bundle: true,
      write: false,
      platform: "node",
      format: "cjs",
      tsconfig: path.join(__dirname, "../frontend/tsconfig.json"),
      logLevel: "silent",
    });
    const compiled = new Module(
      path.join(__dirname, "file-api-entry.cjs"),
      module
    );
    compiled.filename = path.join(__dirname, "file-api-entry.cjs");
    compiled.paths = module.paths;
    compiled._compile(bundled.outputFiles[0].text, compiled.filename);
    app = compiled.exports.app;
    signChunkReceipt = compiled.exports.signChunkReceipt;
  });

  beforeEach(() => {
    kv = new MemoryKV();
    objects = new Map();
    deletedCaches = [];
    global.caches = {
      async open() {
        return {
          async match() {
            return undefined;
          },
          async put() {},
          async delete(request) {
            deletedCaches.push(request.url);
            return true;
          },
        };
      },
    };
    env = {
      oh_file_url: kv,
      API_TOKEN: "admin-token",
      PASSWORD: "password",
      JWT_SECRET: "test-secret",
      oh_file_r2: {
        async put(key, value) {
          objects.set(
            key,
            new Uint8Array(await new Response(value).arrayBuffer())
          );
        },
        async delete(key) {
          objects.delete(key);
        },
        async get(key, options) {
          const bytes = objects.get(key);
          if (!bytes) return null;
          const range = options?.range
            ?.get?.("Range")
            ?.match(/^bytes=(\d+)-(\d+)$/);
          const body = range
            ? bytes.slice(Number(range[1]), Number(range[2]) + 1)
            : options?.range?.offset !== undefined
              ? bytes.slice(
                  options.range.offset,
                  options.range.offset + options.range.length
                )
              : bytes;
          return {
            size: bytes.length,
            body: new Response(body).body,
            httpEtag: '"test"',
            writeHttpMetadata() {},
          };
        },
      },
    };
  });
  after(() => {
    global.caches = originalCaches;
  });

  it("requires admin and same-origin access to manage tokens; stores no plaintext", async () => {
    for (const [url, method] of [
      ["/settings/file-api", "GET"],
      ["/settings/file-api/rotate", "POST"],
      ["/settings/file-api/reveal", "POST"],
      ["/settings/file-api", "DELETE"],
    ]) {
      assert.equal((await send(url, { method })).status, 401);
      assert.equal(
        (
          await send(url, {
            method,
            headers: { ...admin, Origin: "https://attacker.example" },
          })
        ).status,
        403
      );
    }
    const { token, status } = await generate();
    assert.match(token, /^ohf_[a-f0-9]{64}$/);
    assert.equal(status.enabled, true);
    assert.equal(status.expiresAt - status.createdAt, 90 * 86_400_000);
    const stored = await kv.get("oh_file_api_token");
    assert.equal(stored.includes(token), false);
    assert.equal(
      JSON.parse(stored).hash,
      createHash("sha256").update(token).digest("hex")
    );
    assert.match(
      JSON.parse(stored).encryptedToken,
      /^v1\.[a-f0-9]{24}\.[a-f0-9]{168}$/
    );
    assert.equal(status.recoverable, true);
    const response = await send("/settings/file-api", { headers: admin });
    assert.match(response.headers.get("Cache-Control"), /no-store/);
    assert.deepEqual((await response.json()).data, status);
    for (const url of [
      "/settings/file-api",
      "/settings/file-api/reveal",
      "/settings/general",
      "/settings/public-api",
      "/file/list",
    ]) {
      assert.equal(
        (
          await send(url, {
            method: url.endsWith("/reveal") ? "POST" : "GET",
            headers: authorization(token),
          })
        ).status,
        401
      );
    }
  });

  it("reveals only the current encrypted token and handles legacy, changed-secret and revoked records", async () => {
    const reveal = () =>
      send("/settings/file-api/reveal", { method: "POST", headers: admin });
    assert.equal((await reveal()).status, 404);
    const first = await generate();
    const response = await reveal();
    assert.equal(response.status, 200);
    assert.match(response.headers.get("Cache-Control"), /no-store/);
    assert.equal((await response.json()).data.token, first.token);
    const status = await send("/settings/file-api", { headers: admin });
    const statusText = await status.text();
    assert.equal(statusText.includes(first.token), false);
    assert.equal(statusText.includes("encryptedToken"), false);
    env.JWT_SECRET = "new-secret";
    assert.equal((await reveal()).status, 409);
    env.JWT_SECRET = "test-secret";
    const record = JSON.parse(await kv.get("oh_file_api_token"));
    record.encryptedToken =
      record.encryptedToken.slice(0, -1) +
      (record.encryptedToken.endsWith("0") ? "1" : "0");
    await kv.put("oh_file_api_token", JSON.stringify(record));
    assert.equal((await reveal()).status, 409);
    delete record.encryptedToken;
    await kv.put("oh_file_api_token", JSON.stringify(record));
    assert.equal((await reveal()).status, 409);
    assert.equal(
      (await send("/api/v1/files", { headers: authorization(first.token) }))
        .status,
      200
    );
    const second = await generate();
    assert.notEqual(first.token, second.token);
    assert.equal((await (await reveal()).json()).data.token, second.token);
    await send("/settings/file-api", { method: "DELETE", headers: admin });
    assert.equal((await reveal()).status, 404);
    delete env.JWT_SECRET;
    assert.equal((await generateWithoutAssertion()).status, 500);
    async function generateWithoutAssertion() {
      return send("/settings/file-api/rotate", {
        method: "POST",
        headers: { ...admin, "Content-Type": "application/json" },
        body: "{}",
      });
    }
  });

  it("requires file write scope for every chunk operation, including progress", async () => {
    for (const scope of ["files:read", "files:delete"]) {
      const { token } = await generate([scope]);
      for (const [url, method] of [
        ["/chunk/init", "POST"],
        ["/chunk", "POST"],
        ["/chunk/progress?key=doc:chunk_test.bin", "GET"],
        ["/chunk/complete", "POST"],
      ]) {
        assert.equal(
          (await send(`/api/v1/upload${url}`, { method })).status,
          401
        );
        assert.equal(
          (
            await send(`/api/v1/upload${url}`, {
              method,
              headers: authorization(token),
            })
          ).status,
          403
        );
      }
    }
    assert.equal(objects.size, 0);
  });

  it("accepts the 1000 MiB boundary and rejects inconsistent or excessive initialization", async () => {
    const { token } = await generate();
    const limit = 1000 * 1024 * 1024;
    const key = await initChunk(token, { fileSize: limit, totalChunks: 50 });
    assert.match(key, /^doc:chunk_/);
    assert.equal(kv.records.get(key).expirationTtl, 3600);
    assert.equal(kv.records.get(key).metadata.fileSize, limit);
    for (const input of [
      { fileSize: limit + 1, totalChunks: 51 },
      { totalChunks: 51 },
      { totalChunks: 1 },
      { fileSize: 0 },
      { fileSize: 1.5 },
      { fileType: "trash" },
      { fileName: "../bad" },
      { fileName: "bad\n.bin" },
      { tags: ["unknown"] },
      { desc: "a".repeat(301) },
      { unknown: true },
    ]) {
      const response = await send(
        "/api/v1/upload/chunk/init",
        json(token, {
          fileType: "doc",
          fileName: "test.bin",
          fileSize: 20971524,
          totalChunks: 2,
          ...input,
        })
      );
      assert.equal(response.status, 400, JSON.stringify(input));
    }
    delete env.JWT_SECRET;
    assert.equal(
      (await send("/api/v1/upload/chunk/init", json(token, {}))).status,
      500
    );
  });

  it("uploads two real chunks, resumes, retries, completes and streams a private cross-chunk range", async () => {
    const { token } = await generate();
    const key = await initChunk(token);
    const first = new Uint8Array(20 * 1024 * 1024).fill(97);
    const tail = await putChunk(token, key, 1, "tail");
    assert.equal(tail.status, 200, await tail.clone().text());
    const tailReceipt = (await tail.json()).data.receipt;
    const progressUrl = `/api/v1/upload/chunk/progress?key=${encodeURIComponent(key)}`;
    const progress = (
      await (await send(progressUrl, { headers: authorization(token) })).json()
    ).data;
    assert.deepEqual(progress.uploadedIndices, [1]);
    assert.equal(progress.complete, false);
    assert.equal(progress.receipts.length, 1);
    const incomplete = await send(
      "/api/v1/upload/chunk/complete",
      json(token, { key, receipts: [tailReceipt] })
    );
    assert.equal(incomplete.status, 400);
    const head = await putChunk(token, key, 0, first);
    assert.equal(head.status, 200, await head.clone().text());
    const headReceipt = (await head.json()).data.receipt;
    const retried = await putChunk(token, key, 1, "tail");
    assert.equal(retried.status, 200);
    assert.equal(objects.size, 2);
    const result = await send(
      "/api/v1/upload/chunk/complete",
      json(token, { key, receipts: [headReceipt, tailReceipt] })
    );
    assert.equal(result.status, 200, await result.clone().text());
    assert.equal((await result.json()).data.fileSize, first.length + 4);
    assert.equal(kv.records.get(key).expirationTtl, undefined);
    assert.equal((await send(`/file/${key}`)).status, 401);
    const content = await send(
      `/api/v1/files/${encodeURIComponent(key)}/content`,
      {
        headers: {
          ...authorization(token),
          Range: `bytes=${first.length - 2}-${first.length + 3}`,
        },
      }
    );
    assert.equal(content.status, 206);
    assert.equal(await content.text(), "aatail");
    assert.equal(
      content.headers.get("Content-Range"),
      `bytes ${first.length - 2}-${first.length + 3}/${first.length + 4}`
    );
    assert.match(content.headers.get("Cache-Control"), /no-store/);
    const resumed = (
      await (await send(progressUrl, { headers: authorization(token) })).json()
    ).data;
    assert.equal(resumed.complete, true);
    assert.deepEqual(resumed.uploadedIndices, [0, 1]);
    assert.equal(
      (
        await send(
          "/api/v1/upload/chunk/complete",
          json(token, { key, receipts: resumed.receipts })
        )
      ).status,
      200
    );
    assert.equal((await putChunk(token, key, 1, "tail")).status, 200);
    assert.equal(objects.size, 2);
  });

  it("validates chunk indices, namespaces, lengths, receipts and request body bounds", async () => {
    const { token } = await generate();
    const key = await initChunk(token);
    for (const index of [-1, 2, 50, "NaN", "1.0"])
      assert.equal((await putChunk(token, key, index, "tail")).status, 400);
    assert.equal((await putChunk(token, key, 0, "tiny")).status, 400);
    assert.equal((await putChunk(token, key, 1, "tails")).status, 400);
    assert.equal((await putChunk(token, key, 1, "")).status, 400);
    for (const invalid of [
      "oh_file_api_token",
      "share:token",
      "trash:doc:chunk_test.bin",
      "doc:ordinary.bin",
      "doc:chunk_bad/part",
      "doc:chunk_bad\\part",
    ]) {
      assert.equal((await putChunk(token, invalid, 0, "x")).status, 400);
      assert.equal(
        (
          await send(
            `/api/v1/upload/chunk/progress?key=${encodeURIComponent(invalid)}`,
            { headers: authorization(token) }
          )
        ).status,
        400
      );
      assert.equal(
        (
          await send(
            "/api/v1/upload/chunk/complete",
            json(token, { key: invalid, receipts: [] })
          )
        ).status,
        400
      );
    }
    assert.equal(
      (await putChunk(token, "doc:chunk_missing.bin", 0, "x")).status,
      404
    );
    assert.equal(
      (
        await send(
          "/api/v1/upload/chunk/complete",
          json(token, { key, receipts: ["bad"] })
        )
      ).status,
      400
    );
    const otherKey = await initChunk(token, { fileSize: 4, totalChunks: 1 });
    const otherReceipt = (
      await (await putChunk(token, otherKey, 0, "tail")).json()
    ).data.receipt;
    assert.equal(
      (
        await send(
          "/api/v1/upload/chunk/complete",
          json(token, { key, receipts: [otherReceipt] })
        )
      ).status,
      400
    );
    const duplicate = chunkForm(key, 1, "tail");
    duplicate.append("key", key);
    assert.equal(
      (
        await send("/api/v1/upload/chunk", {
          method: "POST",
          headers: authorization(token),
          body: duplicate,
        })
      ).status,
      400
    );
    assert.equal(
      (await putChunk(token, key, 0, new Uint8Array(20 * 1024 * 1024 + 1)))
        .status,
      413
    );
    let cancelled = false;
    const oversized = await send("/api/v1/upload/chunk", {
      method: "POST",
      headers: {
        ...authorization(token),
        "Content-Type": "multipart/form-data; boundary=test",
        "Content-Length": "1",
      },
      body: new ReadableStream({
        pull(c) {
          c.enqueue(new Uint8Array(1024 * 1024));
        },
        cancel() {
          cancelled = true;
        },
      }),
      duplex: "half",
    });
    assert.equal(oversized.status, 413);
    assert.equal(cancelled, true);
    assert.equal(
      (
        await send(
          "/api/v1/upload/chunk/init",
          json(token, { desc: "x".repeat(8192) })
        )
      ).status,
      413
    );
    assert.equal(
      (
        await send(
          "/api/v1/upload/chunk/complete",
          json(token, { receipts: ["x".repeat(128 * 1024)] })
        )
      ).status,
      413
    );
  });

  it("retains upload state after storage/finalization failures and safely retries", async () => {
    const { token } = await generate();
    const key = await initChunk(token, { fileSize: 4, totalChunks: 1 });
    const store = env.oh_file_r2.put;
    env.oh_file_r2.put = async () => {
      throw new Error("test storage unavailable");
    };
    const previousError = console.error;
    console.error = () => {};
    try {
      const failed = await putChunk(token, key, 0, "test");
      assert.equal(failed.status, 503);
      assert.equal((await failed.json()).data, null);
      const progress = await send(
        `/api/v1/upload/chunk/progress?key=${encodeURIComponent(key)}`,
        { headers: authorization(token) }
      );
      assert.equal((await progress.json()).data.uploaded, 0);
      env.oh_file_r2.put = store;
      const retried = await putChunk(token, key, 0, "test");
      assert.equal(retried.status, 200);
      const receipt = (await retried.json()).data.receipt;
      const put = kv.put.bind(kv);
      kv.put = async (name, ...args) => {
        if (name === key) throw new Error("test finalization unavailable");
        return put(name, ...args);
      };
      assert.equal(
        (
          await send(
            "/api/v1/upload/chunk/complete",
            json(token, { key, receipts: [receipt] })
          )
        ).status,
        503
      );
      assert.equal(await kv.get(key), "");
      assert.equal(kv.records.get(key).expirationTtl, 3600);
      kv.put = put;
      assert.equal(
        (
          await send(
            "/api/v1/upload/chunk/complete",
            json(token, { key, receipts: [receipt] })
          )
        ).status,
        200
      );
      assert.equal(kv.records.get(key).expirationTtl, undefined);
      assert.equal(objects.size, 1);
    } finally {
      console.error = previousError;
    }
  });

  it("completes a 50-receipt 1000 MiB manifest and interoperates with page receipts", async () => {
    const { token } = await generate();
    const key = await initChunk(token, {
      fileSize: 1000 * 1024 * 1024,
      totalChunks: 50,
    });
    // Boundary fixture: signed storage manifests, not a 1 GiB byte transfer.
    const receipts = await Promise.all(
      Array.from({ length: 50 }, (_, idx) =>
        signChunkReceipt(
          key,
          { idx, file_id: `fixture-${idx}`, size: 20 * 1024 * 1024 },
          env.JWT_SECRET
        )
      )
    );
    assert.equal(
      (
        await send(
          "/api/v1/upload/chunk/complete",
          json(token, { key, receipts })
        )
      ).status,
      200
    );
    assert.equal(JSON.parse(await kv.get(key)).length, 50);
    const pageInit = await send("/upload/chunk/init", {
      method: "POST",
      headers: { ...admin, "Content-Type": "application/json" },
      body: JSON.stringify({
        fileType: "doc",
        fileName: "page.bin",
        fileSize: 4,
        totalChunks: 1,
        tags: ["private"],
      }),
    });
    assert.equal(pageInit.status, 200);
    const pageKey = (await pageInit.json()).data;
    const pageChunk = await send("/upload/chunk", {
      method: "POST",
      headers: admin,
      body: chunkForm(pageKey, 0, "test"),
    });
    assert.equal(pageChunk.status, 200);
    const pageReceipt = (await pageChunk.json()).data.receipt;
    assert.equal(
      (
        await send(
          "/api/v1/upload/chunk/complete",
          json(token, { key: pageKey, receipts: [pageReceipt] })
        )
      ).status,
      200
    );
    const apiKey = await initChunk(token, { fileSize: 4, totalChunks: 1 });
    const apiReceipt = (await (await putChunk(token, apiKey, 0, "test")).json())
      .data.receipt;
    assert.equal(
      (
        await send("/upload/chunk/complete", {
          method: "POST",
          headers: { ...admin, "Content-Type": "application/json" },
          body: JSON.stringify({ key: apiKey, receipts: [apiReceipt] }),
        })
      ).status,
      200
    );
  });

  it("rejects missing, malformed, administrator, legacy and cookie credentials", async () => {
    const { token } = await generate();
    await kv.put("oh_public_api_secret", "legacy-secret");
    const login = await send("/auth/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: '{"password":"password"}',
    });
    assert.equal(login.status, 200);
    const cookie = login.headers.get("Set-Cookie").match(/auth=([^;]+)/)[0];
    for (const headers of [
      {},
      admin,
      authorization("legacy-secret"),
      { Cookie: cookie },
      { Authorization: token },
      { Authorization: `Basic ${token}` },
      authorization(`${token}x`),
      authorization(`ohf_${"0".repeat(64)}`),
      { Authorization: `Bearer ${token} extra` },
    ]) {
      const response = await send("/api/v1/files", { headers });
      assert.equal(response.status, 401);
      assert.match(response.headers.get("WWW-Authenticate"), /^Bearer/);
      assert.match(response.headers.get("Cache-Control"), /no-store/);
    }
    assert.equal(
      (await send("/api/v1/files", { headers: authorization(token) })).status,
      200
    );
  });

  it("enforces independent read, write and delete scopes before file operations", async () => {
    await seed("doc:seed.txt");
    for (const scope of allScopes) {
      const { token } = await generate([scope]);
      const headers = authorization(token);
      for (const url of [
        "/api/v1/files",
        "/api/v1/files/doc:seed.txt",
        "/api/v1/files/doc:seed.txt/content",
      ]) {
        if (scope !== "files:read")
          assert.equal((await send(url, { headers })).status, 403);
      }
      if (scope !== "files:write") {
        assert.equal(
          (
            await send("/api/v1/files", {
              method: "POST",
              headers,
              body: form(),
            })
          ).status,
          403
        );
        assert.equal(
          (
            await send("/api/v1/files/doc:seed.txt", {
              method: "PATCH",
              headers,
              body: "{}",
            })
          ).status,
          403
        );
      }
      if (scope !== "files:delete")
        assert.equal(
          (
            await send("/api/v1/files/doc:seed.txt", {
              method: "DELETE",
              headers,
            })
          ).status,
          403
        );
    }
    assert.equal(objects.size, 0);
    assert.ok((await kv.getWithMetadata("doc:seed.txt")).metadata);
  });

  it("uploads private files, lists them, downloads ranges, edits metadata and moves to trash", async () => {
    const { token } = await generate();
    const headers = authorization(token);
    const item = await upload(token);
    const url = `/api/v1/files/${encodeURIComponent(item.key)}`;
    assert.equal(item.metadata.fileName, "测试.txt");
    assert.equal(item.metadata.fileSize, 4);
    assert.deepEqual(item.metadata.tags, ["private"]);
    const listed = await send("/api/v1/files?fileType=doc", { headers });
    assert.deepEqual((await listed.json()).data.files, [item]);
    assert.equal((await send(`/file/${item.key}`)).status, 401);
    assert.equal(
      await (await send(`${url}/content`, { headers })).text(),
      "test"
    );
    const range = await send(`${url}/content`, {
      headers: { ...headers, Range: "bytes=1-2" },
    });
    assert.equal(range.status, 206);
    assert.equal(await range.text(), "es");
    assert.equal(range.headers.get("Content-Range"), "bytes 1-2/4");
    assert.match(range.headers.get("Cache-Control"), /no-store/);
    const updated = await send(url, {
      method: "PATCH",
      headers: { ...headers, "Content-Type": "application/json" },
      body: JSON.stringify({
        fileName: "renamed.txt",
        tags: ["private", "nsfw"],
        desc: "new",
        liked: true,
      }),
    });
    assert.equal(updated.status, 200);
    const metadata = (await updated.json()).data.metadata;
    assert.equal(metadata.fileName, "renamed.txt");
    assert.equal(metadata.liked, true);
    assert.equal(metadata.desc, "new");
    assert.deepEqual(
      (await (await send(url, { headers })).json()).data.metadata,
      metadata
    );
    assert.ok(
      deletedCaches.some((cacheUrl) => cacheUrl.endsWith(`/file/${item.key}`))
    );
    const deleted = await send(url, { method: "DELETE", headers });
    assert.equal(deleted.status, 200);
    assert.equal((await deleted.json()).data.permanent, false);
    assert.equal((await send(url, { headers })).status, 404);
    assert.ok((await kv.getWithMetadata(`trash:${item.key}`)).metadata);
    assert.equal(objects.size, 1);
    assert.equal((await send(url, { method: "DELETE", headers })).status, 404);
  });

  it("permanently deletes backing storage only when explicitly requested", async () => {
    const { token } = await generate();
    const item = await upload(token);
    const url = `/api/v1/files/${encodeURIComponent(item.key)}`;
    assert.equal(
      (
        await send(`${url}?permanent=yes`, {
          method: "DELETE",
          headers: authorization(token),
        })
      ).status,
      400
    );
    const response = await send(`${url}?permanent=true`, {
      method: "DELETE",
      headers: authorization(token),
    });
    assert.equal(response.status, 200);
    assert.equal((await response.json()).data.permanent, true);
    assert.equal(objects.size, 0);
    assert.equal((await kv.getWithMetadata(item.key)).metadata, null);
  });

  it("filters internal records, strips provider metadata and preserves cursors across empty pages", async () => {
    const { token } = await generate();
    await kv.put("aaa-settings", "private-config", {
      metadata: { password: "hidden" },
    });
    await seed("doc:seed.txt", {
      telegramMessages: [{ chatId: "secret", messageId: 1 }],
      thumbUrl: "internal",
    });
    await seed("trash:doc:removed.txt");
    await seed("share:token");
    let cursor,
      complete = false;
    const found = [];
    let emptyPages = 0;
    for (let page = 0; !complete && page < 10; page++) {
      const response = await send(
        `/api/v1/files?limit=1${cursor ? `&cursor=${cursor}` : ""}`,
        { headers: authorization(token) }
      );
      assert.equal(response.status, 200);
      const data = (await response.json()).data;
      found.push(...data.files);
      if (!data.files.length) emptyPages++;
      cursor = data.cursor;
      complete = data.list_complete;
    }
    assert.equal(complete, true);
    assert.ok(emptyPages > 0);
    assert.deepEqual(
      found.map((item) => item.key),
      ["doc:seed.txt"]
    );
    assert.equal(JSON.stringify(found).includes("secret"), false);
    assert.equal(JSON.stringify(found).includes("internal"), false);
    assert.equal(cursor, null);
  });

  it("blocks non-file namespaces on every single-file operation", async () => {
    const { token } = await generate();
    for (const key of [
      "oh_file_api_token",
      "share:token",
      "trash:doc:seed.txt",
      "doc:folder/file.txt",
      "doc:bad\\file.txt",
    ]) {
      const url = `/api/v1/files/${encodeURIComponent(key)}`;
      for (const method of ["GET", "PATCH", "DELETE"]) {
        assert.equal(
          (await send(url, { method, headers: authorization(token) })).status,
          400,
          `${method} ${key}`
        );
      }
      assert.equal(
        (await send(`${url}/content`, { headers: authorization(token) }))
          .status,
        400
      );
    }
    assert.ok(await kv.get("oh_file_api_token"));
  });

  it("validates upload and metadata inputs and rejects immutable or unknown fields", async () => {
    const { token } = await generate();
    const headers = authorization(token);
    for (const query of [
      "limit=0",
      "limit=1001",
      "limit=abc",
      "fileType=trash",
      "unknown=true",
    ]) {
      assert.equal(
        (await send(`/api/v1/files?${query}`, { headers })).status,
        400
      );
    }
    assert.equal(
      (await send("/api/v1/files", { method: "POST", headers, body: "raw" }))
        .status,
      415
    );
    for (const data of [
      new FormData(),
      form("a.txt", ["unknown"]),
      form("a".repeat(129)),
      form("a.txt", []),
    ]) {
      if (data.get("file")?.name === "a.txt" && data.get("tags") === "[]")
        data.set("tags", "invalid-json");
      assert.equal(
        (await send("/api/v1/files", { method: "POST", headers, body: data }))
          .status,
        400
      );
    }
    const duplicate = form();
    duplicate.append("file", new File(["x"], "other.txt"));
    assert.equal(
      (
        await send("/api/v1/files", {
          method: "POST",
          headers,
          body: duplicate,
        })
      ).status,
      400
    );
    await seed("doc:seed.txt");
    for (const input of [
      {},
      { fileSize: 123 },
      { fileName: "../bad" },
      { tags: ["unknown"] },
      { liked: "true" },
      { desc: "x".repeat(301) },
    ]) {
      const response = await send("/api/v1/files/doc:seed.txt", {
        method: "PATCH",
        headers: { ...headers, "Content-Type": "application/json" },
        body: JSON.stringify(input),
      });
      assert.equal(response.status, 400);
    }
    assert.equal(
      (await send("/api/v1/files/doc:missing.txt", { headers })).status,
      404
    );
    const badJson = await send("/api/v1/files/doc:seed.txt", {
      method: "PATCH",
      headers: { ...headers, "Content-Type": "application/json" },
      body: "{",
    });
    assert.equal(badJson.status, 400);
    assert.equal(objects.size, 0);
  });

  it("bounds uploads using declared and actual sizes, including streaming requests", async () => {
    const { token } = await generate();
    const headers = {
      ...authorization(token),
      "Content-Type": "multipart/form-data; boundary=test",
    };
    const oversized = await send("/api/v1/files", {
      method: "POST",
      headers: { ...headers, "Content-Length": String(21 * 1024 * 1024) },
      body: "x",
    });
    assert.equal(oversized.status, 413);
    let cancelled = false;
    const stream = new ReadableStream({
      pull(controller) {
        controller.enqueue(new Uint8Array(1024 * 1024));
      },
      cancel() {
        cancelled = true;
      },
    });
    const actual = await send("/api/v1/files", {
      method: "POST",
      headers: { ...headers, "Content-Length": "1" },
      body: stream,
      duplex: "half",
    });
    assert.equal(actual.status, 413);
    assert.equal(cancelled, true);
    const fileLimit = await send("/api/v1/files", {
      method: "POST",
      headers: authorization(token),
      body: form("big.txt", [], new Uint8Array(20 * 1024 * 1024 + 1)),
    });
    assert.equal(fileLimit.status, 413);
    assert.equal(objects.size, 0);
  });

  it("expires, rotates and revokes tokens and validates issuance options", async () => {
    let { token } = await generate();
    const record = JSON.parse(await kv.get("oh_file_api_token"));
    record.expiresAt = Date.now() - 1;
    await kv.put("oh_file_api_token", JSON.stringify(record));
    assert.equal(
      (await send("/api/v1/files", { headers: authorization(token) })).status,
      401
    );
    assert.equal(
      (await (await send("/settings/file-api", { headers: admin })).json()).data
        .enabled,
      false
    );
    const fresh = await generate(["files:read"], null);
    assert.equal(fresh.status.expiresAt, undefined);
    assert.equal(
      (await send("/api/v1/files", { headers: authorization(token) })).status,
      401
    );
    token = fresh.token;
    assert.equal(
      (await send("/api/v1/files", { headers: authorization(token) })).status,
      200
    );
    assert.equal(
      (await send("/settings/file-api", { method: "DELETE", headers: admin }))
        .status,
      200
    );
    assert.equal(
      (await send("/api/v1/files", { headers: authorization(token) })).status,
      401
    );
    for (const input of [
      { scopes: [] },
      { scopes: ["admin"] },
      { expiresInDays: 0 },
      { expiresInDays: 1.5 },
      { expiresInDays: 3651 },
    ]) {
      assert.equal(
        (
          await send("/settings/file-api/rotate", {
            method: "POST",
            headers: { ...admin, "Content-Type": "application/json" },
            body: JSON.stringify(input),
          })
        ).status,
        400
      );
    }
  });

  (process.env.TG_SIM_URL ? it : it.skip)(
    "runs scoped upload, download and permanent deletion through Telegram HTTP",
    async () => {
      const simulation = process.env.TG_SIM_URL;
      await fetch(`${simulation}/__reset`);
      env.TG_BOT_TOKEN = "ok";
      env.TG_CHAT_ID = "test-chat";
      env.TG_API_BASE_URL = simulation;
      const { token } = await generate();
      const item = await upload(token, form("api.bin", ["private"]));
      const url = `/api/v1/files/${encodeURIComponent(item.key)}`;
      const response = await send(`${url}/content`, {
        headers: authorization(token),
      });
      assert.equal(response.status, 200);
      assert.equal(await response.text(), "test");
      const deleted = await send(`${url}?permanent=true`, {
        method: "DELETE",
        headers: authorization(token),
      });
      assert.equal(deleted.status, 200);
      assert.equal((await kv.getWithMetadata(item.key)).metadata, null);
      const stats = await (await fetch(`${simulation}/__stats`)).json();
      for (const suffix of ["/sendDocument", "/getFile", "/deleteMessage"]) {
        assert.ok(
          stats.calls.some((call) => call.path.endsWith(suffix)),
          suffix
        );
      }
      assert.ok(stats.calls.some((call) => call.path.startsWith("/file/")));
      const chunkKey = await initChunk(token, { fileSize: 4, totalChunks: 1 });
      const chunk = await putChunk(token, chunkKey, 0, "test");
      assert.equal(chunk.status, 200, await chunk.clone().text());
      const receipt = (await chunk.json()).data.receipt;
      const completed = await send(
        "/api/v1/upload/chunk/complete",
        json(token, { key: chunkKey, receipts: [receipt] })
      );
      assert.equal(completed.status, 200);
      assert.equal((await completed.text()).includes("telegramMessage"), false);
      const chunkDownload = await send(
        `/api/v1/files/${encodeURIComponent(chunkKey)}/content`,
        { headers: authorization(token) }
      );
      assert.equal(chunkDownload.status, 200);
      assert.equal(await chunkDownload.text(), "test");
      assert.equal(
        (
          await send(
            `/api/v1/files/${encodeURIComponent(chunkKey)}?permanent=true`,
            { method: "DELETE", headers: authorization(token) }
          )
        ).status,
        200
      );
    }
  );
});
