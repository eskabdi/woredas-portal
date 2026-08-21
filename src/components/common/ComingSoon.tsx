import { Construction, LayoutGrid } from "lucide-react";
import { PageHeader } from "@/components/common/PageHeader";

interface ComingSoonProps {
  titleAm: string;
  titleEn: string;
}

export function ComingSoon({ titleAm, titleEn }: ComingSoonProps) {
  return (
    <div>
      <PageHeader icon={LayoutGrid} titleAm={titleAm} titleEn={titleEn} />
      <div className="rounded-xl border border-dashed border-slate-300 bg-white p-12 text-center shadow-sm">
        <Construction className="mx-auto h-12 w-12 text-blue-300" />
        <h3 className="font-noto-ethiopic mt-4 text-lg font-semibold text-slate-700">በቅርቡ ይመጣል</h3>
        <p className="mt-1 text-sm text-slate-500">Coming Soon — Phase 2 module</p>
      </div>
    </div>
  );
}
