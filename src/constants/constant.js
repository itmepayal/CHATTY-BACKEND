export const port = process.env.PORT;
export const clientUrl = process.env.CLIENT_URL || "http://localhost:5173";
export const resendApiKey = process.env.RESEND_API_KEY;
export const mongoUri = process.env.MONGO_URI;
export const mongoDbName = process.env.MONGO_DB;

export const cloudinaryName = process.env.CLOUDINARY_NAME;
export const cloudinaryApiKey = process.env.CLOUDINARY_API_KEY;
export const cloudinaryApiSecret = process.env.CLOUDINARY_API_SECRET;

export const accessToken = process.env.ACCESS_TOKEN_SECRET;
export const accessTokenExpiresIn = process.env.ACCESS_TOKEN_EXPIRES_IN;

export const refreshTokenScret = process.env.REFRESH_TOKEN_SECRET;
export const refreshTokenExpiresIn = process.env.REFRESH_TOKEN_EXPIRES_IN;

export const salt = 15;

export const options = {
  httpOnly: true,
  secure: process.env.NODE_ENV === "production",
  sameSite: "strict",
  maxAge: 24 * 60 * 60 * 1000,
};

export const geminiApiKey = process.env.GEMINI_API_KEY;

export const RESET_TOKEN_BYTES = 32;
export const RESET_TOKEN_TTL_MS = 30 * 60 * 1000;
