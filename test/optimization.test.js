const assert = require("node:assert/strict");
const http = require("node:http");
const Module = require("node:module");
const path = require("node:path");
const { buildSync } = require("esbuild");

class MemoryKV {
  records = new Map();
  writes = [];
  reads = 0;
  hideReceiptList = false;
  async put(key, value, options = {}) {
    this.writes.push(key);
    this.records.set(key, {
      value,
      metadata: structuredClone(options.metadata),
      expirationTtl: options.expirationTtl,
    });
  }
  async get(key, type) {
    this.reads++;
    const value = this.records.get(key)?.value ?? null;
    return type === "json" && value ? JSON.parse(value) : value;
  }
  async getWithMetadata(key) {
    this.reads++;
    const item = this.records.get(key);
    return item ? structuredClone(item) : { value: null, metadata: null };
  }
  async delete(key) {
    this.records.delete(key);
  }
  async list({ prefix = "", limit = 1000 } = {}) {
    return {
      keys: [...this.records]
        .filter(([key]) => key.startsWith(prefix))
        .filter(([key]) => !this.hideReceiptList || !key.startsWith("upload:"))
        .slice(0, limit)
        .map(([name, record]) => ({
          name,
          metadata: structuredClone(record.metadata),
        })),
      list_complete: true,
    };
  }
}

function memoryCaches() {
  const entries = new Map();
  return {
    async open() {
      return {
        async match(request) {
          return entries.get(request.url)?.clone();
        },
        async put(request, response) {
          entries.set(request.url, response.clone());
        },
        async delete(request) {
          return entries.delete(request.url);
        },
      };
    },
  };
}

