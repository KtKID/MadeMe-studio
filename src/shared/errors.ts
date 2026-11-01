export class AppError extends Error {
  status: number;
  code: string;
  details?: unknown;
  constructor(
    status: number,
    code: string,
    message: string,
    details?: unknown,
  ) {
    super(message);
    this.status = status;
    this.code = code;
    this.details = details;
    this.name = "AppError";
  }
}
export const notFound = () => new AppError(404, "NOT_FOUND", "Not found.");
