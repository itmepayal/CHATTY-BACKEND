import multer from "multer";
import path from "path";
import crypto from "crypto";

const MAX_SIZE = 10 * 1024 * 1024;

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
  destination: (req, file, cb) => cb(null, "./public/upload"),
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

export default upload;
