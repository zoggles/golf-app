export class AuthenticationError extends Error {
  constructor(message = "Sign in with Google to continue.") {
    super(message);
    this.name = "AuthenticationError";
  }
}

export function bearerToken(request: Request): string {
  const authorization = request.headers.get("authorization") ?? "";
  const match = /^Bearer\s+(.+)$/i.exec(authorization);
  if (!match?.[1]) throw new AuthenticationError();
  return match[1];
}
