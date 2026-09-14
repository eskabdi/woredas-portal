import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { WifiOff, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useAuthStore } from "@/stores/authStore";
import { useOnlineStatus } from "@/hooks/useOnlineStatus";
import { useOfflineQueue } from "@/hooks/useOfflineQueue";
import { runSync } from "@/lib/offlineSync";
import { formatEthiopianDateTime } from "@/utils/ethiopianCalendar";

/**
 * Task 12-C: offline pill + queued-count + last-sync timestamp + a manual
 * "Sync now" fallback, mounted once in WoredaShell. Auto-syncs the instant
 * the app comes back online (browser event + reachability probe both
 * agreeing), sequentially, with one toast per queued item's own result --
 * never a single "sync complete" summary that could paper over a specific
 * item's rejection.
 */
export function OfflineStatusBar() {
  const woredaId = useAuthStore((s) => s.woredaId);
  const isOnline = useOnlineStatus();
  const { count } = useOfflineQueue(woredaId);
  const [syncing, setSyncing] = useState(false);
  const [lastSyncAt, setLastSyncAt] = useState<Date | null>(null);
  const wasOnline = useRef(isOnline);

  const sync = async () => {
    if (!woredaId || syncing) return;
    setSyncing(true);
    try {
      const outcome = await runSync(woredaId, (result) => {
        if (result.ok) {
          toast.success(result.message);
        } else if (result.transient) {
          toast.error(`ማመሳሰል አልተሳካም (እንደገና ይሞከራል) / Sync failed, will retry: ${result.message}`);
        } else {
          toast.error(`ተቀባይነት አላገኘም / Rejected: ${result.message}`, { duration: 10_000 });
        }
      });
      if (outcome === "no-session") {
        toast.error("ለማመሳሰል ይግቡ / Sign in to sync — your queued items are still saved");
        return;
      }
      setLastSyncAt(new Date());
    } finally {
      setSyncing(false);
    }
  };

  // Auto-sync exactly on the offline->online transition, not on every
  // render while already online -- and never while there's nothing queued.
  useEffect(() => {
    if (isOnline && !wasOnline.current && count > 0) {
      void sync();
    }
    wasOnline.current = isOnline;
    // eslint-disable-next-line react-hooks/exhaustive-deps -- sync is stable enough per woredaId; re-running on its identity would refire on every render
  }, [isOnline, count]);

  if (isOnline && count === 0) return null;

  return (
    <div
      className={`flex items-center gap-3 border-b px-4 py-1.5 text-xs ${
        isOnline
          ? "border-amber-200 bg-amber-50 text-amber-900"
          : "border-red-200 bg-red-50 text-red-900"
      }`}
    >
      {!isOnline && (
        <span className="flex items-center gap-1 font-medium">
          <WifiOff className="h-3.5 w-3.5" />
          <span className="font-noto-ethiopic">ከመስመር ውጭ ነዎት</span>
          <span className="opacity-80">/ You are offline</span>
        </span>
      )}
      {count > 0 && (
        <span className="font-noto-ethiopic">
          {count} በመጠባበቅ ላይ <span className="opacity-70">/ {count} queued</span>
        </span>
      )}
      {isOnline && count > 0 && (
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={() => void sync()}
          disabled={syncing}
          className="ml-auto h-6 gap-1 border-amber-300 bg-white px-2 text-xs font-medium hover:bg-amber-100"
        >
          <RefreshCw className={`h-3 w-3 ${syncing ? "animate-spin" : ""}`} />
          <span className="font-noto-ethiopic">አሁን አመሳስል</span>
          <span className="opacity-70">/ Sync now</span>
        </Button>
      )}
      {lastSyncAt && (
        <span className="text-slate-500">
          የመጨረሻ ማመሳሰል <span className="opacity-70">/ Last sync:</span>{" "}
          {formatEthiopianDateTime(lastSyncAt)}
        </span>
      )}
    </div>
  );
}
