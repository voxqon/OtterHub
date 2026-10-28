const assert = require("node:assert/strict");
const { createHash, createHmac } = require("node:crypto");
const Module = require("node:module");
const path = require("node:path");
const { buildSync } = require("esbuild");

describe("Public signed upload API", function () {
  let app;
  let env;
  let stored;
  const context = { waitUntil() {}, passThroughOnException() {} };

  before(() => {
    const bundled = buildSync({
      entryPoints: [path.join(__dirname, "../functions/app.ts")],
      bundle: true,
      write: false,
      platform: "node",
      format: "cjs",
      tsconfig: path.join(__dirname, "../frontend/tsconfig.json"),
      logLevel: "silent",
    });
    const compiled = new Module(path.join(__dirname, "public-api-entry.cjs"), module);
    compiled.filename = path.join(__dirname, "public-api-entry.cjs");
    compiled.paths = module.paths;
    compiled._compile(bundled.outputFiles[0].text, compiled.filename);
    app = compiled.exports.app;
  });

  beforeEach(() => {
    const records = new Map();
    stored = [];
    env = {
      API_TOKEN: "admin-token",
      JWT_SECRET: "test-secret",
      oh_file_url: {
        async get(key) { return records.get(key) ?? null; },
        async put(key, value, options) { records.set(key, value); if (options?.metadata) stored.push(options.metadata); },
        async delete(key) { records.delete(key); },
      },
      oh_file_r2: {
        async put(key, value) { stored.push({ key, value }); },
      },
    };
  });

  const request = (url, options = {}) => app.request(url, options, env, context);
  const admin = { Authorization: "Bearer admin-token" };
  const rotate = async () => {
    const response = await request("/settings/public-api/rotate", { method: "POST", headers: admin });
    assert.equal(response.status, 200);
    return (await response.json()).data.secret;
  };
  const signed = (secret, body, options = {}) => {
    const timestamp = options.timestamp ?? String(Math.floor(Date.now() / 1000));
    const filename = options.filename ?? encodeURIComponent("测试.txt");
    const digest = createHash("sha256").update(body).digest("hex");
    const message = ["POST", "/public/upload", timestamp, filename, digest].join("\n");
    const signature = createHmac("sha256", secret).update(message).digest("hex");
    return {
      method: "POST",
      headers: {
        "X-Otter-Timestamp": timestamp,
        "X-Otter-Filename": filename,
        "X-Otter-Content-SHA256": digest,
        "X-Otter-Signature": signature,
      },
      body,
    };
  };

  it("protects key management and reveals a generated key only once", async () => {
    assert.equal((await request("/settings/public-api/rotate", { method: "POST" })).status, 401);
    assert.equal((await request("/settings/public-api/rotate", {
      method: "POST", headers: { ...admin, Origin: "https://attacker.example" },
    })).status, 403);
    assert.equal((await request("/settings/public-api", {
      headers: { ...admin, Origin: "https://attacker.example" },
    })).status, 403);
    const secret = await rotate();
    assert.match(secret, /^[a-f0-9]{64}$/);
    const status = await request("/settings/public-api", { headers: admin });
    assert.equal(status.headers.get("Cache-Control"), "no-store");
    assert.deepEqual((await status.json()).data, { configured: true });
  });

  it("uploads signed bytes without admin credentials and records metadata", async () => {
    const secret = await rotate();
    const response = await request("/public/upload", signed(secret, Buffer.from("hello")));
    assert.equal(response.status, 200);
    assert.match((await response.json()).data.key, /^doc:/);
    assert.equal(await stored[0].value.text(), "hello");
    assert.equal(stored[1].fileName, "测试.txt");
    assert.equal(stored[1].fileSize, 5);
    assert.deepEqual(stored[1].tags, []);
  });

  it("rejects missing, forged, expired and tampered signatures and file bodies", async () => {
    const secret = await rotate();
    const body = Buffer.from("hello");
    assert.equal((await request("/public/upload", { method: "POST", body })).status, 401);
    assert.equal((await request("/public/upload", signed("wrong", body))).status, 401);
    assert.equal((await request("/public/upload", signed(secret, body, { timestamp: "1000000000" }))).status, 401);
    const alteredName = signed(secret, body);
    alteredName.headers["X-Otter-Filename"] = "other.txt";
    assert.equal((await request("/public/upload", alteredName)).status, 401);
    const alteredBody = signed(secret, body);
    alteredBody.body = Buffer.from("other");
    assert.equal((await request("/public/upload", alteredBody)).status, 400);
    assert.equal(stored.length, 0);
  });

  it("rejects oversized input and invalid filenames before storing", async () => {
    const secret = await rotate();
    const oversized = signed(secret, Buffer.from("x"));
    oversized.headers["Content-Length"] = String(20 * 1024 * 1024 + 1);
    assert.equal((await request("/public/upload", oversized)).status, 413);
    assert.equal((await request("/public/upload", signed(secret, Buffer.from("x"), { filename: "..%2Ftest.txt" }))).status, 400);
    assert.equal(stored.length, 0);
  });

  it("invalidates old keys after rotation and disables uploads after revocation", async () => {
    const oldSecret = await rotate();
    const newSecret = await rotate();
    assert.notEqual(oldSecret, newSecret);
    assert.equal((await request("/public/upload", signed(oldSecret, Buffer.from("x")))).status, 401);
    assert.equal((await request("/public/upload", signed(newSecret, Buffer.from("x")))).status, 200);
    assert.equal((await request("/settings/public-api", { method: "DELETE", headers: admin })).status, 200);
    assert.equal((await request("/public/upload", signed(newSecret, Buffer.from("x")))).status, 401);
  });
});
