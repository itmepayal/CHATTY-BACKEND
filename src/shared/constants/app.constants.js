export const port = process.env.PORT;
export const clientUrl = (process.env.CLIENT_URL || "http://localhost:5173")
  .trim()
  .replace(/\/+$/, "");
export const resendApiKey = process.env.RESEND_API_KEY;
export const mongoUri = process.env.MONGO_URI;
export const mongoDbName = process.env.MONGO_DB;
export const serverUrl = process.env.SERVER_URL || `http://localhost:${port}`;
export const appSchemeUrl = process.env.APP_SCHEME_URL || "chatty://";

const clientUrls = (process.env.CLIENT_URL || "")
  .split(",")
  .map((u) => u.trim().replace(/\/+$/, ""))
  .filter(Boolean);

export const ALLOWED_ORIGINS = Object.freeze(
  Array.from(
    new Set(
      [
        "http://localhost:5173",
        "http://localhost:3000",
        "http://localhost:19006",
        "https://chatty-app-sigma.vercel.app",
        "https://chatty-backend-2l2t.onrender.com",
        clientUrl,
        ...clientUrls,
      ]
        .filter(Boolean)
        .map((url) => url.trim().replace(/\/+$/, "")),
    ),
  ),
);

export const isAllowedOrigin = (origin) => {
  if (!origin) return true;
  const normalized = String(origin).trim().replace(/\/+$/, "");
  return ALLOWED_ORIGINS.includes(normalized);
};

export const corsOriginValidator = (origin, callback) => {
  if (isAllowedOrigin(origin)) {
    return callback(null, true);
  }
  console.warn(`[CORS] Blocked request from origin: ${origin}`);
  return callback(new Error(`CORS blocked for origin: ${origin}`));
};

export const cloudinaryName = process.env.CLOUDINARY_NAME;
export const cloudinaryApiKey = process.env.CLOUDINARY_API_KEY;
export const cloudinaryApiSecret = process.env.CLOUDINARY_API_SECRET;

export const geminiApiKey = process.env.GEMINI_API_KEY;

export const swaggerEnabled = process.env.SWAGGER_ENABLED === "true";
export const swaggerServerUrl =
  process.env.SWAGGER_SERVER_URL || `http://localhost:${port}/api/v1`;
