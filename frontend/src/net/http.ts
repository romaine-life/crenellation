// Shared HTTP error for the net clients. Carrying the status code lets callers
// distinguish "sign-in required" (401) from other failures and react — e.g. the
// editors redirect to sign-in instead of showing a generic error.
export class HttpError extends Error {
  readonly status: number;

  constructor(action: string, status: number) {
    super(`${action} failed (${status})`);
    this.name = 'HttpError';
    this.status = status;
  }
}
