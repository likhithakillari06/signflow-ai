/** An error whose message is safe and useful to show to the person using the app. */
export class AppError extends Error {}

export function userMessage(err: unknown, fallback = "Something went wrong. Please try again."): string {
  if (err instanceof AppError) return err.message;
  if (err && typeof err === "object" && "problem" in err && err instanceof Error) return err.message; // PdfValidationError
  return fallback;
}
