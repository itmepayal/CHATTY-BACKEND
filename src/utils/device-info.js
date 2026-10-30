import { UAParser } from "ua-parser-js";

export function parseDevice(ua = "") {
  const parser = new UAParser(ua);
  const result = parser.getResult();

  const browser = result.browser?.name || "Unknown browser";
  const os = result.os?.name || "Unknown OS";
  const type = result.device?.type || "desktop";

  const label =
    browser !== "Unknown browser" && os !== "Unknown OS"
      ? `${browser} on ${os}`
      : browser !== "Unknown browser"
        ? browser
        : os !== "Unknown OS"
          ? os
          : "Unknown device";

  return { browser, os, label, type };
}

export function sanitizeIp(ip = "") {
  if (!ip || ip === "::1" || ip === "127.0.0.1") return "localhost";

  const v4 = ip.match(/^(\d{1,3}\.\d{1,3}\.\d{1,3})\.\d{1,3}$/);
  if (v4) return `${v4[1]}.x`;

  if (ip.includes(":")) return "IPv6";

  return ip.slice(0, 12) || "Unknown";
}

export function getIp(req) {
  const forwarded = req.headers["x-forwarded-for"];
  if (forwarded) {
    const first = forwarded.split(",")[0].trim();
    return first;
  }
  return req.socket?.remoteAddress || req.ip || "Unknown";
}
