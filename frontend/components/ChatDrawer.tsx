"use client";

import { useState, useRef, useEffect } from "react";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ScrollArea } from "@/components/ui/scroll-area";
import { JobCard } from "@/components/JobCard";
import { getApiKey } from "@/lib/apiKeyStore";
import { chatUrl } from "@/lib/api";
import type { ChatEvent, Job, ComparisonResult, Roadmap, InterviewQuestion } from "@/lib/types";
import { X, Send, ArrowRight, Sparkles } from "lucide-react";
import { toast } from "sonner";

type ChatMessage =
  | { role: "user" | "assistant"; kind: "text"; content: string }
  | { role: "assistant"; kind: "job_card"; data: Job; searchQuery: string }
  | { role: "assistant"; kind: "comparison"; data: ComparisonResult }
  | { role: "assistant"; kind: "roadmap"; data: Roadmap }
  | { role: "assistant"; kind: "interview"; data: InterviewQuestion[] };

export function ChatDrawer({
  userSkills,
  jobPrompt,
}: {
  userSkills?: string[];
  /** When set, shows a one-time proactive suggestion bubble above the closed
   * button (e.g. offering to summarize the job description on a job detail
   * page) instead of auto-opening the whole drawer or auto-sending a message. */
  jobPrompt?: { jobId: string; question: string; label: string };
}) {
  const [open, setOpen] = useState(false);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [shownPromptForJob, setShownPromptForJob] = useState<string | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const sessionId = useRef(crypto.randomUUID());

  useEffect(() => {
    scrollRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  useEffect(() => {
    if (!jobPrompt || open) return;
    const seenKey = `job_dekho_chat_prompt_seen_${jobPrompt.jobId}`;
    if (sessionStorage.getItem(seenKey)) return;
    sessionStorage.setItem(seenKey, "1");
    setShownPromptForJob(jobPrompt.jobId);
  }, [jobPrompt, open]);

  async function sendMessageText(text: string) {
    const apiKey = getApiKey();
    if (!apiKey) {
      toast.error("Set your Gemini API key first.");
      return;
    }
    if (!text.trim()) return;

    setMessages((prev) => [...prev, { role: "user", kind: "text", content: text }]);
    setLoading(true);

    try {
      const res = await fetch(chatUrl(), {
        method: "POST",
        headers: { "Content-Type": "application/json", "X-Gemini-API-Key": apiKey },
        body: JSON.stringify({
          messages: [{ role: "user", content: text }],
          session_id: sessionId.current,
          user_skills: userSkills,
        }),
      });

      if (!res.ok || !res.body) {
        throw new Error(`Chat request failed: ${res.status}`);
      }

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n\n");
        buffer = lines.pop() || "";

        for (const line of lines) {
          if (!line.startsWith("data: ")) continue;
          let event: ChatEvent;
          try {
            event = JSON.parse(line.slice(6));
          } catch {
            continue;
          }
          if (event.type === "done") continue;
          if (event.type === "text") {
            setMessages((prev) => [...prev, { role: "assistant", kind: "text", content: event.content }]);
          } else if (event.type === "job_card") {
            setMessages((prev) => [
              ...prev,
              { role: "assistant", kind: "job_card", data: event.data, searchQuery: text },
            ]);
          } else if (event.type === "comparison") {
            setMessages((prev) => [...prev, { role: "assistant", kind: "comparison", data: event.data }]);
          } else if (event.type === "roadmap") {
            setMessages((prev) => [...prev, { role: "assistant", kind: "roadmap", data: event.data }]);
          } else if (event.type === "interview") {
            setMessages((prev) => [...prev, { role: "assistant", kind: "interview", data: event.data }]);
          }
        }
      }
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Chat failed");
    } finally {
      setLoading(false);
    }
  }

  function sendMessage() {
    const text = input.trim();
    if (!text) return;
    setInput("");
    sendMessageText(text);
  }

  function handlePromptClick() {
    if (!jobPrompt) return;
    setShownPromptForJob(null);
    setOpen(true);
    sendMessageText(jobPrompt.question);
  }

  const showPrompt = !!shownPromptForJob && !open;

  if (!open) {
    return (
      <div className="fixed bottom-6 right-6 z-20 flex flex-col items-end gap-2">
        {showPrompt && jobPrompt && (
          <div className="max-w-[240px] rounded-2xl rounded-br-sm bg-card border border-border shadow-lg p-3 text-sm animate-in fade-in slide-in-from-bottom-2 duration-300">
            <p>{jobPrompt.label}</p>
            <div className="flex justify-end gap-2 mt-2">
              <button
                type="button"
                onClick={() => setShownPromptForJob(null)}
                className="text-xs text-muted-foreground hover:text-foreground"
              >
                Not now
              </button>
              <button
                type="button"
                onClick={handlePromptClick}
                className="text-xs font-semibold text-primary hover:underline"
              >
                Yes, please
              </button>
            </div>
          </div>
        )}
        <Button
          className="relative rounded-full shadow-lg px-4 h-12"
          onClick={() => setOpen(true)}
        >
          {showPrompt && (
            <span className="absolute -top-1 -right-1 h-3 w-3 rounded-full bg-[var(--warn)] animate-ping" />
          )}
          <span className="flex items-center justify-center h-6 w-6 rounded-full bg-white/20 mr-2">
            <Sparkles className="h-3.5 w-3.5" />
          </span>
          Ask Smart Apply
        </Button>
      </div>
    );
  }

  return (
    <div className="fixed bottom-6 right-6 w-[380px] h-[560px] bg-card border border-border rounded-2xl shadow-xl flex flex-col z-20 animate-in fade-in slide-in-from-bottom-4 zoom-in-95 duration-200">
      <div className="flex items-center justify-between px-4 py-3 border-b border-border rounded-t-2xl bg-secondary/40">
        <div className="flex items-center gap-2">
          <span className="flex items-center justify-center h-8 w-8 rounded-full bg-primary text-primary-foreground shrink-0">
            <Sparkles className="h-4 w-4" />
          </span>
          <div>
            <p className="font-display font-semibold text-sm leading-tight">Smart Apply Assistant</p>
            <p className="text-[11px] text-muted-foreground leading-tight">Always here to help</p>
          </div>
        </div>
        <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => setOpen(false)}>
          <X className="h-4 w-4" />
        </Button>
      </div>
      <ScrollArea className="flex-1 p-3">
        <div className="space-y-3">
          {messages.length === 0 && (
            <p className="text-sm text-muted-foreground">
              Ask about jobs, your resume fit, or interview prep &mdash; try &quot;find
              python jobs in bangalore&quot; or &quot;summarize this job for me&quot;.
            </p>
          )}
          {messages.length === 0 && jobPrompt && (
            <div className="flex flex-wrap gap-1.5">
              {[
                "Is this remote-friendly?",
                "Does it mention on-call?",
                "What's the team size?",
              ].map((q) => (
                <button
                  key={q}
                  type="button"
                  onClick={() =>
                    sendMessageText(`${q} (about this job, Job ID: ${jobPrompt.jobId})`)
                  }
                  className="text-xs rounded-full border border-border bg-card px-2.5 py-1 hover:bg-muted transition-colors"
                >
                  {q}
                </button>
              ))}
            </div>
          )}
          {messages.map((m, i) => {
            const isLastOfJobCardRun =
              m.kind === "job_card" && messages[i + 1]?.kind !== "job_card";
            return (
              <div key={i} className="space-y-2">
                <ChatBubble message={m} />
                {isLastOfJobCardRun && m.kind === "job_card" && (
                  <Link
                    href={`/browse?q=${encodeURIComponent(m.searchQuery)}`}
                    className="flex items-center gap-1 text-xs font-medium text-primary hover:underline mr-8"
                  >
                    View all results in Browse <ArrowRight className="h-3 w-3" />
                  </Link>
                )}
              </div>
            );
          })}
          {loading && (
            <div className="flex items-center gap-1 bg-muted rounded-lg px-3 py-2 mr-8 w-fit">
              <span className="h-1.5 w-1.5 rounded-full bg-muted-foreground/60 animate-bounce [animation-delay:-0.3s]" />
              <span className="h-1.5 w-1.5 rounded-full bg-muted-foreground/60 animate-bounce [animation-delay:-0.15s]" />
              <span className="h-1.5 w-1.5 rounded-full bg-muted-foreground/60 animate-bounce" />
            </div>
          )}
          <div ref={scrollRef} />
        </div>
      </ScrollArea>
      <div className="p-3 border-t flex gap-2">
        <Input
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && !loading && sendMessage()}
          placeholder="Ask something..."
          disabled={loading}
        />
        <Button size="icon" onClick={sendMessage} disabled={loading}>
          <Send className="h-4 w-4" />
        </Button>
      </div>
    </div>
  );
}

