import { useState } from "react";
import { toast } from "sonner";
import { Loader2 } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { supabase } from "@/integrations/supabase/client";

/**
 * Self-service password change for an already-authenticated user, reached
 * from the header avatar dropdown (WoredaShell/AdminShell). This is
 * deliberately separate from a forgotten-password recovery flow: the system
 * owner's decision is that a locked-out user contacts an administrator
 * (login.tsx), while a signed-in user who simply wants to change their
 * password can do it directly here via supabase.auth.updateUser() -- no
 * token or email round-trip needed, since the current session already
 * proves who they are.
 */
export function ChangePasswordDialog({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function reset() {
    setPassword("");
    setConfirm("");
    setError(null);
  }

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    if (password.length < 8) {
      setError("የይለፍ ቃል ቢያንስ 8 ፊደላት ሊኖረው ይገባል / Password must be at least 8 characters.");
      return;
    }
    if (password !== confirm) {
      setError("የይለፍ ቃላት አይመሳሰሉም / Passwords do not match.");
      return;
    }
    setSubmitting(true);
    const { error: updateErr } = await supabase.auth.updateUser({ password });
    setSubmitting(false);
    if (updateErr) {
      setError(updateErr.message);
      return;
    }
    toast.success("የይለፍ ቃል ተቀይሯል / Password changed");
    reset();
    onOpenChange(false);
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        // Guards Escape/overlay-click too, not just the Cancel button --
        // otherwise either one still closes the dialog while updateUser()
        // is in flight, and a subsequent success toast fires after the user
        // already believes they cancelled, with no way to tell from the
        // closed dialog that the password was, in fact, changed.
        if (!o && submitting) return;
        if (!o) reset();
        onOpenChange(o);
      }}
    >
      <DialogContent>
        <DialogHeader>
          <DialogTitle>
            <span className="font-noto-ethiopic">የይለፍ ቃል ቀይር</span>
            <span className="ml-2 text-sm text-slate-500">/ Change Password</span>
          </DialogTitle>
        </DialogHeader>
        <form onSubmit={onSubmit} className="space-y-4">
          <div>
            <Label htmlFor="new-password">
              <span className="font-noto-ethiopic">አዲስ የይለፍ ቃል</span>
              <span className="ml-1 text-slate-500">/ New password</span>
            </Label>
            <Input
              id="new-password"
              type="password"
              autoComplete="new-password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="mt-1"
            />
          </div>
          <div>
            <Label htmlFor="confirm-password">
              <span className="font-noto-ethiopic">የይለፍ ቃል አረጋግጥ</span>
              <span className="ml-1 text-slate-500">/ Confirm new password</span>
            </Label>
            <Input
              id="confirm-password"
              type="password"
              autoComplete="new-password"
              value={confirm}
              onChange={(e) => setConfirm(e.target.value)}
              className="mt-1"
            />
          </div>
          {error && (
            <div className="rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-700">
              {error}
            </div>
          )}
          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              disabled={submitting}
              onClick={() => {
                reset();
                onOpenChange(false);
              }}
            >
              <span className="font-noto-ethiopic">ይቅር</span>
              <span className="ml-1">/ Cancel</span>
            </Button>
            <Button type="submit" disabled={submitting} className="bg-blue-700 hover:bg-blue-800">
              {submitting ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <>
                  <span className="font-noto-ethiopic">አስቀምጥ</span>
                  <span className="ml-1">/ Save</span>
                </>
              )}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
