export interface EmailPayload {
  to: string | string[];
  subject: string;
  html: string;
  text?: string;
  from?: string;
  replyTo?: string;
  tags?: Record<string, string>;
}

export interface EmailDeliveryResult {
  id: string;
  provider: string;
  status: 'sent' | 'queued' | 'simulated';
  error?: string;
}

export interface EmailProvider {
  readonly name: string;
  sendEmail(payload: EmailPayload): Promise<EmailDeliveryResult>;
}
