import nodemailer from "nodemailer";
import type { EmailCodeMailer } from "./email-mailer.js";

export interface SmtpEmailCodeMailerOptions {
  host: string;
  port: number;
  user: string;
  authCode: string;
  from: string;
}

export class SmtpEmailCodeMailer implements EmailCodeMailer {
  private readonly transporter;
  constructor(private readonly options: SmtpEmailCodeMailerOptions) {
    this.transporter = nodemailer.createTransport({
      host: options.host,
      port: options.port,
      secure: options.port === 465,
      auth: { user: options.user, pass: options.authCode },
    });
  }

  async sendCode(email: string, code: string, expiresInMinutes: number): Promise<void> {
    await this.transporter.sendMail({
      from: `Reso.AI <${this.options.from}>`,
      to: email,
      subject: "你的 Reso.AI 验证码",
      text: `你的验证码是 ${code}，${expiresInMinutes} 分钟内有效。若不是你本人操作，请忽略这封邮件。`,
      html: `<div style="font-family:Arial,sans-serif;color:#314b57"><h2>Reso.AI</h2><p>你的验证码是</p><p style="font-size:30px;letter-spacing:8px;font-weight:700">${code}</p><p>${expiresInMinutes} 分钟内有效。验证码仅用于本次登录，请勿转发。</p></div>`,
    });
  }
}
