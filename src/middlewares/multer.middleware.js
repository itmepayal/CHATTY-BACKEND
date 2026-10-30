import multer from "multer";
import path from "path";
import crypto from "crypto";
import fs from "fs";
import {
  MAX_NORMAL_FILE_SIZE,
  MAX_MEDIA_FILE_SIZE,
  BLOCKED_EXTENSIONS,
  UPLOAD_DIR as UPLOAD_DIR_CONST,
} from "../constants/constants.js";

const UPLOAD_DIR = path.resolve(UPLOAD_DIR_CONST);

fs.mkdirSync(UPLOAD_DIR, { recursive: true });

const storage = multer.diskStorage({
  destination: (_req, _file, cb) => cb(null, UPLOAD_DIR),
  filename: (_req, file, cb) => {
    const ext = path.extname(file.originalname);
    cb(null, `${crypto.randomUUID()}${ext}`);
  },
});

const upload = multer({
  storage,
  limits: { fileSize: MAX_MEDIA_FILE_SIZE },
  fileFilter: (req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase();
    if (BLOCKED_EXTENSIONS.has(ext)) {
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
  const limit = isMedia ? MAX_MEDIA_FILE_SIZE : MAX_NORMAL_FILE_SIZE;

  if (file.size > limit) {
    fs.unlink(file.path, () => { });
    return res.status(413).json({
      success: false,
      message: `File too large. Max ${Math.round(limit / 1024 / 1024)}MB allowed.`,
    });
  }

  next();
};

export default upload;
