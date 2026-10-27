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
async function snapshotPage(page) {
  // Read the document and its URL in one browser task. Separate awaits of
  // page.content() and page.url() can associate two different navigations.
  return page.evaluate(() => ({
    url: window.location.href,
    body:
      (document.doctype
        ? new XMLSerializer().serializeToString(document.doctype) + "\n"
        : "") + (document.documentElement?.outerHTML ?? ""),
  }));
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
    runtimeCheck = () => {},
  }) {
    Object.assign(this, {
      root,
      run,
      journal,
      timeoutMs,
      leaseCheck,
      runtimeCheck,
    });
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
        if (r.status() === 429) {
          const retryAfterMs = retryDelay(r.headers()["retry-after"]);
          this.journal.deferRate(this.run.source_key, retryAfterMs);
          throw Object.assign(new Error("Robots request throttled"), {
            code: "rate_limited",
            retryAfterMs,
          });
        }
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
  async pace(recovery = false) {
    this.leaseCheck();
    if (recovery) this.runtimeCheck();
    const delay = this.journal.reserveRate(
      this.run.source_key,
      this.run.config.minIntervalMs ?? 1000,
    );
    if (delay > 5000)
      throw Object.assign(new Error("Publisher cooldown is still active"), {
        code: "rate_limited",
        retryAfterMs: delay,
      });
    // Stop before a pacing wait that would consume the remaining active budget.
    if (recovery) this.runtimeCheck(delay);
    await sleep(delay);
    this.leaseCheck();
    if (recovery) this.runtimeCheck();
  }
  async checkBrowserResponse(response) {
    if (!response) return;
    // Redirects must pass collection policy before HTTP errors can affect
    // the publisher's retry state. The failure path still retains evidence.
    await this.permit(response.url());
    try {
      classifyResponse(response.status());
    } catch (error) {
      const retry = response.headers()["retry-after"];
      if (retry) error.retryAfterMs = retryDelay(retry);
      if (error.code === "rate_limited")
        this.journal.deferRate(
          this.run.source_key,
          error.retryAfterMs ?? 60000,
        );
      error.httpResponse = response;
      throw error;
    }
  }
  async clickListingPage(page, current, before) {
    const requests = new Set();
    const hosts = [
      new URL(this.run.config.url).hostname,
      ...(this.run.config.allowedHosts ?? []),
    ].map((host) => host.replace(/^www\./, ""));
    const publisherRequest = (request) =>
      ["document", "xhr", "fetch"].includes(request.resourceType()) &&
      request.frame() === page.mainFrame() &&
      hosts.includes(new URL(request.url()).hostname.replace(/^www\./, ""));
    const onRequest = (request) => {
      if (publisherRequest(request)) requests.add(request);
    };
    let lastResponse, fail, block;
    const failed = new Promise((resolve) => {
      fail = resolve;
    });
    const blocked = new Promise((_, reject) => {
      block = reject;
    });
    const guardRequest = async (route, request) => {
      if (publisherRequest(request)) {
        try {
          this.leaseCheck();
          await this.permit(request.url());
          this.leaseCheck();
        } catch (error) {
          // Surface the policy failure before aborting can become a generic
          // navigation error. The publisher must never receive this request.
          block(error);
          await route.abort("blockedbyclient").catch(() => {});
          return;
        }
      }
      // Preserve the context's existing resource blocking and other routes.
      await route.fallback();
    };
    const onResponse = (response) => {
      if (!requests.has(response.request())) return;
      lastResponse = response;
      // HTTP errors are response events, not requestfailed events. Race them
      // against rendering so a denied click cannot become a generic timeout.
      if (response.status() >= 400) fail(response);
    };
    page.on("request", onRequest);
    page.on("response", onResponse);
    try {
      await page.route("**/*", guardRequest);
      const rendered = (async () => {
        await page
          .locator(
            'ul[class*="SearchPagination_pagination"] li.next:not(.disabled) a',
          )
          .click({ timeout: 7000 });
        await page.waitForFunction(
          ({ n, before }) =>
            Number(
              document
                .querySelector(
                  'ul[class*="SearchPagination_pagination"] li[class*="SearchPagination_active"]',
                )
                ?.textContent.trim(),
            ) === n &&
            [...document.querySelectorAll('a[class*="ContentCard_headerLink"]')]
              .map((a) => a.textContent.trim())
              .sort()
              .join("|") !== before,
          { n: current + 1, before },
          { timeout: 15000 },
        );
        return lastResponse;
      })();
      const response = await Promise.race([rendered, failed, blocked]);
      await this.checkBrowserResponse(response);
      return response;
    } finally {
      page.off("request", onRequest);
      page.off("response", onResponse);
      await page.unroute("**/*", guardRequest);
    }
  }
  async fetch(task) {
    await this.pace();
    await this.permit(task.url);
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
        // Playwright follows HTTP redirects. The effective page must still
        // belong to this collection before any observations can be parsed.
        await this.permit(response.url());
        classifyResponse(response.status(), body);
      } catch (error) {
        error.capture = capture;
        const retry = response.headers()["retry-after"];
        if (retry) error.retryAfterMs = retryDelay(retry);
        if (error.code === "rate_limited")
          this.journal.deferRate(
            this.run.source_key,
            error.retryAfterMs ?? 60000,
          );
        throw error;
      }
      return { body, url: response.url(), capture, status: response.status() };
    }
    const context = await this.initBrowser(),
      browserPaging =
        task.kind === "listing" &&
        this.run.config.pagination?.mode === "nyc-browser",
      page = browserPaging
        ? (this.listingPage ??= await context.newPage())
        : await context.newPage();
    const diagnostics = {
      requestedUrl: redactUrl(task.url),
      startedAt: new Date().toISOString(),
      errors: [],
      failedRequests: [],
      selectors: [],
    };
    const onPageError = (error) => {
      if (diagnostics.errors.length < 20)
        diagnostics.errors.push(error.message.slice(0, 400));
    };
    const onRequestFailed = (request) => {
      if (
        diagnostics.failedRequests.length < 30 &&
        ["document", "xhr", "fetch"].includes(request.resourceType())
      )
        diagnostics.failedRequests.push({
          url: redactUrl(request.url()),
          error: request.failure()?.errorText,
        });
    };
    if (this.run.options?.diagnostics) {
      page.on("pageerror", onPageError);
      page.on("requestfailed", onRequestFailed);
    }
    let capture, snapshot;
    try {
      let response,
        browserRequestUsed = false;
      const target = task.meta?.browserPage ?? 1;
      if (
        !browserPaging ||
        !this.listingPageNumber ||
        target <= this.listingPageNumber
      ) {
        const navigationUrl = new URL(task.url);
        if (browserPaging) navigationUrl.hash = "";
        response = await page.goto(navigationUrl.href, {
          waitUntil: "domcontentloaded",
          timeout: this.timeoutMs,
        });
        await this.checkBrowserResponse(response);
        browserRequestUsed = true;
        if (browserPaging) {
          this.listingPageNumber = 1;
          this.journal.deferRate(
            this.run.source_key,
            this.run.config.minIntervalMs ?? 1000,
          );
        }
      }
      if (browserPaging) {
        if (
          !Number.isSafeInteger(target) ||
          target < 1 ||
          target > this.run.config.pagination.maxPages
        )
          throw Object.assign(new Error("Invalid browser page target"), {
            code: "pagination_changed",
          });
        while (this.listingPageNumber < target) {
          const recovery = browserRequestUsed;
          // nextPage reserved the first action. Reconstructing the browser's
          // lost state consumes another paced, fenced request for each click.
          if (recovery) {
            this.runtimeCheck();
            this.journal.reserveAdditionalRequest(this.run.id, this.run.token);
            await this.pace(true);
          }
          this.leaseCheck();
          browserRequestUsed = true;
          const current = this.listingPageNumber;
          const before = await page
            .locator('a[class*="ContentCard_headerLink"]')
            .evaluateAll((links) =>
              links
                .map((a) => a.textContent.trim())
                .sort()
                .join("|"),
            );
          if (recovery) this.runtimeCheck();
          response = await this.clickListingPage(page, current, before);
          this.listingPageNumber++;
          this.journal.deferRate(
            this.run.source_key,
            this.run.config.minIntervalMs ?? 1000,
          );
        }
      }
      snapshot = await snapshotPage(page);
      await this.permit(snapshot.url);
      // Capture denials before attempting a selector wait.
      try {
        classifyResponse(
          response?.status() ?? (browserPaging ? 200 : 0),
          snapshot.body,
        );
      } catch (error) {
        capture = await saveCapture(
          this.root,
          this.run,
          task,
          snapshot.body,
          snapshot.url,
          "html",
        );
        error.capture = capture;
        const retry = await response?.headerValue("retry-after");
        if (retry) error.retryAfterMs = retryDelay(retry);
        if (error.code === "rate_limited")
          this.journal.deferRate(
            this.run.source_key,
            error.retryAfterMs ?? 60000,
          );
        throw error;
      }
      const selector =
        task.kind === "detail"
          ? this.run.config.detailReadySelector
          : this.run.config.readySelector;
      if (selector) {
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
      snapshot = await snapshotPage(page);
      if (this.run.options?.diagnostics) {
        diagnostics.url = redactUrl(snapshot.url);
        diagnostics.status = response?.status() ?? 0;
        for (const selector of [
          ...new Set(
            [
              this.run.config.readySelector,
              ...(this.run.config.cardSelectors ?? []),
            ].filter(Boolean),
          ),
        ])
          diagnostics.selectors.push({
            selector,
            count: await page.locator(selector).count(),
          });
      }
      capture = await saveCapture(
        this.root,
        this.run,
        task,
        snapshot.body,
        snapshot.url,
        "html",
      );
      // A later navigation cannot change the checked URL for this snapshot.
      await this.permit(snapshot.url);
      return {
        body: snapshot.body,
        url: snapshot.url,
        capture,
        status: response?.status() ?? (browserPaging ? 200 : 0),
      };
    } catch (error) {
      if (!capture && error.httpResponse) {
        const denied = error.httpResponse;
        capture = await saveCapture(
          this.root,
          this.run,
          task,
          await denied.text().catch(() => ""),
          denied.url(),
          /json/i.test(denied.headers()["content-type"] ?? "")
            ? "json"
            : "html",
        ).catch(() => null);
      }
      if (!capture) {
        const failure = await snapshotPage(page).catch(() => snapshot);
        if (failure)
          capture = await saveCapture(
            this.root,
            this.run,
            task,
            failure.body,
            failure.url,
            "html",
          ).catch(() => null);
      }
      if (capture) error.capture = capture;
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
      page.off("pageerror", onPageError);
      page.off("requestfailed", onRequestFailed);
      if (this.run.options?.diagnostics && capture) {
        diagnostics.finishedAt = new Date().toISOString();
        const dir = resolve(this.root, "runs", this.run.id, this.run.attemptId);
        await writeFile(
          resolve(dir, `page-${task.id}-diagnostics.json`),
          JSON.stringify(diagnostics, null, 2),
          { flag: "wx" },
        ).catch(() => {});
        await page
          .screenshot({ path: resolve(dir, `page-${task.id}-sample.png`) })
          .catch(() => {});
      }
      if (!browserPaging) await page.close().catch(() => {});
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
