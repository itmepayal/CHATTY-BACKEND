import { v2 as cloudinary } from "cloudinary";
import fs from "fs/promises";
import {
  cloudinaryName,
  cloudinaryApiKey,
  cloudinaryApiSecret,
} from "../constants/constants.js";

cloudinary.config({
  cloud_name: cloudinaryName,
  api_key: cloudinaryApiKey,
  api_secret: cloudinaryApiSecret,
});

const uploadFileToCloudinary = async (localFilePath) => {
  if (!localFilePath) return null;
  try {
    const response = await cloudinary.uploader.upload(localFilePath, {
      resource_type: "auto",
    });
    return response;
  } catch (error) {
    console.error("Error uploading file to Cloudinary:", error);
    return null;
  } finally {
    await fs.unlink(localFilePath).catch(() => { });
  }
};

const deleteFileToCloudinary = async (publicId, resourceType = "image") => {
  try {
    return await cloudinary.uploader.destroy(publicId, {
      resource_type: resourceType,
    });
  } catch (error) {
    console.error("Error deleting file:", error);
    throw error;
  }
};

export { uploadFileToCloudinary, deleteFileToCloudinary };
