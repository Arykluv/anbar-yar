export class AppError extends Error {
  readonly code: string;
  readonly userMessage: string;
  readonly technical: unknown;

  constructor(code: string, userMessage: string, technical?: unknown) {
    super(userMessage);
    this.name = "AppError";
    this.code = code;
    this.userMessage = userMessage;
    this.technical = technical;
    if (technical !== undefined) {
      console.error(`[anbar] ${code}:`, technical);
    }
  }
}

export const ErrCodes = {
  VALIDATION: "validation",
  DB: "db",
  TOROB_CORS: "torob-cors",
  TOROB_NETWORK: "torob-network",
  TOROB_NOT_FOUND: "torob-not-found",
  TOROB_PARSE: "torob-parse",
  TOROB_URL: "torob-url",
  RATE_UNAVAILABLE: "rate-unavailable",
  IMAGE_DOWNLOAD: "image-download",
  BACKUP_PARSE: "backup-parse",
  BACKUP_WRITE: "backup-write",
} as const;