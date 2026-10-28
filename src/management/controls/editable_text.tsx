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
    multiline?: boolean;
    autoWidth?: boolean;
    /** @brief Minimum editor content width in pixels. */
    minWidth?: number;
    selectOnFocus?: boolean;
    renderDisplay?: (beginEdit: (element: HTMLElement, textElement?: HTMLElement) => void) => ReactNode;
    commit: (value: string) => boolean | void;
}

/** @brief Locate the first rendered text line, including nested labels and source padding. */
function textStart(element: HTMLElement): { left: number; top: number } {
    const document = element.ownerDocument;
    const style = document.defaultView!.getComputedStyle(element);
    const walker = document.createTreeWalker(element, 4);
    for (let text = walker.nextNode(); text; text = walker.nextNode()) {
        if (!text.textContent?.trim()) continue;
        const range = document.createRange();
        range.setStart(text, 0);
        range.setEnd(text, 1);
        const rect = range.getBoundingClientRect?.();
        if (rect?.height) {
            const lineHeight = parseFloat(style.lineHeight) || rect.height;
            return { left: rect.left, top: rect.top - (lineHeight - rect.height) / 2 };
        }
    }
    const rect = element.getBoundingClientRect();
    return {
        left: rect.left + (parseFloat(style.borderLeftWidth) || 0) + (parseFloat(style.paddingLeft) || 0),
        top: rect.top + (parseFloat(style.borderTopWidth) || 0) + (parseFloat(style.paddingTop) || 0),
    };
}

