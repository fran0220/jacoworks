import type { AvatarAnimator } from "../avatar/AvatarAnimator";

export type LeaderWsState = "idle" | "listening" | "thinking" | "speaking" | "tool_use" | "done";

export interface LeaderBubble {
  text: string;
  type: "status" | "summary" | "info";
}

export class LeaderDriver {
  private getAnimator: () => AvatarAnimator | null;
  private state: LeaderWsState = "idle";
  private bubble: LeaderBubble = { text: "", type: "info" };
  private textBuffer = "";
  private timers: ReturnType<typeof setTimeout>[] = [];

  constructor(getAnimator: () => AvatarAnimator | null) {
    this.getAnimator = getAnimator;
  }

  onUserSend(): void {
    this.clearTimers();
    this.state = "listening";
    this.getAnimator()?.setState("thinking");
    this.bubble = { text: "收到，让我想想...", type: "status" };
  }

  onThinkingStart(): void {
    this.clearTimers();
    this.state = "thinking";
    this.getAnimator()?.setState("thinking");
    this.bubble = { text: "🤔 思考中...", type: "status" };
  }

  onThinkingDelta(_text: string): void {
    // State stays "thinking", bubble unchanged
  }

  onTextDelta(text: string): void {
    this.clearTimers();
    this.state = "speaking";
    this.textBuffer += text;
    this.getAnimator()?.setState("working");
    const preview = this.textBuffer.length > 40
      ? this.textBuffer.slice(0, 40) + "..."
      : this.textBuffer;
    this.bubble = { text: preview, type: "summary" };
  }

  onToolStart(toolName: string): void {
    this.clearTimers();
    this.state = "tool_use";
    this.getAnimator()?.setState("working");
    this.bubble = { text: `🔧 使用 ${toolName}...`, type: "status" };
  }

  onToolEnd(toolName: string): void {
    this.clearTimers();
    const prevState = this.state;
    this.state = this.textBuffer ? "speaking" : "idle";
    this.getAnimator()?.setState(this.textBuffer ? "working" : "idle");
    this.bubble = { text: `✅ ${toolName} 完成`, type: "status" };

    const tid = setTimeout(() => {
      if (this.state === "speaking" || (this.state === prevState && this.textBuffer)) {
        const preview = this.textBuffer.length > 40
          ? this.textBuffer.slice(0, 40) + "..."
          : this.textBuffer;
        this.bubble = { text: preview, type: "summary" };
      }
    }, 1500);
    this.timers.push(tid);
  }

  onDone(): void {
    this.clearTimers();
    this.state = "done";
    this.getAnimator()?.setState("idle");

    if (this.textBuffer) {
      const tail = this.textBuffer.length > 40
        ? this.textBuffer.slice(-40)
        : this.textBuffer;
      this.bubble = { text: `${tail} ✓`, type: "summary" };
    } else {
      this.bubble = { text: "回答完毕 ✓", type: "status" };
    }

    const tid = setTimeout(() => {
      if (this.state === "done") this.onIdle();
    }, 3000);
    this.timers.push(tid);
  }

  onIdle(): void {
    this.clearTimers();
    this.state = "idle";
    this.textBuffer = "";
    this.getAnimator()?.setState("idle");
    this.bubble = { text: "", type: "info" };
  }

  getState(): LeaderWsState {
    return this.state;
  }

  getBubble(): LeaderBubble {
    return this.bubble;
  }

  reset(): void {
    this.clearTimers();
    this.state = "idle";
    this.textBuffer = "";
    this.bubble = { text: "", type: "info" };
    this.getAnimator()?.setState("idle");
  }

  private clearTimers(): void {
    for (const t of this.timers) clearTimeout(t);
    this.timers = [];
  }
}
