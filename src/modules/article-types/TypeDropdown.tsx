import { useEffect, useLayoutEffect, useId, useRef, useState, type CSSProperties } from "react";
import { createPortal } from "react-dom";
import { Check, ChevronDown } from "lucide-react";
import "./type-dropdown.css";

export type TypeDropdownOption = { value: string; label: string };

/** 类型入口共用可访问下拉；焦点始终留在触发器，通过活动后代控制列表。 */
export default function TypeDropdown({
  id,
  label,
  value,
  options,
  disabled = false,
  onChange,
}: {
  id?: string;
  label: string;
  value: string;
  options: TypeDropdownOption[];
  disabled?: boolean;
  onChange: (value: string) => void;
}) {
  const generatedId = useId();
  const triggerId = id ?? generatedId;
  const listId = `${triggerId}-list`;
  const trigger = useRef<HTMLButtonElement>(null);
  const list = useRef<HTMLDivElement>(null);
  const [hydrated, setHydrated] = useState(false);
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const [position, setPosition] = useState<CSSProperties>({});
  const [placement, setPlacement] = useState("bottom");
  const unavailable = disabled || !hydrated || options.length === 0;
  const selected = options.findIndex((option) => option.value === value);
  const expanded = open && !unavailable;

  useEffect(() => setHydrated(true), []);
  useEffect(() => { if (unavailable) setOpen(false); }, [unavailable]);
  useEffect(() => {
    if (open) setActive(Math.max(0, selected));
  }, [value, options.length]);

  function close(restoreFocus = false) {
    setOpen(false);
    if (restoreFocus) trigger.current?.focus();
  }
  function show() {
    if (unavailable) return;
    setActive(Math.max(0, selected));
    setOpen(true);
  }
  function choose(index: number) {
    const option = options[index];
    if (!option || unavailable) return;
    close(true);
    onChange(option.value);
  }

  useLayoutEffect(() => {
    if (!expanded) return;
    function locate() {
      const anchor = trigger.current;
      if (!anchor) return;
      const rect = anchor.getBoundingClientRect();
      // 仅测量自身锚点，弹层移至 body，避免被编辑器/卡片 overflow 裁切。
      const viewport = window.visualViewport;
      const width = viewport?.width ?? window.innerWidth;
      const height = viewport?.height ?? window.innerHeight;
      const offsetX = viewport?.offsetLeft ?? 0;
      const offsetY = viewport?.offsetTop ?? 0;
      const gutter = 8;
      const below = Math.max(0, offsetY + height - rect.bottom - gutter - 6);
      const above = Math.max(0, rect.top - offsetY - gutter - 6);
      const placeAbove = below < Math.min(240, options.length * 40 + 8) && above > below;
      const popupWidth = Math.min(Math.max(rect.width, 160), Math.max(0, width - gutter * 2));
      setPlacement(placeAbove ? "top" : "bottom");
      setPosition({
        position: "fixed",
        width: popupWidth,
        left: Math.max(offsetX + gutter, Math.min(rect.left, offsetX + width - popupWidth - gutter)),
        ...(placeAbove
          ? { bottom: window.innerHeight - rect.top + 6 }
          : { top: rect.bottom + 6 }),
        maxHeight: Math.min(280, placeAbove ? above : below),
      });
    }
    function outside(event: Event) {
      const target = event.target as Node | null;
      if (target && !trigger.current?.contains(target) && !list.current?.contains(target)) close();
    }
    function onPageScroll(event: Event) {
      // 用户自行滚动长菜单时，不重定位/重置活动项的可见位置。
      if (event.target instanceof Node && list.current?.contains(event.target)) return;
      locate();
    }
    locate();
    document.addEventListener("pointerdown", outside);
    document.addEventListener("focusin", outside);
    window.addEventListener("resize", locate);
    window.addEventListener("scroll", onPageScroll, true);
    window.visualViewport?.addEventListener("resize", locate);
    window.visualViewport?.addEventListener("scroll", locate);
    return () => {
      document.removeEventListener("pointerdown", outside);
      document.removeEventListener("focusin", outside);
      window.removeEventListener("resize", locate);
      window.removeEventListener("scroll", onPageScroll, true);
      window.visualViewport?.removeEventListener("resize", locate);
      window.visualViewport?.removeEventListener("scroll", locate);
    };
  }, [expanded, options.length]);
  useLayoutEffect(() => {
    if (!expanded) return;
    const menu = list.current;
    const option = menu?.children[active] as HTMLElement | undefined;
    if (!menu || !option) return;
    // 只调整菜单滚动位置；scrollIntoView 会连带滚动编辑器及整页。
    const top = option.offsetTop;
    const bottom = top + option.offsetHeight;
    if (top < menu.scrollTop) menu.scrollTop = top;
    else if (bottom > menu.scrollTop + menu.clientHeight)
      menu.scrollTop = bottom - menu.clientHeight;
  }, [expanded, active, position]);

  return <>
    <button
      type="button"
      id={triggerId}
      ref={trigger}
      className="article-type-dropdown-trigger"
      role="combobox"
      aria-label={label}
      aria-haspopup="listbox"
      aria-controls={expanded ? listId : undefined}
      aria-expanded={expanded}
      aria-activedescendant={expanded ? `${listId}-${active}` : undefined}
      disabled={unavailable}
      onClick={() => expanded ? close() : show()}
      onKeyDown={(event) => {
        if (unavailable) return;
        if (event.key === "Tab") { close(); return; }
        if (event.key === "Escape" && expanded) { event.preventDefault(); event.stopPropagation(); close(true); return; }
        if (["ArrowDown", "ArrowUp", "Home", "End"].includes(event.key)) {
          event.preventDefault();
          if (!expanded) { show(); return; }
          setActive((previous) => event.key === "Home" ? 0 : event.key === "End" ? options.length - 1 : (previous + (event.key === "ArrowDown" ? 1 : -1) + options.length) % options.length);
          return;
        }
        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault();
          if (expanded) choose(active); else show();
        }
      }}
    >
      <span>{options[selected]?.label ?? label}</span><ChevronDown size={16} aria-hidden="true" />
    </button>
    {expanded && createPortal(
      <div ref={list} id={listId} role="listbox" aria-label={label} className="article-type-dropdown-list" style={position} data-placement={placement}>
        {options.map((option, index) => <div
          id={`${listId}-${index}`}
          key={option.value}
          role="option"
          aria-selected={option.value === value}
          data-active={index === active || undefined}
          className="article-type-dropdown-option"
          onPointerMove={() => setActive(index)}
          onPointerDown={(event) => event.preventDefault()}
          onClick={() => choose(index)}
        ><span>{option.label}</span>{option.value === value && <Check size={15} aria-hidden="true" />}</div>)}
      </div>, document.body,
    )}
  </>;
}
