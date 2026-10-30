import dns from "node:dns/promises";
import net from "node:net";
import * as cheerio from "cheerio";
import Message from "../models/message.model.js";
import { io } from "../lib/socket.js";

const URL_RE = /https?:\/\/[^\s<>"']+/i;

const isPrivateIp = (ip) => {
  if (net.isIPv6(ip)) {
    return (
      ip === "::1" || /^(fc|fd|fe80)/i.test(ip) || ip.startsWith("::ffff:")
    );
  }
  const [a, b] = ip.split(".").map(Number);
  return (
    a === 0 ||
    a === 10 ||
    a === 127 ||
    (a === 169 && b === 254) ||
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 168)
  );
};

const safeFetch = async (url, hops = 0) => {
  if (hops > 3) throw new Error("Too many redirects");

  const u = new URL(url);
  if (!["http:", "https:"].includes(u.protocol)) {
    throw new Error("Bad protocol");
  }

  const { address } = await dns.lookup(u.hostname);
  if (isPrivateIp(address)) throw new Error("Blocked address");

  const res = await fetch(u, {
    redirect: "manual",
    signal: AbortSignal.timeout(4000),
    headers: { "User-Agent": "ChattyLinkPreview/1.0", Accept: "text/html" },
  });

  if (res.status >= 300 && res.status < 400 && res.headers.get("location")) {
    return safeFetch(
      new URL(res.headers.get("location"), u).toString(),
      hops + 1,
    );
  }

  const type = res.headers.get("content-type") || "";
  if (!res.ok || !type.includes("text/html")) {
    throw new Error("Not an HTML page");
  }

  return {
    html: (await res.text()).slice(0, 500_000),
    finalUrl: u.toString(),
  };
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
