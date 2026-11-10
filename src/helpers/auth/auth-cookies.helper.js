import {
  accessCookieOptions,
  refreshCookieOptions,
} from "../../constants/auth/auth.constants.js";

export const setAuthCookies = (res, accessToken, refreshToken) => {
  res
    .cookie("accessToken", accessToken, accessCookieOptions)
    .cookie("refreshToken", refreshToken, refreshCookieOptions);
};

export const clearAuthCookies = (res) => {
  res
    .clearCookie("accessToken", accessCookieOptions)
    .clearCookie("refreshToken", refreshCookieOptions);
};
