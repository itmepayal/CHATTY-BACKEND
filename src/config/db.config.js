import mongoose from "mongoose";

const connectDB = async (url, dbName) => {
  try {
    const connection = await mongoose.connect(url, { dbName });
    return connection;
  } catch (error) {
    console.error("Database connection failed:", error.message);
    throw error;
  }
};

export default connectDB;