import { Request, Response, NextFunction } from "express";
import { z, ZodError } from "zod";

// Schema for /identify request body
export const identifySchema = z
  .object({
    email: z
      .string()
      .email("Invalid email format")
      .nullable()
      .optional(),
    phoneNumber: z
      .union([z.string(), z.number()])
      .transform((val) => (val !== null && val !== undefined ? String(val) : val))
      .nullable()
      .optional(),
  })
  .refine(
    (data) => {
      const hasEmail = data.email !== null && data.email !== undefined && data.email !== "";
      const hasPhone = data.phoneNumber !== null && data.phoneNumber !== undefined && data.phoneNumber !== "";
      return hasEmail || hasPhone;
    },
    {
      message: "At least one of email or phoneNumber must be provided",
    }
  );

export type IdentifyInput = z.infer<typeof identifySchema>;

export function validateIdentify(
  req: Request,
  res: Response,
  next: NextFunction
): void {
  try {
    req.body = identifySchema.parse(req.body);
    next();
  } catch (err) {
    if (err instanceof ZodError) {
      res.status(400).json({
        error: "Validation Error",
        message: err.errors.map((e) => e.message).join(", "),
        statusCode: 400,
      });
      return;
    }
    next(err);
  }
}
