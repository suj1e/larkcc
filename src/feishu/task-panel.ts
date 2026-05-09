import * as lark from "@larksuiteoapi/node-sdk";

// ── 任务面板卡片 ─────────────────────────────────────────────

export type TaskPanelStatus = "running" | "completed" | "failed" | "stopped";

export interface TaskPanelCardOptions {
  description: string;
  status: TaskPanelStatus;
  summary?: string;
  lastToolName?: string;
  elapsedSeconds?: number;
  tokens?: number;
  headerIconImgKey?: string;
}

const STATUS_TEMPLATE: Record<TaskPanelStatus, { color: string; icon: string; label: string }> = {
  running:  { color: "turquoise", icon: "🔄", label: "Running" },
  completed: { color: "green",    icon: "✅", label: "Completed" },
  failed:   { color: "red",      icon: "❌", label: "Failed" },
  stopped:  { color: "grey",     icon: "⏹",  label: "Stopped" },
};

function fmtDur(sec: number): string {
  return sec < 60
    ? `${sec.toFixed(0)}s`
    : `${Math.floor(sec / 60)}m ${Math.round(sec % 60)}s`;
}

function buildTaskPanelCard(options: TaskPanelCardOptions) {
  const { description, status, summary, lastToolName, elapsedSeconds, tokens, headerIconImgKey } = options;
  const st = STATUS_TEMPLATE[status];

  const elements: any[] = [];

  const statusParts: string[] = [`**${st.icon} ${st.label}**`];
  if (lastToolName && status === "running") statusParts.push(`Tool: \`${lastToolName}\``);
  elements.push({ tag: "markdown", content: statusParts.join(" · ") });

  const hasContent = summary && summary !== "Done" && summary !== "Aborted";
  if (hasContent) {
    elements.push({ tag: "markdown", content: summary!.length > 3000 ? summary!.slice(0, 3000) + "..." : summary });
  } else if (status === "running") {
    elements.push({ tag: "markdown", content: "Processing..." });
  }

  const footerColumns: any[] = [];
  if (elapsedSeconds != null) {
    footerColumns.push({
      tag: "column",
      width: "weighted",
      weight: 1,
      vertical_align: "center",
      elements: [{ tag: "markdown", content: `<font color='grey'>⏱ ${fmtDur(elapsedSeconds)}</font>`, text_size: "notation" }],
    });
  }
  if (status !== "running" && tokens != null) {
    footerColumns.push({
      tag: "column",
      width: "weighted",
      weight: 1,
      vertical_align: "center",
      elements: [{ tag: "markdown", content: `<font color='grey'>🪙 ${tokens.toLocaleString()} tokens</font>`, text_size: "notation" }],
    });
  }
  if (footerColumns.length > 0) {
    elements.push({
      tag: "column_set",
      flex_mode: "none",
      background_style: "default",
      columns: footerColumns,
    });
  }

  const icon = headerIconImgKey
    ? { tag: "custom_icon", img_key: headerIconImgKey }
    : { tag: "standard_icon", token: "larkcommunity_colorful" };

  return {
    schema: "2.0",
    config: { wide_screen_mode: true },
    header: {
      title: { tag: "plain_text", content: "🤖 Sub Agent" },
      subtitle: { tag: "plain_text", content: description },
      template: st.color,
      icon,
    },
    body: { elements },
  };
}

export async function sendTaskCard(
  client: lark.Client,
  chatId: string,
  rootMsgId: string,
  description: string,
  headerIconImgKey?: string,
): Promise<string> {
  const card = buildTaskPanelCard({ description, status: "running", headerIconImgKey });
  const res = await (client.im.message as any).reply({
    path: { message_id: rootMsgId },
    data: { content: JSON.stringify(card), msg_type: "interactive", reply_in_thread: false },
  });
  return res.data?.message_id ?? "";
}

export async function updateTaskCard(
  client: lark.Client,
  msgId: string,
  options: TaskPanelCardOptions,
): Promise<void> {
  const card = buildTaskPanelCard(options);
  await client.im.message.patch({
    path: { message_id: msgId },
    data: { content: JSON.stringify(card) },
  });
}