describe("Optimization regressions", function () {
  this.timeout(15_000);
  let api;
  let server;
  let origin;
  let listHandler;
  let requestCounts;
  const originalWindow = global.window;
  const originalStorage = global.localStorage;
  const originalCaches = global.caches;
  const simulation = process.env.TG_SIM_URL;
  const auth = { Authorization: "Bearer test-token" };
  const context = {
    waitUntil(promise) {
      promise.catch(() => undefined);
    },
    passThroughOnException() {},
  };
  const makeMetadata = (size, total = 1) => ({
    fileName: "test.bin",
    fileSize: size,
    uploadedAt: Date.now(),
    liked: false,
    tags: ["private"],
    chunkInfo: { total, uploadedIndices: [] },
  });
  const makeEnv = (kv = new MemoryKV()) => ({
    oh_file_url: kv,
    JWT_SECRET: "test-secret-for-chunk-receipt-validation",
    API_TOKEN: "test-token",
    TG_BOT_TOKEN: "ok",
    TG_CHAT_ID: "test-chat",
    TG_API_BASE_URL: simulation,
  });
  const send = (env, url, options = {}) =>
    api.app.request(
      url,
      {
        ...options,
        headers: { ...auth, ...options.headers },
      },
      env,
      context
    );

  before(async () => {
    requestCounts = {};
    server = http.createServer(async (req, res) => {
      requestCounts[req.url] = (requestCounts[req.url] || 0) + 1;
      if (req.url.startsWith("/file/list")) return listHandler(req, res);
      await new Promise((resolve) => setTimeout(resolve, 15));
      const transient =
        req.url === "/transient" && requestCounts[req.url] === 1;
      res.writeHead(
        req.url === "/write" || transient
          ? 503
          : req.url === "/unauthorized"
            ? 401
            : 200,
        { "Content-Type": "application/json", "Retry-After": "0" }
      );
      res.end(JSON.stringify({ ok: true }));
    });
    await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
    origin = `http://127.0.0.1:${server.address().port}`;
    global.window = {
      location: { origin, hostname: "127.0.0.1", pathname: "/" },
    };
    const storage = new Map();
    global.localStorage = {
      getItem: (key) => storage.get(key) ?? null,
      setItem: (key, value) => storage.set(key, value),
      removeItem: (key) => storage.delete(key),
    };
    global.caches = memoryCaches();
    const bundled = buildSync({
      entryPoints: [path.join(__dirname, "optimization-entry.ts")],
      bundle: true,
      write: false,
      platform: "node",
      format: "cjs",
      tsconfig: path.join(__dirname, "../frontend/tsconfig.json"),
      logLevel: "silent",
    });
    const compiled = new Module(
      path.join(__dirname, "optimization-entry.cjs"),
      module
    );
    compiled.filename = path.join(__dirname, "optimization-entry.cjs");
    compiled.paths = module.paths;
    compiled._compile(bundled.outputFiles[0].text, compiled.filename);
    api = compiled.exports;
  });

  after(async () => {
    global.window = originalWindow;
    global.localStorage = originalStorage;
    global.caches = originalCaches;
    server?.closeAllConnections();
    if (server) await new Promise((resolve) => server.close(resolve));
  });

  it("coalesces simultaneous reads while keeping response bodies independently readable", async () => {
    const request = api.createApiFetch();
    const responses = await Promise.all(
      Array.from({ length: 5 }, () => request(`${origin}/read`))
    );
    assert.equal(requestCounts["/read"], 1);
    assert.deepEqual(
      await Promise.all(responses.map((response) => response.json())),
      Array.from({ length: 5 }, () => ({ ok: true }))
    );
  });

  it("retries a transient read once and never repeats a write or an unauthorized read", async () => {
    const request = api.createApiFetch();
    assert.equal((await request(`${origin}/transient`)).status, 200);
    assert.equal(requestCounts["/transient"], 2);
    assert.equal(
      (await request(`${origin}/write`, { method: "POST", body: "payload" }))
        .status,
      503
    );
    assert.equal(requestCounts["/write"], 1);
    assert.equal((await request(`${origin}/unauthorized`)).status, 401);
    assert.equal(requestCounts["/unauthorized"], 1);
  });

  it("does not merge reads with different credentials or caller cancellation", async () => {
    const request = api.createApiFetch();
    const controller = new AbortController();
    const cancelled = request(`${origin}/cancel`, {
      signal: controller.signal,
    });
    const independent = request(`${origin}/cancel`);
    controller.abort();
    await assert.rejects(cancelled);
    assert.equal((await independent).status, 200);
    await Promise.all(
      ["one", "two"].map((value) =>
        request(`${origin}/auth`, { headers: { Authorization: value } })
      )
    );
    assert.equal(requestCounts["/auth"], 2);
  });

  it("only redirects login to paths on the current origin", () => {
    const base = "https://app.example";
    assert.equal(api.getSafeRedirectPath(null, base), "/");
    assert.equal(
      api.getSafeRedirectPath("/?tab=doc#files", base),
      "/?tab=doc#files"
    );
    assert.equal(
      api.getSafeRedirectPath(`${base}/s?k=token`, base),
      "/s?k=token"
    );
    for (const redirect of [
      "//evil.example",
      "/\\evil.example",
      "https://app.example.evil.example",
      "https://app.example@evil.example",
      "https://app.example//evil.example",
      "javascript:alert(1)",
    ]) {
      assert.equal(api.getSafeRedirectPath(redirect, base), "/", redirect);
    }
  });

  it("uses the configured backend for every frontend hostname", () => {
    for (const backend of ["http://localhost:8788/", ""]) {
      const bundled = buildSync({
        entryPoints: [path.join(__dirname, "../frontend/lib/api/config.ts")],
        bundle: true,
        write: false,
        platform: "node",
        format: "cjs",
        define: {
          "process.env.NEXT_PUBLIC_BACKEND_URL": JSON.stringify(backend),
        },
        logLevel: "silent",
      });
      const compiled = new Module(
        path.join(__dirname, "api-config.cjs"),
        module
      );
      compiled.filename = path.join(__dirname, "api-config.cjs");
      compiled._compile(bundled.outputFiles[0].text, compiled.filename);
      assert.equal(
        compiled.exports.API_URL,
        backend ? "http://localhost:8788" : origin
      );
    }
  });

  it("keeps adapter instances isolated between environments", () => {
    const first = makeEnv();
    const second = makeEnv();
    assert.equal(
      api.DBAdapterFactory.getAdapter(first),
      api.DBAdapterFactory.getAdapter(first)
    );
    assert.notEqual(
      api.DBAdapterFactory.getAdapter(first),
      api.DBAdapterFactory.getAdapter(second)
    );
  });

  it("bounds upload concurrency across files and releases slots after a failure", async () => {
    const run = api.createUploadQueue(2);
    let active = 0;
    let peak = 0;
    const results = await Promise.allSettled(
      Array.from({ length: 7 }, (_, index) =>
        run(async () => {
          active++;
          peak = Math.max(peak, active);
          try {
            await new Promise((resolve) => setImmediate(resolve));
            if (index === 1) throw new Error("upload failed");
            return index;
          } finally {
            active--;
          }
        })
      )
    );
    assert.equal(peak, 2);
    assert.equal(active, 0);
    assert.equal(
      results.filter((result) => result.status === "fulfilled").length,
      6
    );
    assert.equal(await run(async () => "next"), "next");
  });

  it("returns null for missing file metadata", async () => {
    const adapter = new api.TGAdapter(makeEnv(), "oh_file_url");
    assert.equal(await adapter.getFileMetadataWithValue("missing"), null);
    await assert.rejects(adapter.moveToTrash("missing"), /File not found/);
  });

  it("requires authentication for file mutations and trash reads with static-looking extensions", async () => {
    const env = makeEnv();
    const key = "img:protected.svg";
    await env.oh_file_url.put(key, "", {
      metadata: { ...makeMetadata(3), chunkInfo: undefined, tags: [] },
    });
    for (const [url, method] of [
      [`/file/${key}`, "DELETE"],
      [`/trash/trash:${key}`, "GET"],
      ["/share/revoke/token.json", "DELETE"],
    ]) {
      const response = await api.app.request(url, { method }, env, context);
      assert.equal(response.status, 401, `${method} ${url}`);
    }
    assert.ok(env.oh_file_url.records.has(key));
  });

  it("does not accept a chunk receipt as an administrator session", async () => {
    const env = makeEnv();
    const key = "doc:receipt.bin";
    const receipt = await api.signChunkReceipt(
      key,
      { idx: 0, file_id: "stored", size: 3 },
      env.JWT_SECRET
    );
    await env.oh_file_url.put(key, "", { metadata: makeMetadata(3) });
    const headers = { Cookie: `auth=${receipt}` };
    for (const url of ["/file/list", `/file/${key}`]) {
      const response = await api.app.request(url, { headers }, env, context);
      assert.equal(response.status, 401, url);
    }
    const response = await api.app.request(
      "/file/list",
      { headers: { Cookie: "session=must-not-be-reflected" } },
      env,
      context
    );
    assert.equal(response.status, 401);
    assert.ok(!(await response.text()).includes("must-not-be-reflected"));
  });

  it("fails closed when the Telegram webhook secret is absent or incorrect", async () => {
    const env = makeEnv();
    const options = {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ update_id: 1 }),
    };
    const sendWebhook = (headers = {}) =>
      api.app.request(
        "/telegram/webhook",
        { ...options, headers: { ...options.headers, ...headers } },
        env,
        context
      );
    assert.equal((await sendWebhook()).status, 503);
    env.TG_WEBHOOK_SECRET = "webhook-secret";
    assert.equal((await sendWebhook()).status, 401);
    assert.equal(
      (await sendWebhook({ "X-Telegram-Bot-Api-Secret-Token": "wrong" }))
        .status,
      401
    );
    assert.equal(
      (
        await sendWebhook({
          "X-Telegram-Bot-Api-Secret-Token": env.TG_WEBHOOK_SECRET,
        })
      ).status,
      200
    );
  });

  it("keeps trashed public files private on raw and download routes", async () => {
    const env = makeEnv();
    const key = "trash:doc:public.txt";
    await env.oh_file_url.put(key, "", {
      metadata: { ...makeMetadata(3), chunkInfo: undefined, tags: [] },
    });
    for (const url of [`/file/${key}`, `/file/${key}/download`]) {
      const response = await api.app.request(url, {}, env, context);
      assert.equal(response.status, 401, url);
    }
  });

  it("rejects invalid trash transitions without deleting or nesting records", async () => {
    const env = makeEnv();
    const key = "doc:live.txt";
    const trashKey = `trash:${key}`;
    await env.oh_file_url.put(key, "live", { metadata: makeMetadata(4) });
    await env.oh_file_url.put(trashKey, "trash", { metadata: makeMetadata(5) });
    assert.equal(
      (await send(env, `/trash/${key}/restore`, { method: "POST" })).status,
      400
    );
    assert.equal(await env.oh_file_url.get(key), "live");
    assert.equal(
      (await send(env, `/trash/${trashKey}/move`, { method: "POST" })).status,
      400
    );
    assert.equal(await env.oh_file_url.get(trashKey), "trash");
    assert.ok(!env.oh_file_url.records.has(`trash:${trashKey}`));
  });

  it("permanently deletes the original R2 object when removing a trash record", async () => {
    const env = makeEnv();
    const key = "doc:stored.txt";
    const trashKey = `trash:${key}`;
    await env.oh_file_url.put(trashKey, "", {
      metadata: { ...makeMetadata(3), chunkInfo: undefined },
    });
    const deleted = [];
    env.oh_file_r2 = {
      async delete(name) {
        deleted.push(name);
      },
    };
    const adapter = new api.R2Adapter(env, "oh_file_r2", "oh_file_url");
    assert.deepEqual(await adapter.delete(trashKey), { isDeleted: true });
    assert.deepEqual(deleted, [key]);
    assert.ok(!env.oh_file_url.records.has(trashKey));
  });

  it("hides expired share records even when KV still returns their values", async () => {
    const env = makeEnv();
    await env.oh_file_url.put(
      "share:expired",
      JSON.stringify({
        type: "bundle",
        fileKeys: ["doc:old.txt"],
        files: [{ key: "doc:old.txt", name: "old.txt", size: 3 }],
        totalSize: 3,
        createdAt: Date.now() - 120_000,
        expiresAt: Date.now() - 1,
      })
    );
    for (const path of ["meta", "raw?file=doc:old.txt", "download-all"]) {
      assert.equal(
        (await api.app.request(`/share/expired/${path}`, {}, env, context))
          .status,
        404,
        path
      );
    }
    const response = await send(env, "/share/list");
    assert.deepEqual((await response.json()).data, []);
  });

  it("rejects share lifetimes that KV cannot store", async () => {
    const env = makeEnv();
    for (const expireIn of [-1, 1, 59, 60.5]) {
      const response = await send(env, "/share/create", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ fileKey: "doc:missing.txt", expireIn }),
      });
      assert.equal(response.status, 400, `expireIn=${expireIn}`);
    }
  });

  it("lists shares across KV pages including empty intermediate pages", async () => {
    const env = makeEnv();
    const data = {
      type: "single",
      fileKey: "doc:shared.txt",
      fileName: "shared.txt",
      fileSize: 3,
      createdAt: Date.now(),
    };
    await env.oh_file_url.put("share:page-two", JSON.stringify(data));
    const cursors = [];
    env.oh_file_url.list = async ({ cursor }) => {
      cursors.push(cursor);
      return cursor
        ? { keys: [{ name: "share:page-two" }], list_complete: true }
        : { keys: [], list_complete: false, cursor: "second-page" };
    };
    const response = await send(env, "/share/list");
    assert.equal(response.status, 200);
    assert.deepEqual((await response.json()).data, [
      { token: "page-two", ...data },
    ]);
    assert.deepEqual(cursors, [undefined, "second-page"]);
  });

  it("does not allow browsers or proxies to cache share responses after revocation", async () => {
    const env = makeEnv();
    delete env.TG_BOT_TOKEN;
    const key = "doc:shared.txt";
    await env.oh_file_url.put(key, "", {
      metadata: { ...makeMetadata(3), chunkInfo: undefined },
    });
    await env.oh_file_url.put(
      "share:active",
      JSON.stringify({
        type: "single",
        fileKey: key,
        fileName: "shared.txt",
        fileSize: 3,
        createdAt: Date.now(),
      })
    );
    env.oh_file_r2 = {
      async get() {
        return {
          size: 3,
          body: new Blob(["abc"]).stream(),
          httpEtag: "test",
          writeHttpMetadata(headers) {
            headers.set("Cache-Control", "public, max-age=3600");
          },
        };
      },
    };
    for (const path of ["meta", "raw"]) {
      const response = await api.app.request(
        `/share/active/${path}`,
        {},
        env,
        context
      );
      assert.equal(response.status, 200);
      assert.match(response.headers.get("Cache-Control") ?? "", /no-store/);
      await response.arrayBuffer();
    }
  });

  it("supports suffix ranges, clamps the end, and rejects malformed ranges", () => {
    assert.deepEqual(api.parseRangeHeader("bytes=-3", 10), {
      start: 7,
      end: 9,
    });
    assert.deepEqual(api.parseRangeHeader("bytes=3-99", 10), {
      start: 3,
      end: 9,
    });
    assert.equal(api.parseRangeHeader("bytes=10-", 10), null);
    assert.equal(api.parseRangeHeader("bytes=0-1,3-4", 10), null);
  });

  it("loads download chunks on demand and stops upstream reads after cancellation", async () => {
    let opened = 0;
    let signal;
    const chunks = Array.from({ length: 20 }, (_, idx) => ({
      idx,
      file_id: String(idx),
      size: 1,
    }));
    const stream = api.createChunkStream(
      chunks,
      0,
      19,
      async (_chunk, _range, abortSignal) => {
        opened++;
        signal = abortSignal;
        return new Blob(["a"]).stream();
      }
    );
    const reader = stream.getReader();
    assert.equal(new TextDecoder().decode((await reader.read()).value), "a");
    await new Promise((resolve) => setImmediate(resolve));
    assert.ok(opened <= 2);
    await reader.cancel();
    const afterCancel = opened;
    await new Promise((resolve) => setImmediate(resolve));
    assert.equal(opened, afterCancel);
    assert.ok(signal.aborted);
  });

  it("does not lose simultaneous chunks or reupload a confirmed chunk", async () => {
    const kv = new MemoryKV();
    const key = "doc:chunk_concurrent.bin";
    await kv.put(key, "", {
      metadata: makeMetadata(api.MAX_CHUNK_SIZE + 3, 2),
      expirationTtl: 3600,
    });
    let uploads = 0;
    class Adapter extends api.BaseAdapter {
      async uploadToTarget(_file, _key, index) {
        uploads++;
        await new Promise((resolve) => setTimeout(resolve, 10));
        return `chunk-${index}`;
      }
    }
    const adapter = new Adapter({ oh_file_url: kv }, "oh_file_url");
    const first = new Blob([new Uint8Array(api.MAX_CHUNK_SIZE)]);
    const final = new Blob(["end"]);
    const [a, b, duplicate] = await Promise.all([
      adapter.uploadChunk(key, 0, first),
      adapter.uploadChunk(key, 1, final),
      adapter.uploadChunk(key, 0, first),
    ]);
    assert.equal(uploads, 2);
    assert.deepEqual(a.chunk, duplicate.chunk);
    assert.equal(kv.writes.filter((name) => name === key).length, 1);
    await adapter.uploadChunk(key, 0, first);
    assert.equal(uploads, 2);
    const metadata = await api.finalizeUpload(
      kv,
      key,
      await kv.getWithMetadata(key),
      [b.chunk, a.chunk]
    );
    assert.deepEqual(metadata.chunkInfo.uploadedIndices, [0, 1]);
    assert.deepEqual(metadata.tags, ["private"]);
    assert.equal(kv.records.get(key).expirationTtl, undefined);
    await api.finalizeUpload(kv, key, await kv.getWithMetadata(key), [
      a.chunk,
      b.chunk,
    ]);
    assert.equal(kv.writes.filter((name) => name === key).length, 2);
  });

  it("rejects wrong chunk sizes and indices before touching upstream storage", async () => {
    const kv = new MemoryKV();
    const key = "doc:chunk_invalid.bin";
    await kv.put(key, "", { metadata: makeMetadata(3) });
    let uploads = 0;
    class Adapter extends api.BaseAdapter {
      async uploadToTarget() {
        uploads++;
        return "unused";
      }
    }
    const adapter = new Adapter({ oh_file_url: kv }, "oh_file_url");
    await assert.rejects(
      adapter.uploadChunk(key, -1, new Blob(["abc"])),
      /Invalid chunk/
    );
    await assert.rejects(
      adapter.uploadChunk(key, 0, new Blob(["ab"])),
      /Invalid chunk/
    );
    assert.equal(uploads, 0);
  });

  it("verifies receipt signatures and binds them to a file", async () => {
    const chunk = { idx: 0, file_id: "stored", size: 3 };
    const receipt = await api.signChunkReceipt("doc:one.bin", chunk, "secret");
    assert.deepEqual(
      await api.verifyChunkReceipt("doc:one.bin", receipt, "secret"),
      chunk
    );
    await assert.rejects(
      api.verifyChunkReceipt("doc:two.bin", receipt, "secret")
    );
    await assert.rejects(
      api.verifyChunkReceipt("doc:one.bin", receipt, "wrong")
    );
    await assert.rejects(
      api.verifyChunkReceipt("doc:one.bin", `${receipt}x`, "secret")
    );
  });

  it("finalizes with signed receipts even when KV receipt listing is stale", async () => {
    const env = makeEnv();
    const key = "doc:chunk_stale.bin";
    await env.oh_file_url.put(key, "", { metadata: makeMetadata(3) });
    env.oh_file_url.hideReceiptList = true;
    const receipt = await api.signChunkReceipt(
      key,
      { idx: 0, file_id: "stored", size: 3 },
      env.JWT_SECRET
    );
    const response = await send(env, "/upload/chunk/complete", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ key, receipts: [receipt] }),
    });
    assert.equal(response.status, 200);
    assert.deepEqual(
      (await response.json()).data.chunkInfo.uploadedIndices,
      [0]
    );
  });

  it("validates list limits and chunk declarations, and hides internal receipts", async () => {
    const env = makeEnv();
    assert.equal((await send(env, "/file/list?limit=nan")).status, 400);
    assert.equal((await send(env, "/file/list?limit=2oops")).status, 400);
    const response = await send(env, "/upload/chunk/init", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        fileType: "doc",
        fileName: "invalid.bin",
        fileSize: 3,
        totalChunks: 2,
      }),
    });
    assert.equal(response.status, 400);
    await env.oh_file_url.put("upload:internal:0", "{}", { metadata: {} });
    await env.oh_file_url.put("doc:valid.bin", "", {
      metadata: makeMetadata(3),
    });
    const list = await (await send(env, "/file/list")).json();
    assert.deepEqual(
      list.data.keys.map((item) => item.name),
      ["doc:valid.bin"]
    );
  });

  it("reads R2 ranges with one storage read and reuses authorized metadata", async () => {
    const env = makeEnv();
    delete env.TG_BOT_TOKEN;
    const key = "doc:single.bin";
    await env.oh_file_url.put(key, "", {
      metadata: { ...makeMetadata(6), chunkInfo: undefined },
    });
    let reads = 0;
    env.oh_file_r2 = {
      async get(_key, options) {
        reads++;
        const range = options?.range.get("Range");
        assert.equal(range, "bytes=1-3");
        return {
          size: 6,
          body: new Blob(["bcd"]).stream(),
          httpEtag: "test",
          writeHttpMetadata() {},
        };
      },
    };
    const response = await send(env, `/file/${key}`, {
      headers: { Range: "bytes=1-3" },
    });
    assert.equal(response.status, 206);
    assert.equal(await response.text(), "bcd");
    assert.equal(reads, 1);
    assert.equal(env.oh_file_url.reads, 1);
    assert.equal(
      response.headers.get("Cache-Control"),
      "private, no-store, max-age=0"
    );
  });

  it("retains local uploads and deletes while an older list response is in flight", async () => {
    let reply;
    listHandler = async (_req, res) => {
      await new Promise((resolve) => {
        reply = resolve;
      });
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(
        JSON.stringify({
          success: true,
          data: {
            keys: [{ name: "img:deleted.png", metadata: makeMetadata(3) }],
            list_complete: true,
          },
        })
      );
    };
    const store = api.useFileDataStore;
    const loading = store.getState().fetchBucket(api.FileType.Image);
    while (!reply) await new Promise((resolve) => setImmediate(resolve));
    const added = { name: "img:local.png", metadata: makeMetadata(3) };
    store.getState().addFileLocal(added, api.FileType.Image);
    store.getState().addFileLocal(added, api.FileType.Image);
    store.getState().deleteFilesLocal(["img:deleted.png"]);
    reply();
    await loading;
    assert.deepEqual(
      store.getState().buckets.img.items.map((item) => item.name),
      ["img:local.png"]
    );
    const file = store.getState().buckets.img.items[0];
    await store.getState().moveToTrashLocal(file);
    assert.equal(file.name, "img:local.png");
    assert.equal(
      store.getState().buckets.trash.items[0].name,
      "trash:img:local.png"
    );
  });

  (simulation ? describe : describe.skip)(
    "Telegram HTTP simulation",
    function () {
      beforeEach(async () => {
        global.caches = memoryCaches();
        await fetch(`${simulation}/__reset`);
      });
      const stats = async () => (await fetch(`${simulation}/__stats`)).json();

      it("completes an upload through actual HTTP without any progress polling", async () => {
        const env = makeEnv();
        const initialized = await send(env, "/upload/chunk/init", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            fileType: "doc",
            fileName: "test.bin",
            fileSize: 4,
            totalChunks: 1,
            tags: ["private"],
          }),
        });
        const key = (await initialized.json()).data;
        const form = new FormData();
        form.append("key", key);
        form.append("chunkIndex", "0");
        form.append("chunkFile", new File(["test"], "part"));
        form.append("returnReceipt", "true");
        const uploaded = await send(env, "/upload/chunk", {
          method: "POST",
          body: form,
        });
        assert.equal(uploaded.status, 200);
        const { receipt } = (await uploaded.json()).data;
        const completed = await send(env, "/upload/chunk/complete", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ key, receipts: [receipt] }),
        });
        assert.equal(completed.status, 200);
        assert.deepEqual((await completed.json()).data.tags, ["private"]);
        const manifest = JSON.parse(
          (await env.oh_file_url.getWithMetadata(key)).value
        );
        assert.deepEqual(manifest[0].telegramMessage, {
          chatId: "test-chat",
          messageId: 1,
        });
        assert.equal((await stats()).uploads, 1);
        assert.equal(
          env.oh_file_url.writes.filter((name) => name === key).length,
          2
        );
      });

      it("honors Telegram rate limits and retries an HTML gateway error", async () => {
        for (const token of ["rate", "html"]) {
          const env = { ...makeEnv(), TG_BOT_TOKEN: token };
          const adapter = new api.TGAdapter(env, "oh_file_url");
          await adapter.uploadFile(new File(["test"], "test.bin"), {
            ...makeMetadata(4),
            chunkInfo: undefined,
          });
          const calls = (await stats()).calls.filter(
            (call) => call.path === `/bot${token}/sendDocument`
          );
          assert.equal(calls.length, 2);
        }
      });

      it("does not repeat requests rejected for authorization or bad input", async () => {
        for (const token of ["denied", "badrequest"]) {
          const adapter = new api.TGAdapter(
            { ...makeEnv(), TG_BOT_TOKEN: token },
            "oh_file_url"
          );
          await assert.rejects(
            adapter.uploadFile(new File(["test"], "test.bin"), makeMetadata(4))
          );
          const calls = (await stats()).calls.filter(
            (call) => call.path === `/bot${token}/sendDocument`
          );
          assert.equal(calls.length, 1);
        }
      });

      it("fetches correct byte ranges across Telegram chunks", async () => {
        const env = makeEnv();
        const key = "doc:chunk_range.bin";
        const chunks = [
          { idx: 0, file_id: "part-0", size: 6 },
          { idx: 1, file_id: "part-1", size: 9 },
        ];
        await env.oh_file_url.put(key, JSON.stringify(chunks), {
          metadata: {
            ...makeMetadata(15, 2),
            chunkInfo: { total: 2, uploadedIndices: [0, 1] },
          },
        });
        const response = await send(env, `/file/${key}`, {
          headers: { Range: "bytes=3-10" },
        });
        assert.equal(response.status, 206);
        assert.equal(await response.text(), "DEF12345");
        assert.equal(response.headers.get("Content-Length"), "8");
        assert.equal(env.oh_file_url.reads, 1);
        const downloads = (await stats()).calls.filter((call) =>
          call.path.startsWith("/file/")
        );
        assert.deepEqual(
          downloads.map((call) => call.range),
          ["bytes=3-5", "bytes=0-4"]
        );
      });

      it("caches thumbnail bytes and shares concurrent getFile lookups", async () => {
        const env = makeEnv();
        const responses = await Promise.all(
          Array.from({ length: 4 }, () => send(env, "/file/thumb/thumb"))
        );
        assert.deepEqual(
          await Promise.all(responses.map((response) => response.text())),
          ["jpeg", "jpeg", "jpeg", "jpeg"]
        );
        const calls = (await stats()).calls.filter(
          (call) => call.path === "/botok/getFile"
        );
        assert.equal(calls.length, 1);
        const response = await send(env, "/file/thumb/thumb");
        assert.equal(await response.text(), "jpeg");
        const after = await stats();
        assert.equal(
          after.calls.filter((call) => call.path === "/botok/getFile").length,
          1
        );
      });

      it("deletes an uploaded file's chat message before removing its trash record", async () => {
        const env = makeEnv();
        const adapter = new api.TGAdapter(env, "oh_file_url");
        const { key } = await adapter.uploadFile(
          new File(["test"], "test.bin"),
          {
            ...makeMetadata(4),
            chunkInfo: undefined,
          }
        );
        assert.deepEqual(
          (await env.oh_file_url.getWithMetadata(key)).metadata
            .telegramMessages,
          [{ chatId: "test-chat", messageId: 1 }]
        );
        await adapter.moveToTrash(key);
        assert.equal((await stats()).deleted.length, 0);
        const response = await send(env, `/file/trash:${key}`, {
          method: "DELETE",
        });
        assert.equal(response.status, 200);
        assert.equal(
          (await env.oh_file_url.getWithMetadata(`trash:${key}`)).metadata,
          null
        );
        const calls = (await stats()).calls.filter((call) =>
          call.path.endsWith("/deleteMessage")
        );
        assert.deepEqual(
          calls.map((call) => call.body),
          [{ chat_id: "test-chat", message_id: 1 }]
        );
      });

      it("retains all chat references when uploads return the same file identifier", async () => {
        const env = { ...makeEnv(), TG_BOT_TOKEN: "duplicate" };
        const adapter = new api.TGAdapter(env, "oh_file_url");
        const upload = () =>
          adapter.uploadFile(new File(["test"], "test.bin"), {
            ...makeMetadata(4),
            chunkInfo: undefined,
          });
        const first = await upload();
        const second = await upload();
        assert.equal(first.key, second.key);
        assert.deepEqual(
          (await env.oh_file_url.getWithMetadata(first.key)).metadata
            .telegramMessages,
          [
            { chatId: "test-chat", messageId: 1 },
            { chatId: "test-chat", messageId: 2 },
          ]
        );
        assert.deepEqual(await adapter.delete(first.key), { isDeleted: true });
        assert.deepEqual((await stats()).deleted, [
          "test-chat:1",
          "test-chat:2",
        ]);
      });

      it("removes every finalized chunk message and upload receipt from trash", async () => {
        const env = makeEnv();
        const key = "doc:chunk_delete.bin";
        const chunks = [
          {
            idx: 0,
            file_id: "one",
            size: api.MAX_CHUNK_SIZE,
            telegramMessage: { chatId: -100123, messageId: 1 },
          },
          {
            idx: 1,
            file_id: "two",
            size: 4,
            telegramMessage: { chatId: -100123, messageId: 2 },
          },
        ];
        await env.oh_file_url.put(key, "", {
          metadata: makeMetadata(api.MAX_CHUNK_SIZE + 4, 2),
        });
        for (const chunk of chunks) {
          await env.oh_file_url.put(
            api.chunkReceiptKey(key, chunk.idx),
            JSON.stringify(chunk),
            { metadata: chunk }
          );
        }
        await api.finalizeUpload(
          env.oh_file_url,
          key,
          await env.oh_file_url.getWithMetadata(key),
          chunks
        );
        const adapter = new api.TGAdapter(env, "oh_file_url");
        await adapter.moveToTrash(key);
        assert.deepEqual(await adapter.delete(`trash:${key}`), {
          isDeleted: true,
        });
        assert.deepEqual((await stats()).deleted, ["-100123:1", "-100123:2"]);
        assert.equal(
          await env.oh_file_url.get(api.chunkReceiptKey(key, 0)),
          null
        );
        assert.equal(
          await env.oh_file_url.get(api.chunkReceiptKey(key, 1)),
          null
        );
        assert.equal(
          (await env.oh_file_url.getWithMetadata(`trash:${key}`)).metadata,
          null
        );
      });

      it("retains records on Telegram time or permission failures", async () => {
        for (const token of ["expired", "nodelete"]) {
          const env = { ...makeEnv(), TG_BOT_TOKEN: token };
          const key = `doc:${token}.txt`;
          await env.oh_file_url.put(key, "", {
            metadata: {
              ...makeMetadata(4),
              chunkInfo: undefined,
              telegramMessages: [{ chatId: -100123, messageId: 1 }],
            },
          });
          const response = await send(env, `/file/${key}`, {
            method: "DELETE",
          });
          assert.equal(response.status, 500);
          assert.match(
            (await response.json()).message,
            token === "expired"
              ? /message can't be deleted/
              : /not enough rights/
          );
          assert.ok((await env.oh_file_url.getWithMetadata(key)).metadata);
          assert.equal(
            (await stats()).calls.filter(
              (call) => call.path === `/bot${token}/deleteMessage`
            ).length,
            1
          );
        }
      });

      it("safely retries a partial deletion when earlier messages are already gone", async () => {
        const env = { ...makeEnv(), TG_BOT_TOKEN: "partial" };
        const key = "doc:retry.txt";
        await env.oh_file_url.put(key, "", {
          metadata: {
            ...makeMetadata(4),
            chunkInfo: undefined,
            telegramMessages: [
              { chatId: -100123, messageId: 1 },
              { chatId: -100123, messageId: 1 },
              { chatId: -100123, messageId: 2 },
            ],
          },
        });
        const adapter = new api.TGAdapter(env, "oh_file_url");
        await assert.rejects(adapter.delete(key), /Too Many Requests/);
        assert.ok((await env.oh_file_url.getWithMetadata(key)).metadata);
        assert.deepEqual(await adapter.delete(key), { isDeleted: true });
        assert.deepEqual((await stats()).deleted, ["-100123:1", "-100123:2"]);
        assert.equal(
          (await stats()).calls.filter((call) =>
            call.path.endsWith("/deleteMessage")
          ).length,
          4
        );
      });

      it("does not claim old files were deleted from chat when message IDs are unavailable", async () => {
        const env = makeEnv();
        const key = "doc:legacy.txt";
        await env.oh_file_url.put(key, "", {
          metadata: { ...makeMetadata(4), chunkInfo: undefined },
        });
        const adapter = new api.TGAdapter(env, "oh_file_url");
        await assert.rejects(
          adapter.delete(key),
          /message reference is missing/
        );
        assert.ok((await env.oh_file_url.getWithMetadata(key)).metadata);
        assert.equal((await stats()).calls.length, 0);
      });

      it("tracks imported messages and notices, including repeats while the file is in trash", async () => {
        const env = { ...makeEnv(), TG_WEBHOOK_SECRET: "webhook-secret" };
        const imported = async (messageId) => {
          const response = await send(env, "/telegram/webhook", {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              "X-Telegram-Bot-Api-Secret-Token": "webhook-secret",
            },
            body: JSON.stringify({
              channel_post: {
                message_id: messageId,
                chat: { id: -100123 },
                document: {
                  file_id: "imported",
                  file_name: "imported.txt",
                  file_size: 4,
                },
              },
            }),
          });
          assert.equal(response.status, 200);
          return (await response.json()).data.key;
        };
        const key = await imported(11);
        await imported(11);
        assert.equal(
          (await stats()).calls.filter((call) =>
            call.path.endsWith("/sendMessage")
          ).length,
          1
        );
        const adapter = new api.TGAdapter(env, "oh_file_url");
        await adapter.moveToTrash(key);
        await imported(12);
        assert.equal(
          (await env.oh_file_url.getWithMetadata(key)).metadata,
          null
        );
        assert.deepEqual(
          (await env.oh_file_url.getWithMetadata(`trash:${key}`)).metadata
            .telegramMessages,
          [
            { chatId: -100123, messageId: 11 },
            { chatId: -100123, messageId: 1001 },
            { chatId: -100123, messageId: 12 },
            { chatId: -100123, messageId: 1002 },
          ]
        );
        assert.deepEqual(await adapter.delete(`trash:${key}`), {
          isDeleted: true,
        });
        assert.deepEqual((await stats()).deleted, [
          "-100123:11",
          "-100123:1001",
          "-100123:12",
          "-100123:1002",
        ]);
      });
    }
  );
});
