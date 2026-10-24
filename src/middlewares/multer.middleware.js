import multer from "multer";
import path from "path";
import crypto from "crypto";
import fs from "fs";

const MAX_SIZE = 50 * 1024 * 1024;
const MAX_NORMAL_SIZE = 10 * 1024 * 1024;
const MAX_MEDIA_SIZE = 50 * 1024 * 1024;

const UPLOAD_DIR = path.resolve("public/upload");
fs.mkdirSync(UPLOAD_DIR, { recursive: true });

const BLOCKED_EXT = new Set([
  ".exe",
  ".bat",
  ".cmd",
  ".sh",
  ".msi",
  ".com",
  ".scr",
  ".js",
  ".vbs",
  ".jar",
  ".apk",
  ".dmg",
]);

const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    fs.mkdirSync(UPLOAD_DIR, { recursive: true });
    cb(null, UPLOAD_DIR);
  },
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname);
    cb(null, `${crypto.randomUUID()}${ext}`);
  },
});

const upload = multer({
  storage,
  limits: { fileSize: MAX_SIZE },
  fileFilter: (req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase();
    if (BLOCKED_EXT.has(ext)) {
      return cb(new Error("This file type is not allowed."));
    }
    cb(null, true);
  },
});

export const enforceTypeSizeLimit = (req, res, next) => {
  const file = req.file;
  if (!file) return next();

  const isMedia =
    file.mimetype?.startsWith("video/") || file.mimetype?.startsWith("audio/");
  const limit = isMedia ? MAX_MEDIA_SIZE : MAX_NORMAL_SIZE;

  if (file.size > limit) {
    fs.unlink(file.path, () => {});
    return res.status(413).json({
      success: false,
      message: `File too large. Max ${Math.round(limit / 1024 / 1024)}MB allowed.`,
    });
  }

  next();
};

export default upload;
