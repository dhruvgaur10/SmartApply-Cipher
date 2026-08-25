"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { getApiKey } from "@/lib/apiKeyStore";
import { uploadResume } from "@/lib/api";
import { toast } from "sonner";
import { Loader2, UploadCloud } from "lucide-react";

export function ResumeUploadDialog() {
  const [open, setOpen] = useState(false);
  const [file, setFile] = useState<File | null>(null);
  const [loading, setLoading] = useState(false);
  const router = useRouter();

  async function handleUpload() {
    const apiKey = getApiKey();
    if (!apiKey) {
      toast.error("Set your Gemini API key first.");
      return;
    }
    if (!file) return;

    setLoading(true);
    try {
      const result = await uploadResume(file, apiKey);
      sessionStorage.setItem("resume_results", JSON.stringify(result));
      setOpen(false);
      router.push("/resume/results");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Resume upload failed");
    } finally {
      setLoading(false);
    }
  }

  return (
    <>
      <Button onClick={() => setOpen(true)}>
        <UploadCloud className="h-4 w-4 mr-1" />
        Upload Resume
      </Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Upload Your Resume</DialogTitle>
            <DialogDescription>
              PDF only. We&apos;ll parse your skills and recommend jobs tailored to
              your profile.
            </DialogDescription>
          </DialogHeader>
          <Input type="file" accept="application/pdf" onChange={(e) => setFile(e.target.files?.[0] || null)} />
          <Button onClick={handleUpload} disabled={!file || loading}>
            {loading && <Loader2 className="h-4 w-4 mr-1 animate-spin" />}
            {loading ? "Analyzing..." : "Analyze & Match"}
          </Button>
        </DialogContent>
      </Dialog>
    </>
  );
}