/** @brief Display text until double-click or Enter, commit on Enter/blur and cancel on Escape. */
export function EditableText({ value, label, className, busy = false, readOnly = false, empty = false, placeholder,
    maxLength, multiline = false, autoWidth = false, minWidth = 0, selectOnFocus = false, renderDisplay, commit }: EditableTextProps) {
    const NativeEditor = useContext(InlineEditorContext);
    const [draft, setDraft] = useState<{ value: string; element: HTMLElement; textElement: HTMLElement; style: CSSProperties }>();
    const overlay = useRef<HTMLSpanElement>(null);
    const input = useRef<HTMLTextAreaElement | null>(null);
    const anchor = draft?.element;
    const textAnchor = draft?.textElement;
    const fit = useRef<() => void>();

    useLayoutEffect(() => {
        const node = overlay.current;
        if (!node || !anchor || !textAnchor) return;
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
            const style = view.getComputedStyle(editor);
            const marginX = (parseFloat(style.marginLeft) || 0) + (parseFloat(style.marginRight) || 0);
            const marginY = (parseFloat(style.marginTop) || 0) + (parseFloat(style.marginBottom) || 0);
            const border = (parseFloat(style.borderTopWidth) || 0) + (parseFloat(style.borderBottomWidth) || 0);
            const horizontalInset = (parseFloat(style.borderLeftWidth) || 0) + (parseFloat(style.borderRightWidth) || 0)
                + (parseFloat(style.paddingLeft) || 0) + (parseFloat(style.paddingRight) || 0);
            const verticalInset = border + (parseFloat(style.paddingTop) || 0) + (parseFloat(style.paddingBottom) || 0);
            const measure = anchor!.ownerDocument.createElement('span');
            Object.assign(measure.style, { position: 'absolute', visibility: 'hidden', whiteSpace: 'pre', width: 'max-content', ...draft!.style });
            measure.textContent = value || placeholder || '';
            node.append(measure);
            const textWidth = measure.getBoundingClientRect().width || textAnchor!.getBoundingClientRect().width;
            measure.remove();
            const contentWidth = autoWidth ? bounds.width - insetLeft - insetRight : textWidth;
            const width = Math.min(Math.max(0, minWidth, contentWidth) + marginX + horizontalInset, Math.max(0, view.innerWidth - 8));
            const availableHeight = Math.max(0, view.innerHeight - 8 - marginY);
            const sourceHeight = multiline ? rect.height : parseFloat(style.lineHeight) || parseFloat(style.fontSize) * 1.2 || 18;
            const minimumHeight = Math.min(Math.max(sourceHeight + verticalInset, 32), availableHeight);
            node.style.width = `${width}px`;
            editor.style.minHeight = `${minimumHeight}px`;
            editor.style.maxHeight = `${availableHeight}px`;
            editor.style.height = '0px';
            const height = Math.min(Math.max(minimumHeight, (multiline ? editor.scrollHeight + border : minimumHeight)), availableHeight);
            editor.style.height = `${height}px`;
            node.style.height = `${height + marginY}px`;
            const start = textStart(textAnchor!);
            const editorBounds = editor.getBoundingClientRect();
            const overlayBounds = node.getBoundingClientRect();
            const offsetLeft = editorBounds.left - overlayBounds.left + (parseFloat(style.borderLeftWidth) || 0) + (parseFloat(style.paddingLeft) || 0);
            const offsetTop = editorBounds.top - overlayBounds.top + (parseFloat(style.borderTopWidth) || 0) + (parseFloat(style.paddingTop) || 0);
            node.style.left = `${Math.max(4, Math.min(start.left - offsetLeft, view.innerWidth - width - 4))}px`;
            node.style.top = `${Math.max(4, Math.min(start.top - offsetTop, view.innerHeight - height - marginY - 4))}px`;
        }

        fit.current = position;
        node.setAttribute('popover', 'manual');
        node.showPopover?.();
        position();
        input.current?.focus({ preventScroll: true });
        const observer = view.ResizeObserver ? new view.ResizeObserver(position) : undefined;
        observer?.observe(anchor);
        if (textAnchor !== anchor) observer?.observe(textAnchor);
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
    }, [anchor, textAnchor, multiline, autoWidth, minWidth, value, placeholder]);

    useLayoutEffect(() => {
        const editor = input.current;
        if (!editor || !draft) return;
        Object.assign(editor.style, draft.style);
        editor.disabled = busy;
        editor.readOnly = readOnly;
        editor.wrap = multiline ? 'soft' : 'off';
        editor.style.whiteSpace = multiline ? 'pre-wrap' : 'pre';
        editor.style.overflowWrap = multiline ? 'anywhere' : 'normal';
        if (maxLength !== undefined) editor.maxLength = maxLength;
        else editor.removeAttribute('maxlength');
        fit.current?.();
    }, [draft, busy, readOnly, maxLength, multiline]);

    /** @brief Start editing only when the caller permits changes. */
    function beginEdit(element: HTMLElement, textElement = element): void {
        if (busy || readOnly) return;
        const display = element.ownerDocument.defaultView!.getComputedStyle(textElement);
        setDraft({ value, element, textElement, style: {
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

    /** @brief Preserve line breaks only when multiline editing is enabled. */
    function changeDraft(value: string): void {
        if (draft && !busy && !readOnly) setDraft({ ...draft, value: multiline ? value : value.replace(/[\r\n]+/g, ' ') });
    }

    return <>{display}{draft && <span ref={overlay} className="ts-inline-editor-overlay" style={{
        ...draft.style, position: 'fixed', display: 'inline-flex', boxSizing: 'border-box', margin: 0, padding: 0,
        border: 0, overflow: 'visible', background: 'transparent', zIndex: 10000,
    }} onBlur={finishEdit} onFocus={event => {
        if (selectOnFocus && event.target instanceof HTMLTextAreaElement) event.target.select();
    }} onKeyDownCapture={event => {
        if (event.nativeEvent.isComposing || event.nativeEvent.keyCode === 229) { event.stopPropagation(); return; }
        if (event.key === 'Enter' && (!multiline || !event.shiftKey)) { event.preventDefault(); event.stopPropagation(); input.current?.blur(); }
        if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); setDraft(undefined); }
    }} onPointerDown={event => event.stopPropagation()} onClick={event => event.stopPropagation()}>
        {NativeEditor ? <NativeEditor value={draft.value} label={label} onChange={changeDraft}
            onSave={finishEdit} onCancel={() => setDraft(undefined)} className="ts-inline-editor-input" /> :
            <textarea ref={input} rows={1} aria-label={label} value={draft.value} style={draft.style} disabled={busy} readOnly={readOnly}
                maxLength={maxLength} onChange={event => changeDraft(event.target.value)} className="ts-inline-editor-fallback" />}
    </span>}</>;
}
