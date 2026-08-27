export interface EmailCodeMailer {
  sendCode(email: string, code: string, expiresInMinutes: number): Promise<void>;
}

export class UnconfiguredEmailCodeMailer implements EmailCodeMailer {
  async sendCode(): Promise<void> {
    throw new Error("SMTP is not configured");
  }
}
