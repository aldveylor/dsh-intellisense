import { createContext, useContext, useLayoutEffect, useRef, useState, type ComponentProps, type ComponentType, type CSSProperties, type ReactNode } from 'react';
import type { InlineEditor } from '@deepseek-ai/dsh-client-ui-primitives';

/** @brief Host DSH multiline editor renderer, optional for standalone pages. */
export const InlineEditorContext = createContext<ComponentType<ComponentProps<typeof InlineEditor>> | undefined>(undefined);

/** @brief Shared inline editor with optional custom display and local draft validation. */
export interface EditableTextProps {
    value: string;
    label: string;
    className?: string;
    busy?: boolean;
    readOnly?: boolean;
    empty?: boolean;
    placeholder?: string;
    maxLength?: number;
    selectOnFocus?: boolean;
    renderDisplay?: (beginEdit: (element: HTMLElement) => void) => ReactNode;
    commit: (value: string) => boolean | void;
}

/** @brief Display text until double-click or Enter, commit on Enter/blur and cancel on Escape. */
export function EditableText({ value, label, className, busy = false, readOnly = false, empty = false, placeholder,
    maxLength, selectOnFocus = false, renderDisplay, commit }: EditableTextProps) {
    const NativeEditor = useContext(InlineEditorContext);
    const [draft, setDraft] = useState<{ value: string; element: HTMLElement; style: CSSProperties }>();
    const overlay = useRef<HTMLSpanElement>(null);
    const input = useRef<HTMLTextAreaElement | null>(null);
    const anchor = draft?.element;
    const fit = useRef<() => void>();

    useLayoutEffect(() => {
        const node = overlay.current;
        if (!node || !anchor) return;
        const view = anchor.ownerDocument.defaultView!;

        /** @brief Follow the anchor in viewport coordinates without inheriting ancestor clipping. */
        function position(): void {
            if (!node) return;
            const editor = node.querySelector('textarea');
            if (!editor) return;
            input.current = editor;
            const rect = anchor!.getBoundingClientRect();
            const container = anchor!.parentElement ?? anchor!;
            const bounds = container.getBoundingClientRect();
            const containerStyle = view.getComputedStyle(container);
            const insetLeft = (parseFloat(containerStyle.borderLeftWidth) || 0) + (parseFloat(containerStyle.paddingLeft) || 0);
            const insetRight = (parseFloat(containerStyle.borderRightWidth) || 0) + (parseFloat(containerStyle.paddingRight) || 0);
            const width = Math.min(Math.max(0, bounds.width - insetLeft - insetRight), Math.max(0, view.innerWidth - 8));
            const availableHeight = Math.max(0, view.innerHeight - 8);
            const minimumHeight = Math.min(Math.max(rect.height, 32), availableHeight);
            node.style.width = `${width}px`;
            editor.style.minHeight = `${minimumHeight}px`;
            editor.style.maxHeight = `${availableHeight}px`;
            editor.style.height = '0px';
            const style = view.getComputedStyle(editor);
            const border = (parseFloat(style.borderTopWidth) || 0) + (parseFloat(style.borderBottomWidth) || 0);
            const height = Math.min(Math.max(minimumHeight, editor.scrollHeight + border), availableHeight);
            editor.style.height = `${height}px`;
            node.style.height = `${height}px`;
            node.style.left = `${Math.max(4, Math.min(bounds.left + insetLeft, view.innerWidth - width - 4))}px`;
            node.style.top = `${Math.max(4, Math.min(rect.top, view.innerHeight - height - 4))}px`;
        }

        fit.current = position;
        node.setAttribute('popover', 'manual');
        node.showPopover?.();
        position();
        input.current?.focus({ preventScroll: true });
        const observer = view.ResizeObserver ? new view.ResizeObserver(position) : undefined;
        observer?.observe(anchor);
        if (anchor.parentElement) observer?.observe(anchor.parentElement);
        view.addEventListener('resize', position);
        view.addEventListener('scroll', position, true);
        return () => {
            fit.current = undefined;
            observer?.disconnect();
            view.removeEventListener('resize', position);
            view.removeEventListener('scroll', position, true);
            node.hidePopover?.();
        };
    }, [anchor]);

    useLayoutEffect(() => {
        const editor = input.current;
        if (!editor || !draft) return;
        Object.assign(editor.style, draft.style);
        editor.disabled = busy;
        editor.readOnly = readOnly;
        if (maxLength !== undefined) editor.maxLength = maxLength;
        else editor.removeAttribute('maxlength');
        fit.current?.();
    }, [draft, busy, readOnly, maxLength]);

    /** @brief Start editing only when the caller permits changes. */
    function beginEdit(element: HTMLElement): void {
        if (busy || readOnly) return;
        const display = element.ownerDocument.defaultView!.getComputedStyle(element);
        setDraft({ value, element, style: {
            fontFamily: display.fontFamily, fontSize: display.fontSize, fontWeight: display.fontWeight,
            fontStyle: display.fontStyle, lineHeight: display.lineHeight, letterSpacing: display.letterSpacing,
            textTransform: display.textTransform as CSSProperties['textTransform'], color: display.color,
        } });
    }

    /** @brief Keep rejected drafts open and discard empty or unchanged names. */
    function finishEdit(): void {
        if (draft === undefined || busy || readOnly) return;
        const next = draft.value.trim();
        if ((!empty && !next) || next === value || commit(next) !== false) setDraft(undefined);
    }

    const display = renderDisplay ? <>{renderDisplay(beginEdit)}</> :
        <span className={className} aria-label={label} role={readOnly ? undefined : 'button'} tabIndex={busy || readOnly ? -1 : 0}
            onDoubleClick={event => beginEdit(event.currentTarget)} onKeyDown={event => {
                if (event.nativeEvent.isComposing || event.nativeEvent.keyCode === 229) return;
                if (!busy && !readOnly && event.key === 'Enter') { event.preventDefault(); beginEdit(event.currentTarget); }
            }}>{value || placeholder}</span>;

    /** @brief Update the local draft without losing newlines. */
    function changeDraft(value: string): void {
        if (draft && !busy && !readOnly) setDraft({ ...draft, value });
    }

    return <>{display}{draft && <span ref={overlay} className="ts-inline-editor-overlay" style={{
        ...draft.style, position: 'fixed', display: 'inline-flex', boxSizing: 'border-box', margin: 0, padding: 0,
        border: 0, overflow: 'visible', background: 'transparent', zIndex: 10000,
    }} onBlur={finishEdit} onFocus={event => {
        if (selectOnFocus && event.target instanceof HTMLTextAreaElement) event.target.select();
    }} onKeyDownCapture={event => {
        if (event.nativeEvent.isComposing || event.nativeEvent.keyCode === 229) { event.stopPropagation(); return; }
        if (event.key === 'Enter' && !event.shiftKey) { event.preventDefault(); event.stopPropagation(); input.current?.blur(); }
        if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); setDraft(undefined); }
    }} onPointerDown={event => event.stopPropagation()} onClick={event => event.stopPropagation()}>
        {NativeEditor ? <NativeEditor value={draft.value} label={label} onChange={changeDraft}
            onSave={finishEdit} onCancel={() => setDraft(undefined)} className="ts-inline-editor-input" /> :
            <textarea ref={input} rows={1} aria-label={label} value={draft.value} style={draft.style} disabled={busy} readOnly={readOnly}
                maxLength={maxLength} onChange={event => changeDraft(event.target.value)} className="ts-inline-editor-fallback" />}
    </span>}</>;
}
