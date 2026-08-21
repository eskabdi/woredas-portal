import { useState } from "react";
import { Document, Page } from "react-pdf";
import { ChevronLeft, ChevronRight, ExternalLink, Loader2 } from "lucide-react";
import "@/lib/pdfWorker";
import "react-pdf/dist/Page/AnnotationLayer.css";
import "react-pdf/dist/Page/TextLayer.css";

import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";

/**
 * Renders a single PDF page at the given width, with its own internal page
 * counter. Split out from DocumentViewerDialog so a live form preview (the
 * resident clearance-letter step) can embed the same rendering without the
 * Dialog chrome.
 */
export function PdfPageView({ file, width = 640 }: { file: string; width?: number }) {
  const [numPages, setNumPages] = useState<number | null>(null);
  const [pageNumber, setPageNumber] = useState(1);

  return (
    <div className="space-y-2">
      <div className="flex justify-center overflow-auto rounded-md border border-slate-200 bg-slate-50">
        <Document
          file={file}
          onLoadSuccess={({ numPages: n }) => {
            setNumPages(n);
            setPageNumber(1);
          }}
          loading={
            <div className="flex h-64 w-full items-center justify-center">
              <Loader2 className="h-6 w-6 animate-spin text-slate-400" />
            </div>
          }
          error={
            <div className="flex h-64 w-full items-center justify-center px-4 text-center text-sm text-slate-500">
              <span className="font-noto-ethiopic">ፋይሉ ሊታይ አልቻለም</span>
              <span className="ml-1">/ Couldn&apos;t render this file</span>
            </div>
          }
        >
          <Page pageNumber={pageNumber} width={width} />
        </Document>
      </div>
      {numPages !== null && numPages > 1 && (
        <div className="flex items-center justify-center gap-3 text-sm text-slate-600">
          <Button
            type="button"
            variant="outline"
            size="icon"
            className="h-7 w-7"
            disabled={pageNumber <= 1}
            onClick={() => setPageNumber((p) => Math.max(1, p - 1))}
          >
            <ChevronLeft className="h-4 w-4" />
          </Button>
          <span>
            {pageNumber} / {numPages}
          </span>
          <Button
            type="button"
            variant="outline"
            size="icon"
            className="h-7 w-7"
            disabled={pageNumber >= numPages}
            onClick={() => setPageNumber((p) => Math.min(numPages, p + 1))}
          >
            <ChevronRight className="h-4 w-4" />
          </Button>
        </div>
      )}
    </div>
  );
}

interface DocumentViewerDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  signedUrl: string | null;
  title: string;
}

/**
 * In-app PDF viewer, opened from a signed URL the caller already fetched
 * on click (this never calls createSignedUrl itself, matching the
 * on-demand -- not eager/prefetched -- pattern every "open document"
 * affordance in this app already uses).
 *
 * Only ever opened for PDFs -- callers branch on content type themselves
 * and fall back to window.open for anything else, so this component
 * doesn't need an image-rendering mode.
 */
export default function DocumentViewerDialog({
  open,
  onOpenChange,
  signedUrl,
  title,
}: DocumentViewerDialogProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="flex max-h-[90vh] max-w-4xl flex-col">
        <DialogHeader>
          <DialogTitle className="flex items-center justify-between gap-4 pr-6">
            <span className="font-noto-ethiopic truncate text-sm font-medium">{title}</span>
            {signedUrl && (
              <a
                href={signedUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="flex shrink-0 items-center gap-1 text-xs font-normal text-blue-700 hover:underline"
              >
                <ExternalLink className="h-3.5 w-3.5" />
                <span className="font-noto-ethiopic">በአዲስ ትር ክፈት</span>
                <span className="opacity-70">/ Open in new tab</span>
              </a>
            )}
          </DialogTitle>
        </DialogHeader>
        <div className="min-h-0 flex-1 overflow-auto">
          {signedUrl ? (
            <PdfPageView file={signedUrl} width={720} />
          ) : (
            <div className="flex h-64 items-center justify-center">
              <Loader2 className="h-6 w-6 animate-spin text-slate-400" />
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
