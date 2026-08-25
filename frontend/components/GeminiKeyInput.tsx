"use client";

import { useEffect, useState } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { getApiKey, setApiKey } from "@/lib/apiKeyStore";
import { KeyRound, Lock, Radar, MessageSquare, Compass } from "lucide-react";

const USES = [
  { icon: Radar, label: "Resume matching" },
  { icon: MessageSquare, label: "AI assistant" },
  { icon: Compass, label: "Roadmaps & interviews" },
];

export function GeminiKeyInput({ onKeySet }: { onKeySet?: (key: string) => void }) {
  const [open, setOpen] = useState(false);
  const [value, setValue] = useState("");
  const [hasKey, setHasKey] = useState(false);

  useEffect(() => {
    setHasKey(!!getApiKey());
  }, []);

  function save() {
    if (!value.trim()) return;
    setApiKey(value.trim());
    setHasKey(true);
    onKeySet?.(value.trim());
    setOpen(false);
    setValue("");
  }

  return (
    <>
      <Button variant={hasKey ? "outline" : "default"} size="sm" onClick={() => setOpen(true)}>
        <KeyRound className="h-4 w-4 mr-1" />
        {hasKey ? "API Key Set" : "Set Gemini API Key"}
      </Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Your Gemini API Key</DialogTitle>
            <DialogDescription className="flex items-center gap-1.5">
              <Lock className="h-3.5 w-3.5 shrink-0" />
              Stays in your browser, never touches our servers.
            </DialogDescription>
          </DialogHeader>
          <div className="flex flex-wrap gap-2">
            {USES.map(({ icon: Icon, label }) => (
              <span
                key={label}
                className="inline-flex items-center gap-1.5 rounded-full bg-secondary px-2.5 py-1 text-xs font-medium text-secondary-foreground"
              >
                <Icon className="h-3 w-3" />
                {label}
              </span>
            ))}
          </div>
          <p className="text-xs text-muted-foreground">
            Get a free key at{" "}
            <a
              href="https://aistudio.google.com/apikey"
              target="_blank"
              rel="noopener noreferrer"
              className="underline"
            >
              aistudio.google.com/apikey
            </a>
            .
          </p>
          <div className="space-y-2">
            <Label htmlFor="gemini-key">API Key</Label>
            <Input
              id="gemini-key"
              type="password"
              placeholder="AIza..."
              value={value}
              onChange={(e) => setValue(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && save()}
            />
          </div>
          <Button onClick={save} disabled={!value.trim()}>
            Save Key
          </Button>
        </DialogContent>
      </Dialog>
    </>
  );
}
