import mongoose from "mongoose";

const connectDB = async (url, dbname) => {
  try {
    await mongoose.connect(`${url}/${dbname}`);
  } catch (error) {
    console.log("Database connection failed!!");
  }
};

export default connectDB;
