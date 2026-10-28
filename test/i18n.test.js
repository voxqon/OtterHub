const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const Module = require("node:module");
const ts = require("typescript");
const { buildSync } = require("esbuild");

describe("Browser language preferences", () => {
  let api;
  let values;
  const globals = ["navigator", "localStorage", "document"];
  let descriptors;
  beforeEach(() => {
    descriptors = globals.map((name) =>
      Object.getOwnPropertyDescriptor(globalThis, name)
    );
    values = new Map();
    const fixtures = {
      navigator: { languages: ["zh-TW", "en-US"], language: "zh-TW" },
      localStorage: {
        getItem: (key) => values.get(key) ?? null,
        setItem: (key, value) => values.set(key, value),
        removeItem: (key) => values.delete(key),
      },
      document: { documentElement: { lang: "en" } },
    };
    for (const name of globals)
      Object.defineProperty(globalThis, name, {
        configurable: true,
        writable: true,
        value: fixtures[name],
      });
    const bundled = buildSync({
      entryPoints: [path.join(__dirname, "../frontend/lib/i18n/core.ts")],
      bundle: true,
      write: false,
      platform: "node",
      format: "cjs",
      logLevel: "silent",
    });
    const compiled = new Module(path.join(__dirname, "i18n-entry.cjs"), module);
    compiled.filename = path.join(__dirname, "i18n-entry.cjs");
    compiled.paths = module.paths;
    compiled._compile(bundled.outputFiles[0].text, compiled.filename);
    api = compiled.exports;
  });
  afterEach(() => {
    globals.forEach((name, index) => {
      if (descriptors[index])
        Object.defineProperty(globalThis, name, descriptors[index]);
      else delete globalThis[name];
    });
  });

  it("starts with a stable SSR snapshot, then follows browser language priority", () => {
    assert.equal(api.getLocale(), "en");
    assert.equal(api.t("取消"), "Cancel");
    api.initializeLocale();
    assert.equal(api.getLocale(), "zh-CN");
    assert.equal(document.documentElement.lang, "zh-CN");
    assert.equal(api.getLanguagePreference(), "auto");
    assert.equal(api.resolveLocale("auto", ["fr-FR", "en-GB", "zh-CN"]), "en");
    assert.equal(api.resolveLocale("auto", ["zh-Hans", "en"]), "zh-CN");
    assert.equal(api.resolveLocale("auto", ["ja-JP"]), "en");
  });

  it("persists an explicit choice and restores automatic detection without changing other storage", () => {
    values.set("unrelated-setting", "keep");
    api.initializeLocale();
    let changes = 0;
    const unsubscribe = api.subscribeLocale(() => changes++);
    api.setLanguagePreference("en");
    assert.equal(api.t("取消"), "Cancel");
    assert.equal(values.get(api.LANGUAGE_STORAGE_KEY), "en");
    navigator.languages = ["zh-CN"];
    api.refreshBrowserLocale();
    assert.equal(api.getLocale(), "en");
    assert.equal(changes, 1);
    api.setLanguagePreference("auto");
    assert.equal(api.getLocale(), "zh-CN");
    assert.equal(values.has(api.LANGUAGE_STORAGE_KEY), false);
    assert.equal(values.get("unrelated-setting"), "keep");
    unsubscribe();
    api.setLanguagePreference("en");
    assert.equal(changes, 2);
  });

  it("loads saved choices, synchronizes other tabs and responds to browser language changes", () => {
    values.set(api.LANGUAGE_STORAGE_KEY, "en");
    api.initializeLocale();
    assert.equal(api.getLocale(), "en");
    values.set(api.LANGUAGE_STORAGE_KEY, "zh-CN");
    api.syncLanguagePreference();
    assert.equal(api.getLocale(), "zh-CN");
    values.delete(api.LANGUAGE_STORAGE_KEY);
    navigator.languages = ["en-US"];
    api.syncLanguagePreference();
    assert.equal(api.getLanguagePreference(), "auto");
    assert.equal(api.getLocale(), "en");
    navigator.languages = ["zh-CN"];
    api.refreshBrowserLocale();
    assert.equal(api.getLocale(), "zh-CN");
  });

  it("keeps working when storage is blocked or contains an unsupported preference", () => {
    assert.equal(api.parseLanguagePreference("invalid"), "auto");
    localStorage.getItem = () => {
      throw new Error("blocked");
    };
    localStorage.setItem = () => {
      throw new Error("blocked");
    };
    localStorage.removeItem = () => {
      throw new Error("blocked");
    };
    api.initializeLocale();
    api.setLanguagePreference("en");
    assert.equal(api.t("取消"), "Cancel");
    api.setLanguagePreference("auto");
    assert.equal(api.getLocale(), "zh-CN");
  });

  it("interpolates whole sentences without changing filenames or protocol placeholders", () => {
    assert.equal(
      api.translate("en", "成功上传 {0} 个文件", 3),
      "Uploaded 3 files"
    );
    assert.equal(
      api.translate("zh-CN", "成功上传 {0} 个文件", 3),
      "成功上传 3 个文件"
    );
    assert.equal(
      api.translate("en", "为 {0} 创建临时分享链接", "私人$文件.txt"),
      "Create a temporary share link for 私人$文件.txt"
    );
    assert.equal(api.translate("en", "/file/{key}"), "/file/{key}");
  });
});

describe("Translation catalog coverage", () => {
  it("covers literal translation calls and preserves interpolation parameters", () => {
    const catalogFile = path.join(
      __dirname,
      "../frontend/lib/i18n/messages.ts"
    );
    const catalog = ts.createSourceFile(
      catalogFile,
      fs.readFileSync(catalogFile, "utf8"),
      ts.ScriptTarget.Latest,
      true
    );
    const translations = new Map();
    function collect(node) {
      if (
        ts.isPropertyAssignment(node) &&
        (ts.isStringLiteralLike(node.name) || ts.isIdentifier(node.name))
      )
        translations.set(node.name.text, node.initializer.text);
      ts.forEachChild(node, collect);
    }
    collect(catalog);
    const placeholders = (text) =>
      [...text.matchAll(/\{\d+\}/g)].map((match) => match[0]).sort();
    for (const [key, value] of translations)
      assert.deepEqual(placeholders(value), placeholders(key), key);
    function scan(dir) {
      for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        const file = path.join(dir, entry.name);
        if (entry.isDirectory()) {
          scan(file);
          continue;
        }
        if (!/\.tsx?$/.test(file)) continue;
        const source = ts.createSourceFile(
          file,
          fs.readFileSync(file, "utf8"),
          ts.ScriptTarget.Latest,
          true
        );
        function visit(node) {
          if (
            ts.isCallExpression(node) &&
            node.expression.getText(source) === "t" &&
            ts.isStringLiteralLike(node.arguments[0])
          )
            assert.ok(
              translations.has(node.arguments[0].text),
              `${file}: ${node.arguments[0].text}`
            );
          ts.forEachChild(node, visit);
        }
        visit(source);
      }
    }
    for (const dir of ["app", "components", "lib", "stores"])
      scan(path.join(__dirname, "../frontend", dir));
  });
});
