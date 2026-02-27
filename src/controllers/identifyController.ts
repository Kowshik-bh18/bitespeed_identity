import { Request, Response, NextFunction } from "express";
import { reconcileIdentity } from "../services/identityService";
import { logger } from "../utils/logger";

export async function identifyController(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    const { email, phoneNumber } = req.body;

    logger.info("POST /identify called", { email, phoneNumber });

    const contact = await reconcileIdentity(email, phoneNumber);

    res.status(200).json({ contact });
  } catch (error) {
    next(error);
  }
}
