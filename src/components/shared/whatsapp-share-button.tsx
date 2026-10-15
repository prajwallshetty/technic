"use client";

import { useState } from "react";
import { MessageCircle, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";

interface WhatsAppShareButtonProps {
  documentId: string;
  documentType: "invoice" | "quotation" | "purchase-order" | "purchase-bill" | "purchase-return" | "receipt" | "expense";
  documentNumber: string;
  customerPhone?: string;
  size?: "default" | "sm" | "lg" | "icon";
  variant?: "outline" | "default" | "secondary";
}

export function WhatsAppShareButton({
  documentId,
  documentType,
  documentNumber,
  customerPhone,
  size = "default",
  variant = "outline",
}: WhatsAppShareButtonProps) {
  const [loading, setLoading] = useState(false);

  const handleShare = async () => {
    setLoading(true);
    try {
      const pdfEndpoint = `/api/documents/${documentType}/${documentId}`;
      const response = await fetch(pdfEndpoint);

      if (!response.ok) {
        throw new Error("Failed to generate document PDF");
      }

      const blob = await response.blob();
      const sanitizedDocNum = documentNumber.replace(/[^a-zA-Z0-9_-]/g, "_");
      const fileName = `${documentType}_${sanitizedDocNum}.pdf`;
      const pdfFile = new File([blob], fileName, { type: "application/pdf" });

      const baseUrl = typeof window !== "undefined" ? window.location.origin : "";
      const directPdfUrl = `${baseUrl}${pdfEndpoint}`;
      const cleanPhone = customerPhone ? customerPhone.replace(/[^0-9]/g, "") : "";

      const label = documentType.replace("-", " ").toUpperCase();
      const messageText = `Please find attached ${label} ${documentNumber} from Technic Technologies.\n\nDirect PDF Document Link:\n${directPdfUrl}`;

      // 1. Try Web Share API (native file sharing to WhatsApp on mobile & supported browsers)
      if (typeof navigator !== "undefined" && navigator.canShare && navigator.canShare({ files: [pdfFile] })) {
        try {
          await navigator.share({
            title: `${label} ${documentNumber}`,
            text: messageText,
            files: [pdfFile],
          });
          toast.success("PDF document shared via WhatsApp");
          return;
        } catch (shareErr) {
          // If user manually cancels the native share sheet, return silently
          if ((shareErr as Error).name === "AbortError") return;
        }
      }

      // 2. Fallback for Desktop / browsers without native file share:
      // Download the PDF file locally so user can attach it, and open WhatsApp with pre-filled message & direct PDF link
      const blobUrl = URL.createObjectURL(blob);
      const downloadLink = document.createElement("a");
      downloadLink.href = blobUrl;
      downloadLink.download = fileName;
      document.body.appendChild(downloadLink);
      downloadLink.click();
      document.body.removeChild(downloadLink);
      setTimeout(() => URL.revokeObjectURL(blobUrl), 10000);

      const waUrl = cleanPhone
        ? `https://wa.me/${cleanPhone}?text=${encodeURIComponent(messageText)}`
        : `https://wa.me/?text=${encodeURIComponent(messageText)}`;

      window.open(waUrl, "_blank");
      toast.success("PDF downloaded! WhatsApp opened — attach the downloaded PDF file into your chat.");
    } catch (err) {
      console.error("WhatsApp share error:", err);
      toast.error("Failed to prepare PDF for WhatsApp sharing");
    } finally {
      setLoading(false);
    }
  };

  return (
    <Button variant={variant} size={size} onClick={handleShare} disabled={loading} className="gap-1.5">
      {loading ? (
        <Loader2 className="h-4 w-4 animate-spin text-emerald-600" />
      ) : (
        <MessageCircle className="h-4 w-4 text-emerald-600 fill-emerald-600/10" />
      )}
      <span>{loading ? "Generating PDF..." : "WhatsApp PDF"}</span>
    </Button>
  );
}
