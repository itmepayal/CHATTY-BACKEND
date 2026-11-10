import dns from "node:dns/promises";
import net from "node:net";
import http from "node:http";
import https from "node:https";
import * as cheerio from "cheerio";
import Message from "../../modules/messaging/models/message.model.js";
import { io } from "../../infrastructure/socket/socket.js";

const URL_RE = /https?:\/\/[^\s<>"']+/i;
const MAX_HTML_BYTES = 512 * 1024; // 512 KB cap
const TIMEOUT_MS = 4000;
const MAX_REDIRECTS = 3;

export const isPrivateIp = (ip) => {
  if (!ip || typeof ip !== "string") return true;

  if (ip.startsWith("::ffff:")) {
    const v4 = ip.slice(7);
    if (net.isIPv4(v4)) return isPrivateIp(v4);
  }

  if (net.isIPv6(ip)) {
    const normalized = ip.toLowerCase();
    return (
      normalized === "::1" ||
      normalized === "::" ||
      /^(fc|fd|fe80)/i.test(normalized)
    );
  }

  if (!net.isIPv4(ip)) return true;

  const parts = ip.split(".").map(Number);
  if (
    parts.length !== 4 ||
    parts.some((n) => Number.isNaN(n) || n < 0 || n > 255)
  ) {
    return true;
  }

  const [a, b] = parts;
  return (
    a === 0 || // 0.0.0.0/8 Current network
    a === 10 || // 10.0.0.0/8 Private network
    a === 127 || // 127.0.0.0/8 Loopback
    (a === 100 && b >= 64 && b <= 127) || // 100.64.0.0/10 Shared address space / CGNAT
    (a === 169 && b === 254) || // 169.254.0.0/16 Link-local
    (a === 172 && b >= 16 && b <= 31) || // 172.16.0.0/12 Private network
    (a === 192 && b === 0 && parts[2] === 0) || // 192.0.0.0/24 IETF Protocol
    (a === 192 && b === 168) || // 192.168.0.0/16 Private network
    (a === 198 && (b === 18 || b === 19)) || // 198.18.0.0/15 Benchmark testing
    a >= 224 // 224.0.0.0/4 Multicast & reserved
  );
};

export const safeFetch = async (urlStr, hops = 0) => {
  if (hops > MAX_REDIRECTS) throw new Error("Too many redirects");

  const u = new URL(urlStr);
  if (!["http:", "https:"].includes(u.protocol)) {
    throw new Error("Bad protocol");
  }

  // 1. Resolve DNS records and validate all resolved addresses
  const lookupRes = await dns.lookup(u.hostname, { all: true });
  if (!lookupRes || !lookupRes.length) {
    throw new Error("Could not resolve host");
  }

  for (const entry of lookupRes) {
    if (isPrivateIp(entry.address)) {
      throw new Error("Blocked address");
    }
  }

  // Pin connection to the first validated IP address to prevent DNS rebinding
  const pinnedAddress = lookupRes[0].address;
  const pinnedFamily = lookupRes[0].family;
  const transport = u.protocol === "https:" ? https : http;
  const port = u.port || (u.protocol === "https:" ? 443 : 80);

  return new Promise((resolve, reject) => {
    let finished = false;
    const cleanupAndReject = (err) => {
      if (finished) return;
      finished = true;
      req.destroy();
      reject(err);
    };

    const reqOptions = {
      protocol: u.protocol,
      hostname: u.hostname,
      port,
      path: `${u.pathname}${u.search}`,
      method: "GET",
      headers: {
        "User-Agent": "ChattyLinkPreview/1.0",
        Accept: "text/html,application/xhtml+xml",
      },
      lookup: (_hostname, _opts, cb) => cb(null, pinnedAddress, pinnedFamily),
      timeout: TIMEOUT_MS,
    };

    if (u.protocol === "https:") {
      reqOptions.servername = u.hostname; // SNI for TLS verification
    }

    const req = transport.request(reqOptions, (res) => {
      // 2. Handle Redirects (re-validates every hop via recursive safeFetch)
      if (
        res.statusCode >= 300 &&
        res.statusCode < 400 &&
        res.headers.location
      ) {
        res.resume();
        const nextUrl = new URL(res.headers.location, u).toString();
        finished = true;
        resolve(safeFetch(nextUrl, hops + 1));
        return;
      }

      if (res.statusCode < 200 || res.statusCode >= 300) {
        cleanupAndReject(new Error(`Bad status code: ${res.statusCode}`));
        return;
      }

      // 3. Reject non-HTML content-types early
      const contentType = res.headers["content-type"] || "";
      if (!contentType.toLowerCase().includes("text/html")) {
        cleanupAndReject(new Error("Not an HTML page"));
        return;
      }

      // 4. Check Content-Length header early
      const contentLength = Number(res.headers["content-length"]);
      if (Number.isFinite(contentLength) && contentLength > MAX_HTML_BYTES) {
        cleanupAndReject(new Error("Response exceeds size limit"));
        return;
      }

      // 5. Read body as stream with hard 512KB cap (no full buffering)
      const chunks = [];
      let bytesRead = 0;

      res.on("data", (chunk) => {
        bytesRead += chunk.length;
        if (bytesRead > MAX_HTML_BYTES) {
          res.destroy(); // Cease reading stream
          finished = true;
          const html = Buffer.concat(chunks).toString("utf8");
          resolve({ html, finalUrl: u.toString() });
        } else {
          chunks.push(chunk);
        }
      });

      res.on("end", () => {
        if (finished) return;
        finished = true;
        const html = Buffer.concat(chunks).toString("utf8");
        resolve({ html, finalUrl: u.toString() });
      });

      res.on("error", cleanupAndReject);
    });

    req.on("timeout", () => {
      cleanupAndReject(new Error("Request timed out"));
    });

    req.on("error", cleanupAndReject);
    req.end();
  });
};

export const buildPreview = async (url) => {
  const { html, finalUrl } = await safeFetch(url);
  const $ = cheerio.load(html);
  const og = (p) => $(`meta[property="og:${p}"]`).attr("content");

  const title = og("title") || $("title").first().text().trim();
  if (!title) return null;

  let image = og("image");
  if (image) {
    try {
      image = new URL(image, finalUrl).toString();
    } catch {
      image = undefined;
    }
  }

  return {
    url: finalUrl,
    title: title.slice(0, 150),
    description: (
      og("description") ||
      $('meta[name="description"]').attr("content") ||
      ""
    ).slice(0, 250),
    image,
    siteName: og("site_name") || new URL(finalUrl).hostname,
  };
};

export const attachLinkPreview = async (message) => {
  try {
    const url = message.text?.match(URL_RE)?.[0];
    if (!url) return;

    const preview = await buildPreview(url);
    if (!preview) return;

    await Message.updateOne(
      { _id: message._id },
      { $set: { linkPreview: preview } },
    );

    const payload = { messageId: message._id, linkPreview: preview };
    io.to(message.senderId.toString()).emit("messageLinkPreview", payload);
    io.to(message.receiverId.toString()).emit("messageLinkPreview", payload);
  } catch {}
};
