import { z } from "zod";
import { US_STATE_CODES } from "../config/states.js";

function isAtLeast18(dateOfBirth: string, today = new Date()): boolean {
  const [year, month, day] = dateOfBirth.split("-").map(Number);
  let age = today.getFullYear() - year;
  const hasHadBirthdayThisYear =
    today.getMonth() + 1 > month ||
    (today.getMonth() + 1 === month && today.getDate() >= day);

  if (!hasHadBirthdayThisYear) {
    age -= 1;
  }

  return age >= 18;
}

export const createQuoteSchema = z.object({
  make: z.string().trim().min(1, "make is required"),
  model: z.string().trim().min(1, "model is required"),
  year: z
    .number({ error: "year must be a number" })
    .int("year must be an integer")
    .min(1900, "year must be >= 1900")
    .max(2100, "year must be <= 2100"),
  date_of_birth: z
    .iso.date("date_of_birth must be YYYY-MM-DD")
    .refine(isAtLeast18, {
      message: "Applicant must be at least 18 years old",
    }),
  vin: z.string().trim().min(1, "vin cannot be empty").optional(),
  state: z
    .string()
    .trim()
    .transform((value) => value.toUpperCase())
    .pipe(
      z.enum(US_STATE_CODES, {
        error: "state must be a valid US state code",
      }),
    ),
});

export const quoteIdSchema = z.uuid("id must be a valid UUID");

export type CreateQuoteBody = z.infer<typeof createQuoteSchema>;
