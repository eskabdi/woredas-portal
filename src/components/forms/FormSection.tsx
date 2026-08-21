import { AlertCircle } from "lucide-react";
import { Card } from "@/components/ui/card";
import { Label } from "@/components/ui/label";

export function Section({
  icon: Icon,
  titleAm,
  titleEn,
  helper,
  children,
}: {
  icon: React.ComponentType<{ className?: string }>;
  titleAm: string;
  titleEn: string;
  helper?: string;
  children: React.ReactNode;
}) {
  return (
    <Card className="overflow-hidden border-slate-200 p-0 shadow-sm">
      <div className="flex items-center gap-3 bg-blue-700 px-5 py-4 text-white">
        <div className="flex h-10 w-10 items-center justify-center rounded-full bg-white/15 ring-1 ring-white/25">
          <Icon className="h-5 w-5" />
        </div>
        <div className="leading-tight">
          <h2 className="font-noto-ethiopic text-lg font-semibold">{titleAm}</h2>
          <p className="text-sm text-blue-100">{titleEn}</p>
          {helper && <p className="font-noto-ethiopic mt-1 text-xs text-blue-100/90">{helper}</p>}
        </div>
      </div>
      <div className="p-5 md:p-6">{children}</div>
    </Card>
  );
}

export function Grid({ children }: { children: React.ReactNode }) {
  return <div className="grid grid-cols-1 gap-4 md:grid-cols-2">{children}</div>;
}

export function FieldWrap({
  labelAm,
  labelEn,
  required,
  error,
  colSpan2,
  helper,
  children,
}: {
  labelAm: string;
  labelEn: string;
  required?: boolean;
  error?: string;
  colSpan2?: boolean;
  helper?: string;
  children: React.ReactNode;
}) {
  return (
    <div className={colSpan2 ? "md:col-span-2" : ""}>
      <Label className="mb-1.5 block">
        <span className="font-noto-ethiopic text-sm font-medium text-slate-700">{labelAm}</span>
        <span className="ml-1 text-xs text-slate-500">/ {labelEn}</span>
        {required && <span className="ml-1 text-red-600">*</span>}
      </Label>
      {children}
      {helper && <p className="font-noto-ethiopic mt-1 text-xs text-slate-500">{helper}</p>}
      {error && (
        <p className="font-noto-ethiopic mt-1 flex items-center gap-1 text-xs text-red-600">
          <AlertCircle className="h-3 w-3" />
          {error}
        </p>
      )}
    </div>
  );
}

export function Select(props: React.SelectHTMLAttributes<HTMLSelectElement>) {
  const { className = "", ...rest } = props;
  return (
    <select
      {...rest}
      className={`font-noto-ethiopic flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-60 ${className}`}
    />
  );
}
