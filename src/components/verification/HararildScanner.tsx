import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Html5Qrcode, Html5QrcodeSupportedFormats } from "html5-qrcode";
import { motion, AnimatePresence } from "framer-motion";
import {
  Camera,
  Upload,
  CheckCircle2,
  XCircle,
  RefreshCw,
  Wifi,
  AlertTriangle,
} from "lucide-react";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Separator } from "@/components/ui/separator";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  verifyCredentialToken,
  type HarariQRVerificationPayload,
} from "@/utils/harariCredentialCrypto";
import { supabase } from "@/integrations/supabase/client";
import { cn } from "@/lib/utils";

type Mode = "camera" | "upload";

type VerifyResult = {
  valid: boolean;
  expired: boolean;
  error: string | null;
  payload: HarariQRVerificationPayload | null;
};

const SCANNER_ELEMENT_ID = "harari-qr-scanner-region";

function daysUntil(dateStr: string): number | null {
  const d = new Date(dateStr);
  if (isNaN(d.getTime())) return null;
  return Math.floor((d.getTime() - Date.now()) / (1000 * 60 * 60 * 24));
}

function humanizeError(err: string | null): { am: string; en: string } {
  if (!err) return { am: "ያልታወቀ ስህተት", en: "Unknown error" };
  if (/malformed/i.test(err))
    return { am: "የተበላሸ ቶከን", en: "Malformed token" };
  if (/signature/i.test(err))
    return { am: "ልክ ያልሆነ ፊርማ", en: "Invalid signature" };
  if (/json/i.test(err))
    return { am: "ልክ ያልሆነ ይዘት", en: "Invalid payload contents" };
  return { am: err, en: err };
}

