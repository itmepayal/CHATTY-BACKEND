import multer from "multer";
import path from "path";
import crypto from "crypto";
import fs from "fs";
import {
  MAX_NORMAL_FILE_SIZE,
  MAX_MEDIA_FILE_SIZE,
  BLOCKED_EXTENSIONS,
  UPLOAD_DIR as UPLOAD_DIR_CONST,
} from "../constants/messaging/messages.constants.js";

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

export const cleanupMulterFiles = (req) => {
  const filesToDelete = [];
  if (req?.file?.path) filesToDelete.push(req.file.path);
  if (Array.isArray(req?.files)) {
    req.files.forEach((f) => f?.path && filesToDelete.push(f.path));
  } else if (req?.files && typeof req.files === "object") {
    Object.values(req.files)
      .flat()
      .forEach((f) => f?.path && filesToDelete.push(f.path));
  }

  for (const filePath of filesToDelete) {
    fs.unlink(filePath, (err) => {
      if (err && err.code !== "ENOENT") {
        console.error("Failed to delete temp multer file:", err);
      }
    });
  }
};

export const autoCleanupMulterOnFailure = (req, res, next) => {
  res.on("finish", () => {
    if (res.statusCode >= 400) {
      cleanupMulterFiles(req);
    }
  });
  res.on("close", () => {
    if (!res.writableEnded) {
      cleanupMulterFiles(req);
    }
  });
  next();
};

export const handleMulterError = (err, req, res, next) => {
  cleanupMulterFiles(req);
  next(err);
};

export default upload;
