#!/usr/bin/env node

import nextConfig from "../next.config.mjs";

function fail(message) {
  console.error(`FAIL: ${message}`);
  process.exitCode = 1;
}

function headerMap(route) {
  return new Map((route.headers ?? []).map((header) => [String(header.key).toLowerCase(), String(header.value).toLowerCase()]));
}

const routes = typeof nextConfig.headers === "function" ? await nextConfig.headers() : [];
for (const source of ["/api/:path*", "/admin/:path*", "/admin", "/invite"]) {
  const route = routes.find((item) => item.source === source);
  if (!route) {
    fail(`${source} no-store header route is missing.`);
    continue;
  }

  const headers = headerMap(route);
  if (!headers.get("cache-control")?.includes("no-store")) fail(`${source} Cache-Control no-store is missing.`);
  if (headers.get("x-robots-tag") !== "noindex") fail(`${source} X-Robots-Tag noindex is missing.`);
}

if (process.exitCode) process.exit();
console.log("Security headers verified.");