function ChatBubble({ message }: { message: ChatMessage }) {
  if (message.kind === "text") {
    return (
      <div
        className={
          message.role === "user"
            ? "bg-primary text-primary-foreground rounded-lg px-3 py-2 text-sm ml-8"
            : "bg-muted rounded-lg px-3 py-2 text-sm mr-8"
        }
      >
        {message.content}
      </div>
    );
  }
  if (message.kind === "job_card") {
    return <JobCard job={message.data} compact />;
  }
  if (message.kind === "comparison") {
    const c = message.data.comparison;
    return (
      <div className="border rounded-lg p-3 text-xs space-y-1">
        <p className="font-semibold">{c.titles.job1} vs {c.titles.job2}</p>
        <p>Common skills: {c.skills.common.join(", ") || "none"}</p>
        <p>Only in job 1: {c.skills.only_in_job1.join(", ") || "none"}</p>
        <p>Only in job 2: {c.skills.only_in_job2.join(", ") || "none"}</p>
      </div>
    );
  }
  if (message.kind === "roadmap") {
    return (
      <div className="border rounded-lg p-3 text-xs space-y-2">
        <p className="font-semibold">
          7-Day Roadmap ({message.data.total_estimated_hours}h total)
        </p>
        {message.data.roadmap.map((d) => (
          <div key={d.day}>
            <span className="font-medium">Day {d.day} - {d.skill}:</span> {d.goal}
          </div>
        ))}
      </div>
    );
  }
  if (message.kind === "interview") {
    return (
      <div className="border rounded-lg p-3 text-xs space-y-2">
        <p className="font-semibold">Interview Questions</p>
        {message.data.map((q, i) => (
          <p key={i}>{i + 1}. {q.question}</p>
        ))}
      </div>
    );
  }
  return null;
}
