const http = require("http");

// Test controls and seeded bytes are local fixtures, not Telegram API endpoints.
http
  .createServer(async (req, res) => {
    const url = new URL(req.url, "http://localhost");
    const state = (await pm.state.get("telegram:state")) || {
      calls: [],
      uploads: 0,
      deleted: [],
    };
    const json = (status, body) => {
      res.writeHead(status, { "Content-Type": "application/json" });
      res.end(JSON.stringify(body));
    };
    if (url.pathname === "/__reset") {
      await pm.state.set("telegram:state", {
        calls: [],
        uploads: 0,
        deleted: [],
      });
      return json(200, { ok: true });
    }
    if (url.pathname === "/__stats") return json(200, state);
    state.calls.push({
      method: req.method,
      path: url.pathname,
      range: req.headers.range,
    });
    const attempt = state.calls.filter(
      (call) => call.path === url.pathname
    ).length;
    await pm.state.set("telegram:state", state);

    const deletion = /^\/bot([^/]+)\/deleteMessage$/.exec(url.pathname);
    const notice = /^\/bot([^/]+)\/sendMessage$/.exec(url.pathname);
    if ((deletion || notice) && req.method === "POST") {
      let payload;
      try {
        payload =
          typeof req.body === "string" ? JSON.parse(req.body) : req.body;
        if (!payload) throw new Error("Missing JSON body");
      } catch {
        return json(400, {
          ok: false,
          description: "Bad Request: invalid JSON",
        });
      }
      state.calls[state.calls.length - 1].body = payload;
      await pm.state.set("telegram:state", state);
      if (notice) {
        state.uploads++;
        await pm.state.set("telegram:state", state);
        return json(200, {
          ok: true,
          result: {
            message_id: 1000 + state.uploads,
            chat: { id: payload.chat_id },
          },
        });
      }
      if (
        !payload.chat_id ||
        !Number.isInteger(payload.message_id) ||
        payload.message_id < 1
      ) {
        return json(400, {
          ok: false,
          description: "Bad Request: invalid message reference",
        });
      }
      const token = deletion[1];
      if (token === "nodelete")
        return json(403, {
          ok: false,
          description: "Forbidden: not enough rights",
        });
      if (token === "expired")
        return json(400, {
          ok: false,
          description: "Bad Request: message can't be deleted",
        });
      if (
        token === "partial" &&
        payload.message_id === 2 &&
        state.calls.filter(
          (call) => call.path === url.pathname && call.body?.message_id === 2
        ).length === 1
      ) {
        return json(429, {
          ok: false,
          description: "Too Many Requests",
          parameters: { retry_after: 1 },
        });
      }
      const id = `${payload.chat_id}:${payload.message_id}`;
      if (token === "missing" || state.deleted.includes(id))
        return json(400, {
          ok: false,
          description: "Bad Request: message to delete not found",
        });
      state.deleted.push(id);
      await pm.state.set("telegram:state", state);
      return json(200, { ok: true, result: true });
    }

    const upload = /^\/bot([^/]+)\/sendDocument$/.exec(url.pathname);
    if (upload && req.method === "POST") {
      const token = upload[1];
      if (!req.headers["content-type"]?.includes("multipart/form-data")) {
        return json(400, {
          ok: false,
          description: "Bad Request: expected multipart upload",
        });
      }
      if (token === "denied")
        return json(401, { ok: false, description: "Unauthorized" });
      if (token === "badrequest")
        return json(400, { ok: false, description: "Bad Request" });
      if (token === "rate" && attempt === 1) {
        return json(429, {
          ok: false,
          description: "Too Many Requests",
          parameters: { retry_after: 1 },
        });
      }
      if (token === "html" && attempt === 1) {
        res.writeHead(502, { "Content-Type": "text/html" });
        return res.end("<html>Bad Gateway</html>");
      }
      state.uploads++;
      await pm.state.set("telegram:state", state);
      return json(200, {
        ok: true,
        result: {
          message_id: state.uploads,
          chat: { id: "test-chat" },
          document: {
            file_id:
              token === "duplicate"
                ? "uploaded-shared"
                : `uploaded-${state.uploads}`,
            file_size: 4,
          },
        },
      });
    }

    if (/^\/bot[^/]+\/getFile$/.test(url.pathname)) {
      const fileId = url.searchParams.get("file_id");
      return json(200, {
        ok: true,
        result: { file_id: fileId, file_path: `files/${fileId}` },
      });
    }
    const download = /^\/file\/bot[^/]+\/files\/([^/]+)$/.exec(url.pathname);
    if (download) {
      const files = {
        "part-0": "ABCDEF",
        "part-1": "123456789",
        thumb: "jpeg",
      };
      const bytes = Buffer.from(files[download[1]] || "test");
      const match = /^bytes=(\d+)-(\d+)$/.exec(req.headers.range || "");
      if (!match) {
        res.writeHead(200, {
          "Content-Type": "application/octet-stream",
          "Content-Length": bytes.length,
        });
        return res.end(bytes);
      }
      const start = Number(match[1]);
      const end = Math.min(Number(match[2]), bytes.length - 1);
      if (start > end) return json(416, { ok: false });
      res.writeHead(206, {
        "Content-Type": "application/octet-stream",
        "Content-Range": `bytes ${start}-${end}/${bytes.length}`,
        "Content-Length": end - start + 1,
      });
      return res.end(bytes.subarray(start, end + 1));
    }
    return json(501, {
      error: "Endpoint not modeled by the Telegram test contract",
    });
  })
  .listen(process.env.PORT || 4500);
