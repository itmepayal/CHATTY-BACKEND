import { StatusCodes } from "http-status-codes";
import asyncHandler from "../../../middlewares/asyncHandler.middleware.js";
import ApiResponse from "../../../shared/responses/api-response.js";
import * as e2eeService from "../services/e2ee.service.js";

export const getStatus = asyncHandler(async (req, res) => {
  const data = await e2eeService.getStatus(req.user._id);
  return new ApiResponse(
    StatusCodes.OK,
    data,
    "E2EE status retrieved successfully.",
  ).send(res);
});

export const registerKeys = asyncHandler(async (req, res) => {
  const data = await e2eeService.registerKeys(req.user._id, req.body);
  const status = data.duplicate ? StatusCodes.OK : StatusCodes.CREATED;
  return new ApiResponse(
    status,
    data,
    "E2EE keys registered successfully.",
  ).send(res);
});

export const getBackup = asyncHandler(async (req, res) => {
  const data = await e2eeService.getBackup(req.user._id);
  return new ApiResponse(
    StatusCodes.OK,
    data,
    "Encrypted key backup retrieved successfully.",
  ).send(res);
});

export const updateBackup = asyncHandler(async (req, res) => {
  const data = await e2eeService.updateBackup(req.user._id, req.body);
  return new ApiResponse(
    StatusCodes.OK,
    data,
    "Encrypted key backup updated successfully.",
  ).send(res);
});

export const resetKeys = asyncHandler(async (req, res) => {
  const data = await e2eeService.resetKeys(req.user._id, req.body);
  return new ApiResponse(
    StatusCodes.OK,
    data,
    "E2EE keys reset successfully.",
  ).send(res);
});

export const getPublicKey = asyncHandler(async (req, res) => {
  const data = await e2eeService.getPublicKey(req.params.id);
  return new ApiResponse(
    StatusCodes.OK,
    data,
    "Public key retrieved successfully.",
  ).send(res);
});

export const getPublicKeysBatch = asyncHandler(async (req, res) => {
  const data = await e2eeService.getPublicKeysBatch(req.body.userIds);
  return new ApiResponse(
    StatusCodes.OK,
    data,
    "Public keys retrieved successfully.",
  ).send(res);
});

export const registerDevice = asyncHandler(async (req, res) => {
  const data = await e2eeService.registerDevice(req.user._id, req.body);
  return new ApiResponse(
    StatusCodes.CREATED,
    data,
    "Device key registered successfully.",
  ).send(res);
});

export const getDevices = asyncHandler(async (req, res) => {
  const data = await e2eeService.getDevices(req.user._id);
  return new ApiResponse(
    StatusCodes.OK,
    data,
    "Devices retrieved successfully.",
  ).send(res);
});

export const revokeDevice = asyncHandler(async (req, res) => {
  const data = await e2eeService.revokeDevice(req.user._id, req.params.deviceId);
  return new ApiResponse(
    StatusCodes.OK,
    data,
    "Device revoked successfully.",
  ).send(res);
});

export const getDevicesPublicKeys = asyncHandler(async (req, res) => {
  const data = await e2eeService.getDevicesPublicKeys(req.body.userIds);
  return new ApiResponse(
    StatusCodes.OK,
    data,
    "Device public keys retrieved successfully.",
  ).send(res);
});

const e2eeController = {
  getStatus,
  registerKeys,
  getBackup,
  updateBackup,
  resetKeys,
  getPublicKey,
  getPublicKeysBatch,
  registerDevice,
  getDevices,
  revokeDevice,
  getDevicesPublicKeys,
};

export default e2eeController;
