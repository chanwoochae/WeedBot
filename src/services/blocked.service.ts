import { createClient } from "@supabase/supabase-js";

const supabase = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_KEY!,
);

export interface BlockedItem {
  id: number;
  article_id: number | null;
  link: string;
  title: string | null;
  block_reason: string | null;
  status: string;
  created_at: string;
}

// PENDING 목록 조회
export async function listPending(): Promise<BlockedItem[]> {
  const { data, error } = await supabase
    .from("blocked_queue")
    .select("*")
    .eq("status", "PENDING")
    .order("created_at", { ascending: false })
    .limit(20);

  if (error) throw error;
  return data ?? [];
}

// 완료 처리
export async function markDone(id: number): Promise<void> {
  const { error } = await supabase
    .from("blocked_queue")
    .update({ status: "DONE", updated_at: new Date().toISOString() })
    .eq("id", id);

  if (error) throw error;
}

// 스킵 처리
export async function markSkipped(id: number): Promise<void> {
  const { error } = await supabase
    .from("blocked_queue")
    .update({ status: "SKIPPED", updated_at: new Date().toISOString() })
    .eq("id", id);

  if (error) throw error;
}

// 오늘 수집 현황
export async function getCollectStatus(): Promise<{
  pending: number;
  done: number;
  skipped: number;
  todayBlocked: number;
}> {
  const today = new Date();
  today.setHours(0, 0, 0, 0);

  const { data, error } = await supabase
    .from("blocked_queue")
    .select("status, created_at");

  if (error) throw error;

  const all = data ?? [];
  const todayItems = all.filter(
    (r) => new Date(r.created_at) >= today,
  );

  return {
    pending: all.filter((r) => r.status === "PENDING").length,
    done: all.filter((r) => r.status === "DONE").length,
    skipped: all.filter((r) => r.status === "SKIPPED").length,
    todayBlocked: todayItems.length,
  };
}
