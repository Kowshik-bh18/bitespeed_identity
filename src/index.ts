import app from "./app";
import prisma from "./utils/prismaClient";
import { logger } from "./utils/logger";

const PORT = process.env.PORT || 3000;

async function main() {
  // Test database connection before starting
  try {
    await prisma.$connect();
    logger.info("✅ Database connected successfully");
  } catch (error) {
    logger.error("❌ Failed to connect to database", error);
    process.exit(1);
  }

  const server = app.listen(PORT, () => {
    logger.info(`🚀 Server running on port ${PORT}`);
    logger.info(`📍 POST http://localhost:${PORT}/identify`);
    logger.info(`🏥 GET  http://localhost:${PORT}/health`);
    logger.info(`🌍 Environment: ${process.env.NODE_ENV || "development"}`);
  });

  // Graceful shutdown
  const shutdown = async (signal: string) => {
    logger.info(`\n${signal} received. Shutting down gracefully...`);
    server.close(async () => {
      await prisma.$disconnect();
      logger.info("Database disconnected. Server closed.");
      process.exit(0);
    });
  };

  process.on("SIGTERM", () => shutdown("SIGTERM"));
  process.on("SIGINT", () => shutdown("SIGINT"));

  process.on("unhandledRejection", (reason, promise) => {
    logger.error("Unhandled Rejection", { reason, promise });
  });
}

main();
