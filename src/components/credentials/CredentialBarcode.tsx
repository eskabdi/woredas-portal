import { useEffect, useRef, useState } from "react";

import {
  BARCODE_WIDTH_MM,
  credentialDigits,
  renderCredentialBarcode,
} from "@/utils/barcode";

/**
 * Code 128 barcode of the credential number, for the front of the ID card.
 *
 * Renders nothing but a visible error if the value cannot be printed at a
 * scannable density — a card that looks finished and fails at the counter is
 * worse than one that never leaves the printer.
 */
export function CredentialBarcode({
  credentialNumber,
  widthMm = BARCODE_WIDTH_MM,
  showValue = true,
}: {
  credentialNumber: string | null | undefined;
  widthMm?: number;
  showValue?: boolean;
}) {
  const ref = useRef<SVGSVGElement | null>(null);
  const [error, setError] = useState<string | null>(null);
  const digits = credentialDigits(credentialNumber ?? "");

  useEffect(() => {
    if (!ref.current || !digits) return;
    try {
      renderCredentialBarcode(ref.current, digits, widthMm);
      setError(null);
    } catch (e) {
      setError((e as Error).message);
    }
  }, [digits, widthMm]);

  if (!digits) {
    return (
      <div className="border border-amber-300 bg-amber-50 px-2 py-1 text-[8px] font-medium text-amber-800">
        No credential number
      </div>
    );
  }

  if (error) {
    return (
      <div className="border border-red-300 bg-red-50 px-2 py-1 text-[8px] font-medium text-red-700">
        Barcode cannot be printed
      </div>
    );
  }

  return (
    <div className="flex flex-col items-center">
      <svg ref={ref} role="img" aria-label={`Credential number ${digits}`} />
      {showValue && (
        <div className="mt-0.5 font-mono text-[8px] tracking-[0.15em] text-slate-700">
          {digits}
        </div>
      )}
    </div>
  );
}
