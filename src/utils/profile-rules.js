import { GENDERS } from "../constants/constants.js";

export const isValidTimeZone = (tz) => {
  try {
    new Intl.DateTimeFormat("en", { timeZone: tz });
    return true;
  } catch {
    return false;
  }
};

export const RULES = {
  fullName: {
    test: (v) => v.length >= 2 && v.length <= 50,
    msg: "Full name must be 2-50 characters.",
  },
  username: {
    test: (v) => /^[a-z0-9_.]{3,20}$/.test(v),
    msg: "Username must be 3-20 characters (letters, numbers, _ or .).",
  },
  phone: {
    test: (v) => /^[+\d][\d\s-]{7,15}$/.test(v),
    msg: "Invalid phone number.",
  },
  gender: {
    test: (v) => GENDERS.includes(v),
    msg: "Invalid gender value.",
  },
  location: {
    test: (v) => v.length <= 60,
    msg: "Location can be at most 60 characters.",
  },
  website: {
    test: (v) => /^https?:\/\/.+\..+/.test(v),
    msg: "Website must start with http:// or https://",
  },
  bio: {
    test: (v) => v.length <= 160,
    msg: "Bio can be at most 160 characters.",
  },
  timezone: {
    test: isValidTimeZone,
    msg: "Invalid timezone (example: Asia/Kolkata).",
  },
};
