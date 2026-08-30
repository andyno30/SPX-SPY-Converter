"use client";

import { FormEvent, useCallback, useEffect, useMemo, useState } from "react";
import type { User } from "@supabase/supabase-js";

import { getBrowserSupabaseClient } from "@/lib/supabase/client";
import type { Database } from "@/lib/supabase/types";

type Reaction = "bullish" | "bearish";
type CommentRow = Database["public"]["Tables"]["news_comments"]["Row"];

interface NewsEngagementProps {
  articleId: number;
}

const LOGIN_URL = "https://spyconverter.com/docs/login.html";

function redirectToLogin() {
  const returnTo = window.location.href;
  window.location.assign(`${LOGIN_URL}?return_to=${encodeURIComponent(returnTo)}`);
}

function displayNameFor(user: User): string {
  const metadataName = user.user_metadata?.full_name || user.user_metadata?.name;
  if (typeof metadataName === "string" && metadataName.trim()) {
    return metadataName.trim().slice(0, 80);
  }
  return (user.email?.split("@")[0] || "Trader").slice(0, 80);
}

function BullIcon() {
  return (
    <svg viewBox="0 0 64 64" className="h-8 w-8 transition-transform duration-300 group-hover:-translate-y-1 group-hover:rotate-3 group-active:scale-90" aria-hidden="true">
      <path fill="currentColor" d="M19 25C9 24 5 16 7 9c4 6 9 8 16 6 3-3 6-5 9-5s6 2 9 5c7 2 12 0 16-6 2 7-2 15-12 16l-2 18c-3 7-8 11-11 11s-8-4-11-11l-2-18Z" />
      <path fill="white" d="M23 30h6v5h-6zm12 0h6v5h-6z" />
      <path fill="currentColor" stroke="white" strokeWidth="2" d="M27 43c3-2 7-2 10 0" />
    </svg>
  );
}

function BearIcon() {
  return (
    <svg viewBox="0 0 64 64" className="h-8 w-8 transition-transform duration-300 group-hover:translate-y-1 group-hover:-rotate-3 group-active:scale-90" aria-hidden="true">
      <circle cx="17" cy="18" r="9" fill="currentColor" />
      <circle cx="47" cy="18" r="9" fill="currentColor" />
      <path fill="currentColor" d="M11 35c0-15 9-25 21-25s21 10 21 25c0 13-9 22-21 22S11 48 11 35Z" />
      <circle cx="25" cy="32" r="3" fill="white" />
      <circle cx="39" cy="32" r="3" fill="white" />
      <path fill="white" d="M24 43c0-5 4-8 8-8s8 3 8 8c0 5-4 8-8 8s-8-3-8-8Z" />
      <path fill="currentColor" d="M28 41h8l-4 5-4-5Z" />
    </svg>
  );
}

