export interface TransportMessage {
  id?: string | number;
  type: string;
  [key: string]: unknown;
}

export interface TransportSender {
  send(payload: unknown): void;
}
