const mongoose = require('mongoose');
const dns = require("dns");

// const connectDB = async () => {
//   try {
//     const conn = await mongoose.connect(process.env.MONGODB_URI, {
//       useNewUrlParser: true,
//       useUnifiedTopology: true,
//     });

//     console.log(`MongoDB Connected: ${conn.connection.host}`);
//   } catch (error) {
//     console.error(`Error: ${error.message}`);
//     process.exit(1);
//   }
// };

dns.setServers(["8.8.8.8", "1.1.1.1"]);

const connectDB = async () => {
  try {
    if (!process.env.MONGODB_URI) {
      throw new Error("MONGODB_URI is not defined in your environment variables");
    }

    const srvHost = process.env.MONGODB_URI.match(/@(.+?)\//)?.[1];
    if (srvHost) {
      dns.resolveSrv(`_mongodb._tcp.${srvHost}`, (err, addresses) => {
        if (err) {
          console.warn("SRV DNS lookup failed:", err.message);
        } else {
          console.log("SRV DNS addresses:", addresses);
        }
      });
    }

    await mongoose.connect(process.env.MONGODB_URI);

    console.log("DB connected successfully");
  } catch (err) {
    console.error("DB connection failed:", err.message);
    process.exit(1);
  }
};

module.exports = connectDB;