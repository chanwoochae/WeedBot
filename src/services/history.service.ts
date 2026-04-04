import { createClient } from "@supabase/supabase-js";

const HISTORY_WINDOW = Number(process.env.HISTORY_WINDOW ?? 20);

const supabase = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_KEY!,
);

interface HistoryEntry {
  role: "user" | "assistant";
  content: string;
}

export async function getHistory(userId: string): Promise<HistoryEntry[]> {
  const { data, error } = await supabase
    .from("secretary_messages")
    .select("role, content")
    .eq("user_id", userId)
    .order("created_at", { ascending: false })
    .limit(HISTORY_WINDOW);

  if (error) {
    console.error("히스토리 조회 실패:", error.message);
    return [];
  }

  return (data ?? []).reverse() as HistoryEntry[];
}

export async function saveMessage(
  userId: string,
  role: "user" | "assistant",
  content: string,
): Promise<void> {
  const { error } = await supabase
    .from("secretary_messages")
    .insert({ user_id: userId, role, content });

  if (error) {
    console.error("메시지 저장 실패:", error.message);
  }
}
