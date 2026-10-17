import { chromium, request } from "playwright";
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { resolve } from "node:path";
import { hash } from "../storage/journal.mjs";
import { classifyResponse } from "../../examples/runtime.mjs";

export const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
export function redactUrl(value) {
  const u = new URL(value);
  for (const key of [...u.searchParams.keys()])
    if (/token|secret|apikey|api_key|authorization|signature/i.test(key))
      u.searchParams.set(key, "REDACTED");
  return u.href;
}
export async function saveCapture(root, run, task, body, url, kind) {
  const dir = resolve(root, "runs", run.id, run.attemptId);
  await mkdir(dir, { recursive: true });
  const path = `${dir}/page-${task.id}.${kind === "json" ? "json" : "html"}`;
  await writeFile(path, body, { flag: "wx" });
  return { path, hash: hash(body), url: redactUrl(url), kind };
}
export function robotsAllowed(
  content,
  path,
  userAgent = "EventsMiningFramework",
) {
  const groups = [];
  let group = null;
  for (const line of content.split(/\r?\n/)) {
    const clean = line.replace(/#.*$/, "").trim(),
      m = clean.match(/^([^:]+):\s*(.*)$/);
    if (!m) continue;
    const key = m[1].toLowerCase(),
      value = m[2].trim();
    if (key === "user-agent") {
      if (!group || group.rules.length) {
        group = { agents: [], rules: [] };
        groups.push(group);
      }
      group.agents.push(value.toLowerCase());
    } else if (group && ["allow", "disallow"].includes(key) && value)
      group.rules.push({ allow: key === "allow", pattern: value });
  }
  const exact = groups.filter((g) =>
    g.agents.some((a) => a !== "*" && userAgent.toLowerCase().includes(a)),
  );
  const candidates = exact.length
    ? exact
    : groups.filter((g) => g.agents.includes("*"));
  let best = null;
  for (const rule of candidates.flatMap((g) => g.rules)) {
    const ending = rule.pattern.endsWith("$"),
      escaped = (ending ? rule.pattern.slice(0, -1) : rule.pattern)
        .split("*")
        .map((x) => x.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"))
        .join(".*");
    if (new RegExp(`^${escaped}${ending ? "$" : ""}`).test(path)) {
      const length = rule.pattern.replace(/\*/g, "").length;
      if (
        !best ||
        length > best.length ||
        (length === best.length && rule.allow)
      )
        best = { ...rule, length };
    }
  }
  return best?.allow ?? true;
}
export class Transport {
  constructor({
    root,
    run,
    journal,
    timeoutMs = 25000,
    leaseCheck = () => {},
  }) {
    Object.assign(this, { root, run, journal, timeoutMs, leaseCheck });
    this.robots = new Map();
    this.browser = null;
    this.context = null;
    this.api = null;
  }
  async initApi() {
    return (this.api ??= await request.newContext({
      timeout: this.timeoutMs,
      userAgent: "EventsMiningFramework/0.2 (public event research)",
    }));
  }
  async initBrowser() {
    if (!this.browser) {
      this.browser = await chromium.launch({ headless: true });
      this.context = await this.browser.newContext({
        timezoneId: this.run.config.timeZone,
        serviceWorkers: "block",
      });
      await this.context.route("**/*", (route) =>
        ["font", "image", "media"].includes(route.request().resourceType())
          ? route.abort()
          : route.continue(),
      );
    }
    return this.context;
  }
  async permit(url) {
    const u = new URL(url);
    if (!["http:", "https:"].includes(u.protocol))
      throw Object.assign(new Error("Non-HTTP task"), {
        code: "contract_changed",
      });
    const allowed = [
      new URL(this.run.config.url).hostname,
      ...(this.run.config.allowedHosts ?? []),
    ].map((h) => h.replace(/^www\./, ""));
    if (!allowed.includes(u.hostname.replace(/^www\./, "")))
      throw Object.assign(new Error("Out-of-scope navigation host"), {
        code: "scope_violation",
      });
    if (!this.robots.has(u.origin)) {
      let entry = { body: "", state: "unavailable" };
      try {
        const api = await this.initApi();
        const r = await api.get(`${u.origin}/robots.txt`, { timeout: 12000 });
        if (r.status() === 429)
          throw Object.assign(new Error("Robots request throttled"), {
            code: "rate_limited",
          });
        if (r.ok()) entry = { body: await r.text(), state: "loaded" };
        else if (r.status() >= 500)
          throw Object.assign(
            new Error("Robots request temporarily unavailable"),
            { code: "transport_error" },
          );
      } catch (error) {
        if (error.code) throw error;
        throw Object.assign(
          new Error(
            `Cannot verify robots policy: ${error.message.slice(0, 180)}`,
          ),
          { code: "transport_error" },
        );
      }
      this.robots.set(u.origin, entry);
    }
    if (!robotsAllowed(this.robots.get(u.origin).body, u.pathname + u.search))
      throw Object.assign(
        new Error("robots.txt disallows this collection path"),
        { code: "robots_disallowed" },
      );
  }
  async fetch(task) {
    this.leaseCheck();
    await this.permit(task.url);
    await sleep(this.journal.reserveRate(this.run.source_key, 1000));
    this.leaseCheck();
    if (task.kind === "api") {
      const api = await this.initApi(),
        response = await api.get(task.url),
        body = await response.text();
      const capture = await saveCapture(
        this.root,
        this.run,
        task,
        body,
        response.url(),
        "json",
      );
      try {
        classifyResponse(response.status(), body);
      } catch (error) {
        error.capture = capture;
        const retry = response.headers()["retry-after"];
        if (retry) error.retryAfterMs = retryDelay(retry);
        throw error;
      }
      return { body, url: response.url(), capture, status: response.status() };
    }
    const context = await this.initBrowser(),
      page = await context.newPage();
    let capture;
    try {
      const response = await page.goto(task.url, {
        waitUntil: "domcontentloaded",
        timeout: this.timeoutMs,
      });
      let body = await page.content();
      // Capture denials before attempting a selector wait.
      try {
        classifyResponse(response?.status() ?? 0, body);
      } catch (error) {
        capture = await saveCapture(
          this.root,
          this.run,
          task,
          body,
          page.url(),
          "html",
        );
        error.capture = capture;
        throw error;
      }
      const selector = this.run.config.readySelector;
      if (selector && task.kind === "listing") {
        try {
          await page
            .locator(selector)
            .first()
            .waitFor({ state: "attached", timeout: 7000 });
        } catch {
          throw Object.assign(
            new Error(`Expected selector missing: ${selector}`),
            { code: "contract_changed" },
          );
        }
      } else {
        // A bounded opportunity for client-rendered content; never evidence of completeness.
        await page
          .waitForLoadState("networkidle", { timeout: 2500 })
          .catch(() => {});
      }
      body = await page.content();
      capture = await saveCapture(
        this.root,
        this.run,
        task,
        body,
        page.url(),
        "html",
      );
      return {
        body,
        url: page.url(),
        capture,
        status: response?.status() ?? 0,
      };
    } catch (error) {
      if (!capture) {
        capture = await saveCapture(
          this.root,
          this.run,
          task,
          await page.content().catch(() => ""),
          page.url(),
          "html",
        ).catch(() => null);
        if (capture) error.capture = capture;
      }
      await page
        .screenshot({
          path: resolve(
            this.root,
            "runs",
            this.run.id,
            this.run.attemptId,
            `page-${task.id}-failure.png`,
          ),
        })
        .catch(() => {});
      throw error;
    } finally {
      await page.close().catch(() => {});
    }
  }
  async close() {
    await this.context?.close().catch(() => {});
    await this.browser?.close().catch(() => {});
    await this.api?.dispose().catch(() => {});
  }
}
export function retryDelay(raw, now = Date.now()) {
  const seconds = Number(raw);
  if (Number.isFinite(seconds)) return Math.max(1000, seconds * 1000);
  const date = Date.parse(raw);
  return Number.isFinite(date) ? Math.max(1000, date - now) : 60000;
}
