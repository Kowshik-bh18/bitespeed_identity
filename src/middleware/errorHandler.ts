import { Request, Response, NextFunction } from "express";
import { logger } from "../utils/logger";

export function errorHandler(
  err: Error,
  req: Request,
  res: Response,
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  _next: NextFunction
): void {
  logger.error("Unhandled error", { message: err.message, stack: err.stack });

  res.status(500).json({
    error: "Internal Server Error",
    message:
      process.env.NODE_ENV === "production"
        ? "Something went wrong"
        : err.message,
    statusCode: 500,
  });
}

export function notFoundHandler(req: Request, res: Response): void {
  res.status(404).json({
    error: "Not Found",
    message: `Route ${req.method} ${req.path} not found`,
    statusCode: 404,
  });
}
