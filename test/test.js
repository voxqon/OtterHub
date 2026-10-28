var assert = require("assert");
const fs = require("fs");
const path = require("path");
const FormData = require("form-data");

const API_URL = process.env.TEST_API_URL || "http://localhost:8788";
const PASSWORD = "123456";
const API_TOKEN = "123456";
const trashPrefix = "trash:";

describe("API Endpoints", function () {
  // Shared state across tests
  let uploadedFileKey;
  let authCookie;

  // 登录
  describe("POST /auth/login", function () {
    it("should login successfully and get auth cookie", async function () {
      const response = await fetch(`${API_URL}/auth/login`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ password: PASSWORD }),
      });

      assert.equal(response.status, 200);

      const result = await response.json();
      assert.ok(result.success);

      // Extract the auth cookie from the Set-Cookie header
      const setCookieHeader = response.headers.get("Set-Cookie");
      assert.ok(setCookieHeader, "No Set-Cookie header in response");

      // Parse the auth cookie value
      const authMatch = setCookieHeader.match(/auth=([^;]+)/);
      assert.ok(authMatch, "No auth cookie found");
      authCookie = `auth=${authMatch[1]}`;
    });
  });

  // API Token 鉴权测试
  describe("API Token Authentication", function () {
    it("should access protected route with valid API Token", async function () {
      const response = await fetch(`${API_URL}/file/list`, {
        headers: {
          Authorization: `Bearer ${API_TOKEN}`,
        },
      });

      assert.equal(response.status, 200);
      const result = await response.json();
      assert.ok(result.success);
    });

    it("should fail with invalid API Token", async function () {
      const response = await fetch(`${API_URL}/file/list`, {
        headers: {
          Authorization: "Bearer invalid_token",
        },
      });

      assert.equal(response.status, 401);
    });

    it("should work for file upload using API Token", async function () {
      const filePath = path.join(__dirname, "../public/otterhub-icon.svg");
      const fileBuffer = fs.readFileSync(filePath);

      const form = new FormData();
      form.append("file", fileBuffer, {
        filename: "token-test.svg",
        contentType: "image/svg+xml",
      });

      const response = await fetch(`${API_URL}/upload`, {
        method: "POST",
        body: form.getBuffer(),
        headers: {
          ...form.getHeaders(),
          Authorization: `Bearer ${API_TOKEN}`,
        },
      });

      assert.equal(response.status, 200);
      const result = await response.json();
      assert.ok(result.success);

      // 清理测试上传的文件
      const fileKey = result.data;
      await fetch(`${API_URL}/file/${fileKey}`, {
        method: "DELETE",
        headers: {
          Authorization: `Bearer ${API_TOKEN}`,
        },
      });
    });
  });

  // 上传
  describe("POST /upload", function () {
    it("should upload the file successfully", async function () {
      const filePath = path.join(__dirname, "../public/otterhub-icon.svg");
      const fileBuffer = fs.readFileSync(filePath);

      const form = new FormData();
      form.append("file", fileBuffer, {
        filename: "otterhub-icon.svg",
        contentType: "image/svg+xml",
      });

      // Get headers from form-data and add auth cookie
      const formHeaders = form.getHeaders();
      const headers = {
        ...formHeaders,
        Cookie: authCookie,
      };

      const response = await fetch(`${API_URL}/upload`, {
        method: "POST",
        body: form.getBuffer(),
        headers,
      });

      assert.equal(response.status, 200);

      const result = await response.json();
      assert.ok(result.success);
      assert.ok(result.data);

      // Store the uploaded file key for the next test
      uploadedFileKey = result.data;
    });
  });

  // 获取
  describe("GET /file/:key", function () {
    it("should return the uploaded file without error", async function () {
      // Skip if the upload test didn't store a URL
      if (!uploadedFileKey) {
        this.skip();
      }

      const response = await fetch(`${API_URL}/file/${uploadedFileKey}`, {
        headers: {
          Cookie: authCookie,
        },
      });
      assert.equal(response.status, 200);

      // Check that the response is the SVG we uploaded
      const responseText = await response.text();
      assert.ok(
        responseText.includes("otterhub-icon.svg") ||
          responseText.includes("svg")
      );
    });

    it("should return suffix ranges and reject unsatisfiable or malformed ranges", async function () {
      assert.ok(uploadedFileKey);
      const original = fs.readFileSync(
        path.join(__dirname, "../public/otterhub-icon.svg")
      );
      const response = await fetch(`${API_URL}/file/${uploadedFileKey}`, {
        headers: { Cookie: authCookie, Range: "bytes=-3" },
      });
      assert.equal(response.status, 206);
      assert.equal(
        Buffer.from(await response.arrayBuffer()).toString("hex"),
        original.subarray(-3).toString("hex")
      );
      for (const range of [
        `bytes=${original.length}-`,
        "bytes=abc",
        "bytes=0-1,3-4",
      ]) {
        const invalid = await fetch(`${API_URL}/file/${uploadedFileKey}`, {
          headers: { Cookie: authCookie, Range: range },
        });
        assert.equal(invalid.status, 416, range);
        assert.equal(
          invalid.headers.get("Content-Range"),
          `bytes */${original.length}`
        );
        await invalid.arrayBuffer();
      }
    });
  });

  // 回收站测试
  describe("Trash API Endpoints", function () {
    it("should move the file to trash successfully", async function () {
      if (!uploadedFileKey) {
        this.skip();
      }

      const response = await fetch(`${API_URL}/trash/${uploadedFileKey}/move`, {
        method: "POST",
        headers: {
          Cookie: authCookie,
        },
      });
      assert.equal(response.status, 200);

      const result = await response.json();
      assert.ok(result.success);
    });

    it("should fetch the file from trash", async function () {
      if (!uploadedFileKey) {
        this.skip();
      }

      // 移入回收站后，原始路径应该返回 404 (或失败)
      const originalResponse = await fetch(
        `${API_URL}/file/${uploadedFileKey}`,
        {
          headers: {
            Cookie: authCookie,
          },
        }
      );
      assert.notEqual(originalResponse.status, 200);

      // 从回收站路径应该可以访问到文件内容
      const trashResponse = await fetch(
        `${API_URL}/trash/${trashPrefix}${uploadedFileKey}`,
        {
          headers: {
            Cookie: authCookie,
          },
        }
      );
      assert.equal(trashResponse.status, 200);
      const text = await trashResponse.text();
      assert.ok(text.includes("svg"));
    });

    it("should restore the file from trash successfully", async function () {
      if (!uploadedFileKey) {
        this.skip();
      }

      const trashKey = `${trashPrefix}${uploadedFileKey}`;
      const response = await fetch(`${API_URL}/trash/${trashKey}/restore`, {
        method: "POST",
        headers: {
          Cookie: authCookie,
        },
      });
      assert.equal(response.status, 200);

      const result = await response.json();
      assert.ok(result.success);

      // 还原后，原始路径应该恢复访问
      const restoredResponse = await fetch(
        `${API_URL}/file/${uploadedFileKey}`,
        {
          headers: {
            Cookie: authCookie,
          },
        }
      );
      assert.equal(restoredResponse.status, 200);
    });
  });

  // 删除
  describe("DELETE /file/:key", function () {
    it("should delete the uploaded file successfully", async function () {
      // Skip if the upload test didn't store a URL
      if (!uploadedFileKey) {
        this.skip();
      }

      const response = await fetch(`${API_URL}/file/${uploadedFileKey}`, {
        method: "DELETE",
        headers: {
          Cookie: authCookie,
        },
      });
      assert.equal(response.status, 200);

      const result = await response.json();
      assert.ok(result.success);
    });
  });

  describe("Confirmed chunk uploads", function () {
    this.timeout(30000);
    const chunkSize = 20 * 1024 * 1024;
    let chunkKey;
    const headers = { Authorization: `Bearer ${API_TOKEN}` };

    after(async function () {
      if (chunkKey)
        await fetch(`${API_URL}/file/${chunkKey}`, {
          method: "DELETE",
          headers,
        });
    });

    it("should upload parallel chunks and finalize without progress polling", async function () {
      const initialized = await fetch(`${API_URL}/upload/chunk/init`, {
        method: "POST",
        headers: { ...headers, "Content-Type": "application/json" },
        body: JSON.stringify({
          fileType: "doc",
          fileName: "parallel.bin",
          fileSize: chunkSize + 7,
          totalChunks: 2,
          tags: ["private"],
        }),
      });
      assert.equal(initialized.status, 200);
      chunkKey = (await initialized.json()).data;
      const chunks = [
        new Blob([Buffer.alloc(chunkSize, 97)]),
        new Blob(["THE-END"]),
      ];
      const receipts = await Promise.all(
        chunks.map(async (chunk, index) => {
          const form = new globalThis.FormData();
          form.append("key", chunkKey);
          form.append("chunkIndex", String(index));
          form.append("chunkFile", chunk);
          form.append("returnReceipt", "true");
          const response = await fetch(`${API_URL}/upload/chunk`, {
            method: "POST",
            headers,
            body: form,
          });
          const body = await response.json();
          assert.equal(response.status, 200, JSON.stringify(body));
          assert.ok(body.data.receipt);
          return body.data.receipt;
        })
      );
      const response = await fetch(`${API_URL}/upload/chunk/complete`, {
        method: "POST",
        headers: { ...headers, "Content-Type": "application/json" },
        body: JSON.stringify({ key: chunkKey, receipts }),
      });
      const completed = await response.json();
      assert.equal(response.status, 200, JSON.stringify(completed));
      assert.deepEqual(completed.data.chunkInfo.uploadedIndices, [0, 1]);
      assert.deepEqual(completed.data.tags, ["private"]);
    });

    it("should immediately read an exact range spanning the completed chunks", async function () {
      assert.ok(chunkKey);
      const response = await fetch(`${API_URL}/file/${chunkKey}`, {
        headers: {
          ...headers,
          Range: `bytes=${chunkSize - 3}-${chunkSize + 3}`,
        },
      });
      assert.equal(response.status, 206);
      assert.equal(response.headers.get("Content-Length"), "7");
      assert.equal(await response.text(), "aaaTHE-");
      assert.equal((await fetch(`${API_URL}/file/${chunkKey}`)).status, 401);
    });
  });
});
