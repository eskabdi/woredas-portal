import { useEffect, useRef, useState } from "react";
import {
  AlignCenter,
  AlignJustify,
  AlignLeft,
  AlignRight,
  Bold,
  Eraser,
  Heading1,
  Heading2,
  Italic,
  Link2,
  List,
  ListOrdered,
  Redo2,
  Underline as UnderlineIcon,
  Undo2,
} from "lucide-react";
import { cn } from "@/lib/utils";

interface RichTextEditorProps {
  value: string;
  onChange: (html: string) => void;
  placeholder?: string;
  className?: string;
  minHeight?: number;
}

/**
 * Lightweight contentEditable rich text editor with the core formatting tools
 * (bold / italic / underline, headings, lists, alignment, links, undo/redo).
 */
export function RichTextEditor({
  value,
  onChange,
  placeholder,
  className,
  minHeight = 260,
}: RichTextEditorProps) {
  const ref = useRef<HTMLDivElement>(null);
  const [focused, setFocused] = useState(false);

  // Sync external value in only when it differs (avoids caret jumps while typing).
  useEffect(() => {
    const el = ref.current;
    if (el && el.innerHTML !== value) el.innerHTML = value || "";
  }, [value]);

  const exec = (command: string, arg?: string) => {
    ref.current?.focus();
    document.execCommand(command, false, arg);
    onChange(ref.current?.innerHTML ?? "");
  };

  const insertLink = () => {
    const url = window.prompt("Link URL (https://…)");
    if (!url) return;
    if (!/^https?:\/\//i.test(url)) return;
    exec("createLink", url);
  };

  const isEmpty = !value || value === "<br>" || value.replace(/<[^>]*>/g, "").trim() === "";

  return (
    <div
      className={cn(
        "overflow-hidden rounded-md border bg-white",
        focused ? "border-blue-500 ring-1 ring-blue-200" : "border-input",
        className,
      )}
    >
      <div className="flex flex-wrap items-center gap-0.5 border-b bg-slate-50 p-1">
        <ToolBtn label="Bold" onClick={() => exec("bold")}>
          <Bold className="h-4 w-4" />
        </ToolBtn>
        <ToolBtn label="Italic" onClick={() => exec("italic")}>
          <Italic className="h-4 w-4" />
        </ToolBtn>
        <ToolBtn label="Underline" onClick={() => exec("underline")}>
          <UnderlineIcon className="h-4 w-4" />
        </ToolBtn>
        <Sep />
        <ToolBtn label="Heading 1" onClick={() => exec("formatBlock", "<h1>")}>
          <Heading1 className="h-4 w-4" />
        </ToolBtn>
        <ToolBtn label="Heading 2" onClick={() => exec("formatBlock", "<h2>")}>
          <Heading2 className="h-4 w-4" />
        </ToolBtn>
        <ToolBtn label="Paragraph" onClick={() => exec("formatBlock", "<p>")}>
          <span className="text-xs font-semibold">P</span>
        </ToolBtn>
        <Sep />
        <ToolBtn label="Bulleted list" onClick={() => exec("insertUnorderedList")}>
          <List className="h-4 w-4" />
        </ToolBtn>
        <ToolBtn label="Numbered list" onClick={() => exec("insertOrderedList")}>
          <ListOrdered className="h-4 w-4" />
        </ToolBtn>
        <Sep />
        <ToolBtn label="Align left" onClick={() => exec("justifyLeft")}>
          <AlignLeft className="h-4 w-4" />
        </ToolBtn>
        <ToolBtn label="Align center" onClick={() => exec("justifyCenter")}>
          <AlignCenter className="h-4 w-4" />
        </ToolBtn>
        <ToolBtn label="Align right" onClick={() => exec("justifyRight")}>
          <AlignRight className="h-4 w-4" />
        </ToolBtn>
        <ToolBtn label="Justify" onClick={() => exec("justifyFull")}>
          <AlignJustify className="h-4 w-4" />
        </ToolBtn>
        <Sep />
        <ToolBtn label="Insert link" onClick={insertLink}>
          <Link2 className="h-4 w-4" />
        </ToolBtn>
        <ToolBtn label="Clear formatting" onClick={() => exec("removeFormat")}>
          <Eraser className="h-4 w-4" />
        </ToolBtn>
        <Sep />
        <ToolBtn label="Undo" onClick={() => exec("undo")}>
          <Undo2 className="h-4 w-4" />
        </ToolBtn>
        <ToolBtn label="Redo" onClick={() => exec("redo")}>
          <Redo2 className="h-4 w-4" />
        </ToolBtn>
      </div>

      <div className="relative">
        {isEmpty && !focused && placeholder && (
          <div className="font-noto-ethiopic pointer-events-none absolute left-4 top-3 text-sm text-slate-400">
            {placeholder}
          </div>
        )}
        <div
          ref={ref}
          contentEditable
          suppressContentEditableWarning
          role="textbox"
          aria-multiline="true"
          aria-label="Letter body"
          onFocus={() => setFocused(true)}
          onBlur={() => setFocused(false)}
          onInput={(e) => onChange((e.currentTarget as HTMLDivElement).innerHTML)}
          className="rte-content font-noto-ethiopic max-h-[520px] overflow-y-auto px-4 py-3 text-sm leading-7 outline-none"
          style={{ minHeight }}
        />
      </div>
    </div>
  );
}

function ToolBtn({
  label,
  onClick,
  children,
}: {
  label: string;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      title={label}
      aria-label={label}
      onMouseDown={(e) => e.preventDefault()}
      onClick={onClick}
      className="flex h-8 w-8 items-center justify-center rounded text-slate-600 hover:bg-slate-200 hover:text-slate-900"
    >
      {children}
    </button>
  );
}

function Sep() {
  return <span className="mx-1 h-5 w-px bg-slate-200" />;
}