export function HararildScanner() {
  const [mode, setMode] = useState<Mode>("camera");
  const [scanning, setScanning] = useState(false);
  const [cameraError, setCameraError] = useState<string | null>(null);
  const [decodeError, setDecodeError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<VerifyResult | null>(null);
  const [dragOver, setDragOver] = useState(false);
  const [online, setOnline] = useState(
    typeof navigator !== "undefined" ? navigator.onLine : true,
  );
  const [liveStatus, setLiveStatus] = useState<string | null>(null);
  // Fetched from storage after a live check, not carried in the QR.
  const [photoUrl, setPhotoUrl] = useState<string | null>(null);
  const [liveStatusLoading, setLiveStatusLoading] = useState(false);
  const [liveStatusError, setLiveStatusError] = useState<string | null>(null);

  const html5Ref = useRef<Html5Qrcode | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  const stopCamera = useCallback(async () => {
    const inst = html5Ref.current;
    if (!inst) return;
    try {
      // Only stop if actively scanning
      // getState: 2 = SCANNING
      // Not all versions expose typed states, so guard with try
      await inst.stop();
    } catch {
      // ignore
    }
    try {
      await inst.clear();
    } catch {
      // ignore
    }
    html5Ref.current = null;
    setScanning(false);
  }, []);

  const runVerification = useCallback(async (rawText: string) => {
    setBusy(true);
    setLiveStatus(null);
    setLiveStatusError(null);
    try {
      const r = await verifyCredentialToken(rawText);
      setResult({
        valid: r.valid,
        expired: r.expired,
        error: r.error,
        payload: r.payload,
      });
    } catch (e) {
      setResult({
        valid: false,
        expired: false,
        error: (e as Error).message,
        payload: null,
      });
    } finally {
      setBusy(false);
    }
  }, []);

  const startCamera = useCallback(async () => {
    setCameraError(null);
    setDecodeError(null);
    if (html5Ref.current) return;
    try {
      const inst = new Html5Qrcode(SCANNER_ELEMENT_ID, {
        verbose: false,
        formatsToSupport: [Html5QrcodeSupportedFormats.QR_CODE],
      });
      html5Ref.current = inst;
      await inst.start(
        { facingMode: "environment" },
        {
          fps: 10,
          qrbox: (viewfinderWidth, viewfinderHeight) => {
            const min = Math.min(viewfinderWidth, viewfinderHeight);
            const size = Math.floor(min * 0.7);
            return { width: size, height: size };
          },
          aspectRatio: 1.0,
        },
        async (decodedText) => {
          await stopCamera();
          await runVerification(decodedText);
        },
        () => {
          // per-frame decode failure – ignore
        },
      );
      setScanning(true);
    } catch (e) {
      html5Ref.current = null;
      setScanning(false);
      const msg = (e as Error).message || String(e);
      setCameraError(
        /permission|denied|NotAllowed/i.test(msg)
          ? "የካሜራ ፈቃድ ተከልክሏል / Camera permission denied"
          : msg,
      );
    }
  }, [runVerification, stopCamera]);

  // Camera lifecycle bound to mode
  useEffect(() => {
    if (mode === "camera" && !result) {
      void startCamera();
    } else {
      void stopCamera();
    }
    return () => {
      void stopCamera();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mode, result]);

  // Online status listener
  useEffect(() => {
    const on = () => setOnline(true);
    const off = () => setOnline(false);
    window.addEventListener("online", on);
    window.addEventListener("offline", off);
    return () => {
      window.removeEventListener("online", on);
      window.removeEventListener("offline", off);
    };
  }, []);

  const handleModeChange = useCallback(
    async (next: string) => {
      if (next !== "camera" && next !== "upload") return;
      // Immediately stop camera before switching tabs
      await stopCamera();
      setMode(next);
      setCameraError(null);
      setDecodeError(null);
    },
    [stopCamera],
  );

  const handleFile = useCallback(
    async (file: File) => {
      setDecodeError(null);
      setBusy(true);
      try {
        const scanner = new Html5Qrcode(SCANNER_ELEMENT_ID, {
          verbose: false,
          formatsToSupport: [Html5QrcodeSupportedFormats.QR_CODE],
        });
        try {
          const text = await scanner.scanFile(file, false);
          await runVerification(text);
        } finally {
          try {
            await scanner.clear();
          } catch {
            /* ignore */
          }
        }
      } catch (e) {
        const msg = (e as Error).message || String(e);
        setDecodeError(
          /no.*qr|not.*found|could not/i.test(msg)
            ? "በዚህ ምስል ላይ ምንም QR ኮድ አልተገኘም / No QR code detected in this image"
            : msg,
        );
      } finally {
        setBusy(false);
      }
    },
    [runVerification],
  );

  const onDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      setDragOver(false);
      const file = e.dataTransfer.files?.[0];
      if (file) void handleFile(file);
    },
    [handleFile],
  );

  const resetAll = useCallback(async () => {
    await stopCamera();
    setResult(null);
    setDecodeError(null);
    setCameraError(null);
    setLiveStatus(null);
    setLiveStatusError(null);
    if (mode === "camera") {
      // effect will restart camera when result cleared
    }
  }, [mode, stopCamera]);

  const checkLiveStatus = useCallback(async () => {
    if (!result?.payload?.credentialNumber) return;
    setLiveStatusLoading(true);
    setLiveStatusError(null);
    setLiveStatus(null);
    setPhotoUrl(null);
    try {
      // The signature proves the data is genuine; only the registry knows
      // whether the card is still valid. The same call returns the resident's
      // photo when the caller is active staff — the card's QR no longer carries
      // one, because an embedded photo made the printed code too dense to scan.
      const { data, error } = await supabase.rpc("verify_credential_token", {
        _credential_digits: result.payload.credentialNumber,
      });
      if (error) throw error;
      const row = Array.isArray(data) ? data[0] : data;
      if (!row) {
        setLiveStatusError("Credential not found in registry");
        return;
      }
      setLiveStatus(String(row.status));
      if (row.photo_path) {
        const { data: signed } = await supabase.storage
          .from("resident-photos")
          .createSignedUrl(row.photo_path, 600);
        setPhotoUrl(signed?.signedUrl ?? null);
      }
    } catch (e) {
      setLiveStatusError((e as Error).message);
    } finally {
      setLiveStatusLoading(false);
    }
  }, [result]);

  const expiryBadge = useMemo(() => {
    if (!result?.payload?.expiryDate) return null;
    const d = daysUntil(result.payload.expiryDate);
    if (d === null) return null;
    if (d < 0)
      return (
        <Badge variant="destructive">
          የአገልግሎት ጊዜው ያበቃ / Expired
        </Badge>
      );
    if (d <= 30)
      return (
        <Badge className="bg-amber-500 text-white hover:bg-amber-500">
          የአገልግሎት ጊዜው በቅርቡ ያበቃል / Expiring Soon
        </Badge>
      );
    return null;
  }, [result]);

  const isVerifiedOk = result && result.valid && !result.expired;
  const humanErr = humanizeError(result?.error ?? null);

  return (
    <Card className="border-slate-200">
      <CardHeader className="border-b border-slate-100">
        <Tabs value={mode} onValueChange={handleModeChange}>
          <TabsList className="grid w-full grid-cols-2">
            <TabsTrigger value="camera" className="gap-2">
              <Camera className="h-4 w-4" /> ካሜራ / Camera
            </TabsTrigger>
            <TabsTrigger value="upload" className="gap-2">
              <Upload className="h-4 w-4" /> ምስል ስቀል / Upload Image
            </TabsTrigger>
          </TabsList>
        </Tabs>
      </CardHeader>

      <CardContent className="space-y-4 pt-6">
        {!result && (
          <>
            {mode === "camera" && (
              <div className="space-y-3">
                <div className="relative mx-auto aspect-square w-full max-w-md overflow-hidden rounded-xl border border-slate-200 bg-black">
                  <div id={SCANNER_ELEMENT_ID} className="h-full w-full" />
                  {/* Framing overlay */}
                  <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
                    <div className="relative h-[70%] w-[70%] rounded-lg">
                      <span className="absolute -left-1 -top-1 h-8 w-8 rounded-tl-lg border-l-4 border-t-4 border-emerald-400" />
                      <span className="absolute -right-1 -top-1 h-8 w-8 rounded-tr-lg border-r-4 border-t-4 border-emerald-400" />
                      <span className="absolute -bottom-1 -left-1 h-8 w-8 rounded-bl-lg border-b-4 border-l-4 border-emerald-400" />
                      <span className="absolute -bottom-1 -right-1 h-8 w-8 rounded-br-lg border-b-4 border-r-4 border-emerald-400" />
                    </div>
                  </div>
                  {!scanning && !cameraError && (
                    <div className="absolute inset-0 flex items-center justify-center">
                      <Skeleton className="h-full w-full" />
                    </div>
                  )}
                </div>
                {cameraError && (
                  <Alert variant="destructive">
                    <AlertTriangle className="h-4 w-4" />
                    <AlertDescription>
                      {cameraError}. እባክዎ ወደ <b>ምስል ስቀል / Upload Image</b>{" "}
                      ትር ይሂዱ።
                    </AlertDescription>
                  </Alert>
                )}
                <p className="text-center text-xs text-slate-500">
                  የQR ኮዱን በአረንጓዴ ማዕቀፍ ውስጥ ያድርጉ / Align the QR code inside
                  the green frame
                </p>
              </div>
            )}

            {mode === "upload" && (
              <div className="space-y-3">
                <div
                  onDragOver={(e) => {
                    e.preventDefault();
                    setDragOver(true);
                  }}
                  onDragLeave={() => setDragOver(false)}
                  onDrop={onDrop}
                  onClick={() => fileInputRef.current?.click()}
                  className={cn(
                    "flex cursor-pointer flex-col items-center justify-center gap-2 rounded-xl border-2 border-dashed p-10 text-center transition",
                    dragOver
                      ? "border-blue-500 bg-blue-50"
                      : "border-slate-300 bg-slate-50 hover:bg-slate-100",
                  )}
                >
                  <Upload className="h-8 w-8 text-slate-400" />
                  <div className="font-noto-ethiopic text-sm text-slate-700">
                    ምስል እዚህ ይጣሉ ወይም ጠቅ ያድርጉ
                  </div>
                  <div className="text-xs text-slate-500">
                    Drag &amp; drop, or click to upload · PNG / JPEG
                  </div>
                  <input
                    ref={fileInputRef}
                    type="file"
                    accept="image/png,image/jpeg"
                    className="hidden"
                    onChange={(e) => {
                      const f = e.target.files?.[0];
                      if (f) void handleFile(f);
                      e.target.value = "";
                    }}
                  />
                  {/* Off-screen mount point required by Html5Qrcode.scanFile */}
                  <div id={SCANNER_ELEMENT_ID} className="hidden" />
                </div>
                {decodeError && (
                  <Alert variant="destructive">
                    <AlertTriangle className="h-4 w-4" />
                    <AlertDescription>{decodeError}</AlertDescription>
                  </Alert>
                )}
              </div>
            )}

            {busy && (
              <div className="flex items-center justify-center gap-2 text-sm text-slate-600">
                <RefreshCw className="h-4 w-4 animate-spin" />
                በማረጋገጥ ላይ… / Verifying…
              </div>
            )}
          </>
        )}

        <AnimatePresence>
          {result && (
            <motion.div
              initial={{ y: 24, opacity: 0 }}
              animate={{ y: 0, opacity: 1 }}
              exit={{ y: 24, opacity: 0 }}
              transition={{ duration: 0.35, ease: "easeOut" }}
              className="space-y-4"
            >
              {isVerifiedOk ? (
                <SuccessPanel
                  payload={result.payload!}
                  expiryBadge={expiryBadge}
                  liveStatus={liveStatus}
                  liveStatusLoading={liveStatusLoading}
                  liveStatusError={liveStatusError}
                  onCheckLive={checkLiveStatus}
                  photoUrl={photoUrl}
                  online={online}
                />
              ) : (
                <FailurePanel
                  expired={!!result.expired}
                  amMsg={humanErr.am}
                  enMsg={humanErr.en}
                />
              )}

              <div className="flex justify-center">
                <Button onClick={resetAll} variant="outline" className="gap-2">
                  <RefreshCw className="h-4 w-4" />
                  <span className="font-noto-ethiopic">አዲስ ቅኝት</span>
                  <span className="opacity-70">/ New Scan</span>
                </Button>
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </CardContent>
    </Card>
  );
}

function SuccessPanel({
  payload,
  expiryBadge,
  liveStatus,
  liveStatusLoading,
  liveStatusError,
  onCheckLive,
  online,
  photoUrl,
}: {
  payload: HarariQRVerificationPayload;
  expiryBadge: React.ReactNode;
  liveStatus: string | null;
  liveStatusLoading: boolean;
  liveStatusError: string | null;
  onCheckLive: () => void;
  online: boolean;
  photoUrl: string | null;
}) {
  const rows: Array<{ label: string; value: string }> = [
    { label: "ID Number", value: payload.idNumber },
    { label: "Full Name", value: payload.fullNameEnglish },
    { label: "Gender", value: payload.gender },
    { label: "Date of Birth", value: payload.dobGregorian },
    { label: "Woreda", value: payload.woreda },
    { label: "Kebele", value: payload.kebele },
    { label: "House No.", value: payload.houseNumber },
    { label: "Issue Date", value: payload.issueDate },
    { label: "Expiry Date", value: payload.expiryDate },
    { label: "Place of Issue", value: payload.placeOfIssue },
    { label: "Credential #", value: payload.credentialNumber },
  ];

  const liveNotActive =
    liveStatus !== null && liveStatus !== "active";

  return (
    <div className="rounded-xl border border-emerald-200 bg-emerald-50/40 p-4">
      <div className="flex flex-wrap items-center gap-2">
        <Badge className="gap-1 bg-emerald-600 text-white hover:bg-emerald-600">
          <CheckCircle2 className="h-3.5 w-3.5" />
          <span className="font-noto-ethiopic">የተረጋገጠ ትክክለኛ መታወቂያ</span>
          <span className="opacity-90">/ Verified</span>
        </Badge>
        {expiryBadge}
        {liveStatus && (
          <Badge
            className={cn(
              liveStatus === "active"
                ? "bg-emerald-600 text-white hover:bg-emerald-600"
                : "bg-red-600 text-white hover:bg-red-600",
            )}
          >
            Live: {liveStatus}
          </Badge>
        )}
      </div>

      {liveNotActive && (
        <Alert variant="destructive" className="mt-3">
          <AlertTriangle className="h-4 w-4" />
          <AlertDescription>
            <span className="font-noto-ethiopic">
              ይህ መታወቂያ {liveStatus === "revoked" ? "ተሰርዟል" : "ትክክል አይደለም"}
            </span>{" "}
            / This credential is {liveStatus}.
          </AlertDescription>
        </Alert>
      )}

      <Separator className="my-4" />

      <div className="grid gap-4 md:grid-cols-[160px_1fr]">
        <div className="flex flex-col items-center">
          {photoUrl ? (
            <img
              src={photoUrl}
              alt="Resident"
              className="h-40 w-40 rounded-lg border border-slate-200 object-cover"
            />
          ) : (
            <div className="flex h-40 w-40 flex-col items-center justify-center gap-1 rounded-lg border border-slate-200 bg-slate-100 px-2 text-center text-xs text-slate-500">
              {online ? (
                <>
                  <span className="font-noto-ethiopic">ፎቶ ለማየት</span>
                  <span>Check live status to load the photo</span>
                </>
              ) : (
                <>
                  <span className="font-noto-ethiopic">ከመስመር ውጭ</span>
                  <span>Offline — photo unavailable</span>
                </>
              )}
            </div>
          )}
        </div>

        <ScrollArea className="max-h-72">
          <div className="grid grid-cols-1 gap-x-6 gap-y-2 sm:grid-cols-2">
            {rows.map((r) => (
              <div key={r.label} className="text-sm">
                <div className="text-xs uppercase tracking-wide text-slate-500">
                  {r.label}
                </div>
                <div className="font-medium text-slate-900 break-words">
                  {r.value || "—"}
                </div>
              </div>
            ))}
          </div>
        </ScrollArea>
      </div>

      {online && (
        <div className="mt-4 flex justify-end">
          <Button
            size="sm"
            variant="secondary"
            onClick={onCheckLive}
            disabled={liveStatusLoading}
            className="gap-2"
          >
            <Wifi className="h-4 w-4" />
            {liveStatusLoading ? (
              <span>Checking…</span>
            ) : (
              <>
                <span className="font-noto-ethiopic">የቀጥታ ሁኔታ ይፈትሹ</span>
                <span className="opacity-70">/ Check Live Status</span>
              </>
            )}
          </Button>
        </div>
      )}
      {liveStatusError && (
        <p className="mt-2 text-right text-xs text-red-600">
          {liveStatusError}
        </p>
      )}
    </div>
  );
}

function FailurePanel({
  expired,
  amMsg,
  enMsg,
}: {
  expired: boolean;
  amMsg: string;
  enMsg: string;
}) {
  return (
    <div className="rounded-xl border border-red-200 bg-red-50/40 p-4">
      <div className="flex items-center gap-2">
        <Badge variant="destructive" className="gap-1">
          <XCircle className="h-3.5 w-3.5" />
          <span className="font-noto-ethiopic">አልተረጋገጠም</span>
          <span className="opacity-90">/ Not Verified</span>
        </Badge>
      </div>
      <Alert variant="destructive" className="mt-3">
        <AlertTriangle className="h-4 w-4" />
        <AlertDescription>
          {expired ? (
            <>
              <span className="font-noto-ethiopic">
                የአገልግሎት ጊዜው ያበቃ
              </span>{" "}
              / The credential has expired.
            </>
          ) : (
            <>
              <span className="font-noto-ethiopic">{amMsg}</span> / {enMsg}
            </>
          )}
        </AlertDescription>
      </Alert>
    </div>
  );
}
