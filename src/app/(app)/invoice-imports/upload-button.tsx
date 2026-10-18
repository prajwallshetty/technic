"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Upload } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

const ACCEPT = ".pdf,.zip,.png,.jpg,.jpeg,.tif,.tiff,application/pdf,application/zip,image/*";

export function UploadInvoicesButton() {
  const router = useRouter();
  const inputRef = useRef<HTMLInputElement>(null);
  const [open, setOpen] = useState(false);
  const [files, setFiles] = useState<File[]>([]);
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);

  const totalMb = files.reduce((n, f) => n + f.size, 0) / 1048576;

  async function submit() {
    if (files.length === 0) {
      toast.error("Choose at least one file");
      return;
    }
    setBusy(true);
    try {
      const form = new FormData();
      for (const file of files) form.append("files", file);
      if (name.trim()) form.append("name", name.trim());
      const response = await fetch("/api/invoice-imports/upload", { method: "POST", body: form });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error ?? "Upload failed");
      const skipped = body.skipped?.length ? `, ${body.skipped.length} skipped` : "";
      const dupes = body.duplicates ? `, ${body.duplicates} already imported` : "";
      toast.success(`${body.queued} document(s) queued${dupes}${skipped}`);
      setOpen(false);
      setFiles([]);
      setName("");
      router.push(`/invoice-imports/${body.batchId}`);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Upload failed");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={(next) => !busy && setOpen(next)}>
      <DialogTrigger asChild>
        <Button>
          <Upload className="size-4" /> Upload invoices
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Upload invoices</DialogTitle>
          <DialogDescription>
            PDF, PNG, JPEG or TIFF files, or ZIP archives of them (nested archives are opened too). Identical files are imported once.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="import-files">Files</Label>
            <Input
              id="import-files"
              ref={inputRef}
              type="file"
              multiple
              accept={ACCEPT}
              onChange={(event) => setFiles(Array.from(event.target.files ?? []))}
            />
            {files.length ? (
              <p className="text-xs text-muted-foreground">
                {files.length} file(s), {totalMb.toFixed(1)} MB
              </p>
            ) : null}
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="import-name">Label (optional)</Label>
            <Input id="import-name" value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. April supplier bills" />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => setOpen(false)} disabled={busy}>
            Cancel
          </Button>
          <Button onClick={submit} loading={busy} disabled={busy || files.length === 0}>
            Upload and extract
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
