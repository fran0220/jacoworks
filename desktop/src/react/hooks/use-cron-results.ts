export interface CronResultItem {
  jobId: string;
  jobName?: string;
  status: "ok" | "error";
  durationMs: number;
  resultPreview?: string;
  error?: string;
  timestamp: number;
}