export function NewsEngagement({ articleId }: NewsEngagementProps) {
  const supabase = useMemo(() => getBrowserSupabaseClient(), []);
  const [user, setUser] = useState<User | null>(null);
  const [comments, setComments] = useState<CommentRow[]>([]);
  const [reaction, setReaction] = useState<Reaction | null>(null);
  const [counts, setCounts] = useState({ bullish: 0, bearish: 0 });
  const [commentBody, setCommentBody] = useState("");
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const [deletingCommentId, setDeletingCommentId] = useState<number | null>(null);

  const loadEngagement = useCallback(async () => {
    const [{ data: authData }, { data: reactionRows }, { data: commentRows }] = await Promise.all([
      supabase.auth.getUser(),
      supabase.from("news_reactions").select("user_id,reaction").eq("article_id", articleId),
      supabase
        .from("news_comments")
        .select("id,article_id,user_id,display_name,body,created_at,updated_at")
        .eq("article_id", articleId)
        .order("created_at", { ascending: false })
        .limit(100),
    ]);

    const currentUser = authData.user ?? null;
    const rows = reactionRows ?? [];
    setUser(currentUser);
    setCounts({
      bullish: rows.filter((row) => row.reaction === "bullish").length,
      bearish: rows.filter((row) => row.reaction === "bearish").length,
    });
    setReaction((rows.find((row) => row.user_id === currentUser?.id)?.reaction as Reaction) ?? null);
    setComments((commentRows ?? []) as CommentRow[]);
  }, [articleId, supabase]);

  useEffect(() => {
    void loadEngagement();
    const { data: authListener } = supabase.auth.onAuthStateChange(() => void loadEngagement());
    return () => authListener.subscription.unsubscribe();
  }, [loadEngagement, supabase]);

  async function chooseReaction(nextReaction: Reaction) {
    if (!user) {
      redirectToLogin();
      return;
    }

    setBusy(true);
    setMessage("");
    const result = reaction === nextReaction
      ? await supabase.from("news_reactions").delete().eq("article_id", articleId).eq("user_id", user.id)
      : await supabase.from("news_reactions").upsert(
          {
            article_id: articleId,
            user_id: user.id,
            reaction: nextReaction,
            updated_at: new Date().toISOString(),
          },
          { onConflict: "article_id,user_id" },
        );

    if (result.error) setMessage("Your reaction could not be saved. Please try again.");
    await loadEngagement();
    setBusy(false);
  }

  async function submitComment(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!user) {
      redirectToLogin();
      return;
    }

    const body = commentBody.trim();
    if (!body) return;
    setBusy(true);
    setMessage("");
    const { error } = await supabase.from("news_comments").insert({
      article_id: articleId,
      user_id: user.id,
      display_name: displayNameFor(user),
      body,
    });

    if (error) {
      setMessage("Your comment could not be posted. Please try again.");
    } else {
      setCommentBody("");
      await loadEngagement();
    }
    setBusy(false);
  }

  async function deleteComment(commentId: number) {
    if (!user) {
      redirectToLogin();
      return;
    }

    if (!window.confirm("Delete this comment? This cannot be undone.")) return;

    setDeletingCommentId(commentId);
    setMessage("");
    const { error } = await supabase
      .from("news_comments")
      .delete()
      .eq("id", commentId)
      .eq("user_id", user.id);

    if (error) {
      setMessage("Your comment could not be deleted. Please try again.");
    } else {
      setComments((current) => current.filter((comment) => comment.id !== commentId));
    }
    setDeletingCommentId(null);
  }

  return (
    <section className="mt-8 border-t border-slate-200 pt-6" aria-label="Article reactions and comments">
      <h3 className="text-sm font-extrabold uppercase tracking-[0.16em] text-slate-500">Market sentiment</h3>
      <div className="mt-3 grid grid-cols-2 gap-3">
        <button
          type="button"
          disabled={busy}
          onClick={() => void chooseReaction("bullish")}
          className={`group flex items-center justify-center gap-3 rounded-2xl border px-3 py-3 font-bold transition hover:-translate-y-0.5 ${reaction === "bullish" ? "border-emerald-500 bg-emerald-100 text-emerald-800 shadow-md" : "border-emerald-200 bg-emerald-50 text-emerald-700 hover:bg-emerald-100"}`}
        >
          <BullIcon />
          <span>Bullish <span className="tabular-nums">{counts.bullish}</span></span>
        </button>
        <button
          type="button"
          disabled={busy}
          onClick={() => void chooseReaction("bearish")}
          className={`group flex items-center justify-center gap-3 rounded-2xl border px-3 py-3 font-bold transition hover:-translate-y-0.5 ${reaction === "bearish" ? "border-rose-500 bg-rose-100 text-rose-800 shadow-md" : "border-rose-200 bg-rose-50 text-rose-700 hover:bg-rose-100"}`}
        >
          <BearIcon />
          <span>Bearish <span className="tabular-nums">{counts.bearish}</span></span>
        </button>
      </div>

      <div className="mt-7">
        <h3 className="text-sm font-extrabold uppercase tracking-[0.16em] text-slate-500">Comments</h3>
        <form className="mt-3" onSubmit={submitComment}>
          <textarea
            value={commentBody}
            onChange={(event) => setCommentBody(event.target.value.slice(0, 1000))}
            onFocus={() => { if (!user) redirectToLogin(); }}
            placeholder={user ? "Share your market take…" : "Sign in to comment…"}
            className="min-h-24 w-full resize-y rounded-2xl border border-slate-300 bg-white p-3 text-sm text-slate-800 outline-none transition focus:border-indigo-500 focus:ring-2 focus:ring-indigo-100"
          />
          <div className="mt-2 flex items-center justify-between gap-3">
            <span className="text-xs text-slate-400">{commentBody.length}/1000</span>
            <button type="submit" disabled={busy || !commentBody.trim()} className="rounded-xl bg-slate-900 px-4 py-2 text-sm font-bold text-white transition hover:bg-slate-700 disabled:cursor-not-allowed disabled:opacity-50">
              Post comment
            </button>
          </div>
        </form>
        {message ? <p className="mt-2 text-sm font-medium text-rose-600">{message}</p> : null}

        <div className="mt-5 space-y-3">
          {comments.length === 0 ? (
            <p className="rounded-xl bg-slate-50 p-4 text-sm text-slate-500">No comments yet. Start the conversation.</p>
          ) : comments.map((comment) => (
            <article key={comment.id} className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
              <div className="flex items-center justify-between gap-3">
                <strong className="text-sm text-slate-800">{comment.display_name}</strong>
                <div className="flex items-center gap-2">
                  <time className="text-xs text-slate-400">{new Date(comment.created_at).toLocaleDateString()}</time>
                  {comment.user_id === user?.id ? (
                    <button
                      type="button"
                      onClick={() => void deleteComment(comment.id)}
                      disabled={deletingCommentId === comment.id}
                      aria-label="Delete your comment"
                      title="Delete comment"
                      className="inline-flex h-6 w-6 items-center justify-center rounded-full text-lg leading-none text-slate-400 transition hover:bg-rose-100 hover:text-rose-600 focus:outline-none focus:ring-2 focus:ring-rose-400 disabled:cursor-wait disabled:opacity-50"
                    >
                      <span aria-hidden="true">×</span>
                    </button>
                  ) : null}
                </div>
              </div>
              <p className="mt-2 whitespace-pre-wrap break-words text-sm leading-6 text-slate-700">{comment.body}</p>
            </article>
          ))}
        </div>
      </div>
    </section>
  );
}
