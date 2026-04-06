import { createClient, SupabaseClient } from "@supabase/supabase-js";

const HISTORY_WINDOW = Number(process.env.HISTORY_WINDOW ?? 20);

let _supabase: SupabaseClient | null = null;

function getSupabase(): SupabaseClient {
  if (!_supabase) {
    _supabase = createClient(
      process.env.SUPABASE_URL!,
      process.env.SUPABASE_KEY!,
    );
  }
  return _supabase;
}

interface HistoryEntry {
  role: "user" | "assistant";
  content: string;
}

export async function getHistory(userId: string): Promise<HistoryEntry[]> {
  const { data, error } = await getSupabase()
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
  const { error } = await getSupabase()
    .from("secretary_messages")
    .insert({ user_id: userId, role, content });

  if (error) {
    console.error("메시지 저장 실패:", error.message);
  }
}

export async function clearHistory(userId: string): Promise<number> {
  const { count, error } = await getSupabase()
    .from("secretary_messages")
    .delete({ count: "exact" })
    .eq("user_id", userId);

  if (error) {
    console.error("히스토리 삭제 실패:", error.message);
    throw error;
  }

  return count ?? 0;
}
