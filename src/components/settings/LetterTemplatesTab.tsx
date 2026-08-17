import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { FileText, Loader2, Save, Eye } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { RichTextEditor } from "@/components/ui/rich-text-editor";
import { supabase } from "@/integrations/supabase/client";
import { useAuthStore } from "@/stores/authStore";
import {
  LETTER_TOKENS,
  letterHtmlToText,
  plainTextToHtml,
  renderLetterTemplate,
  sanitizeLetterHtml,
} from "@/lib/letterTemplate";
import { formatEthiopianDate } from "@/utils/ethiopianCalendar";

interface TypeRow {
  service_type_id: string;
  code: string;
  name_am: string;
  name_en: string;
  category: string;
  is_active: boolean;
  letter_body_template: string | null;
  letter_body_html: string | null;
}

export function LetterTemplatesTab() {
  const woredaId = useAuthStore((s) => s.woredaId);
  const queryClient = useQueryClient();
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [html, setHtml] = useState("");
  const [dirty, setDirty] = useState(false);
  const [preview, setPreview] = useState(false);

  const typesQuery = useQuery({
    queryKey: ["letter-template-types", woredaId],
    enabled: !!woredaId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("service_type")
        .select(
          "service_type_id, code, name_am, name_en, category, is_active, letter_body_template, letter_body_html",
        )
        .eq("woreda_id", woredaId!)
        .eq("category", "letter")
        .order("sort_order", { ascending: true })
        .order("name_en", { ascending: true });
      if (error) throw error;
      return (data ?? []) as TypeRow[];
    },
  });

  const types = typesQuery.data ?? [];
  const selected = useMemo(
    () => types.find((t) => t.service_type_id === selectedId) ?? null,
    [types, selectedId],
  );

  useEffect(() => {
    if (!selectedId && types.length > 0) setSelectedId(types[0]!.service_type_id);
  }, [types, selectedId]);

  useEffect(() => {
    if (!selected) return;
    setHtml(selected.letter_body_html ?? plainTextToHtml(selected.letter_body_template ?? ""));
    setDirty(false);
    setPreview(false);
  }, [selected?.service_type_id]); // eslint-disable-line react-hooks/exhaustive-deps

  const saveMutation = useMutation({
    mutationFn: async () => {
      if (!selected) return;
      const clean = sanitizeLetterHtml(html);
      const { error } = await supabase
        .from("service_type")
        .update({
          letter_body_html: clean || null,
          letter_body_template: letterHtmlToText(clean) || null,
        })
        .eq("service_type_id", selected.service_type_id);
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("የደብዳቤ አብነት ተቀምጧል / Letter template saved");
      setDirty(false);
      void queryClient.invalidateQueries({ queryKey: ["letter-template-types"] });
      void queryClient.invalidateQueries({ queryKey: ["service-types"] });
    },
    onError: (e: unknown) =>
      toast.error(`ማስቀመጥ አልተሳካም / Save failed: ${e instanceof Error ? e.message : "unknown"}`),
  });

  const insertToken = (token: string) => {
    setHtml((prev) => `${prev}${token}`);
    setDirty(true);
  };

  const previewHtml = useMemo(() => {
    const now = new Date();
    return renderLetterTemplate(sanitizeLetterHtml(html), {
      APPLICANT_NAME: "አበበ በቀለ ታደሰ",
      RESIDENT_NUMBER: "HRW-000123",
      KEBELE: "ቀበሌ 03",
      WOREDA: "ሐረሪ ወረዳ",
      PURPOSE: "የሥራ አጥነት ማረጋገጫ",
      ADDRESSED_TO: "ለሚመለከተው አካል ሁሉ",
      LETTER_NO: "HRW-SRV-18-00042",
      DATE_ET: formatEthiopianDate(now),
      DATE_GC: now.toLocaleDateString("en-GB"),
      SEX: "ወንድ",
      DETAILS: "የናሙና ዝርዝር መረጃ",
    });
  }, [html]);

  return (
    <div className="grid gap-6 lg:grid-cols-[280px_1fr]">
      <Card className="h-fit overflow-hidden p-0">
        <div className="border-b bg-slate-50 px-4 py-3">
          <div className="font-noto-ethiopic text-sm font-semibold">የደብዳቤ ዓይነቶች</div>
          <div className="text-[11px] uppercase tracking-wide text-slate-400">Letter types</div>
        </div>
        <div className="max-h-[560px] overflow-y-auto">
          {typesQuery.isPending && (
            <div className="p-4 text-sm text-slate-500">Loading…</div>
          )}
          {!typesQuery.isPending && types.length === 0 && (
            <div className="font-noto-ethiopic p-4 text-sm text-slate-500">
              የደብዳቤ ዓይነት አልተገኘም / No letter services in the catalog
            </div>
          )}
          {types.map((t) => {
            const active = t.service_type_id === selectedId;
            const hasTemplate = !!(t.letter_body_html ?? t.letter_body_template);
            return (
              <button
                key={t.service_type_id}
                type="button"
                onClick={() => {
                  if (dirty && !window.confirm("Discard unsaved template changes?")) return;
                  setSelectedId(t.service_type_id);
                }}
                className={`flex w-full items-start gap-2 border-b px-4 py-3 text-left hover:bg-slate-50 ${
                  active ? "bg-blue-50" : ""
                }`}
              >
                <FileText
                  className={`mt-0.5 h-4 w-4 ${active ? "text-blue-700" : "text-slate-400"}`}
                />
                <div className="min-w-0 flex-1">
                  <div className="font-noto-ethiopic truncate text-sm font-medium">{t.name_am}</div>
                  <div className="truncate text-[11px] text-slate-500">{t.name_en}</div>
                </div>
                {hasTemplate ? (
                  <Badge variant="outline" className="border-emerald-200 bg-emerald-50 text-[10px] text-emerald-700">
                    Set
                  </Badge>
                ) : (
                  <Badge variant="outline" className="text-[10px] text-slate-500">
                    Empty
                  </Badge>
                )}
              </button>
            );
          })}
        </div>
      </Card>

      <div className="space-y-4">
        {!selected ? (
          <Card className="p-8 text-center text-sm text-slate-500">
            Select a letter type to edit its template.
          </Card>
        ) : (
          <>
            <Card className="p-4">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div>
                  <div className="font-noto-ethiopic text-base font-semibold">{selected.name_am}</div>
                  <div className="text-xs text-slate-500">
                    {selected.name_en} · <span className="font-mono">{selected.code}</span>
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  <Button variant="outline" size="sm" onClick={() => setPreview((v) => !v)}>
                    <Eye className="mr-1 h-4 w-4" />
                    {preview ? "Edit" : "Preview"}
                  </Button>
                  <Button
                    size="sm"
                    className="bg-blue-700 hover:bg-blue-800"
                    disabled={!dirty || saveMutation.isPending}
                    onClick={() => saveMutation.mutate()}
                  >
                    {saveMutation.isPending ? (
                      <Loader2 className="mr-1 h-4 w-4 animate-spin" />
                    ) : (
                      <Save className="mr-1 h-4 w-4" />
                    )}
                    <span className="font-noto-ethiopic">አስቀምጥ</span>
                    <span className="ml-1 text-xs opacity-80">/ Save</span>
                  </Button>
                </div>
              </div>

              <div className="mt-4">
                <Label className="font-noto-ethiopic text-xs">
                  መለያ ቁልፎች / Placeholders — click to insert
                </Label>
                <div className="mt-2 flex flex-wrap gap-1.5">
                  {LETTER_TOKENS.map((t) => (
                    <button
                      key={t.token}
                      type="button"
                      title={`${t.labelAm} / ${t.labelEn}`}
                      onClick={() => insertToken(t.token)}
                      className="rounded border border-slate-200 bg-slate-50 px-2 py-1 font-mono text-[11px] text-slate-700 hover:border-blue-300 hover:bg-blue-50"
                    >
                      {t.token}
                    </button>
                  ))}
                </div>
              </div>
            </Card>

            {preview ? (
              <Card className="p-8">
                <div className="mb-3 text-xs uppercase tracking-wide text-slate-400">
                  Preview with sample data
                </div>
                <div
                  className="letter-body font-noto-ethiopic text-sm leading-8"
                  dangerouslySetInnerHTML={{ __html: previewHtml }}
                />
              </Card>
            ) : (
              <RichTextEditor
                value={html}
                onChange={(v) => {
                  setHtml(v);
                  setDirty(true);
                }}
                minHeight={340}
                placeholder="የደብዳቤውን ሙሉ ቃል ይጻፉ… / Write the letter body, using placeholders like {APPLICANT_NAME}"
              />
            )}

            <p className="font-noto-ethiopic text-xs text-slate-500">
              እያንዳንዱ በዚህ አብነት የሚወጣ ደብዳቤ በሕዝብ ማረጋገጫ ዩአርኤል የሚሠራ QR ኮድ ይይዛል። / Every letter issued
              from this template carries a QR code that resolves to the public verification page.
            </p>
          </>
        )}
      </div>
    </div>
  );
}
