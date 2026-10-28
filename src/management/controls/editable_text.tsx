import { createContext, useContext, useLayoutEffect, useRef, useState, type ComponentProps, type ComponentType, type CSSProperties, type ReactNode } from 'react';
import type { Input } from '@deepseek-ai/dsh-client-ui-primitives';

/** @brief Host DSH Input renderer, optional for standalone pages. */
export const InputContext = createContext<ComponentType<ComponentProps<typeof Input>> | undefined>(undefined);

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
    const NativeInput = useContext(InputContext);
    const [draft, setDraft] = useState<{ value: string; element: HTMLElement; style: CSSProperties }>();
    const overlay = useRef<HTMLSpanElement>(null);
    const input = useRef<HTMLInputElement>(null);
    const anchor = draft?.element;

    useLayoutEffect(() => {
        const node = overlay.current;
        if (!node || !anchor) return;
        const view = anchor.ownerDocument.defaultView!;

        /** @brief Follow the anchor in viewport coordinates without inheriting ancestor clipping. */
        function position(): void {
            if (!node) return;
            const rect = anchor!.getBoundingClientRect();
            const width = Math.min(Math.max(rect.width, 120), Math.max(0, view.innerWidth - 8));
            const height = Math.max(rect.height, 32);
            node.style.width = `${width}px`;
            node.style.height = `${height}px`;
            node.style.left = `${Math.max(4, Math.min(rect.left, view.innerWidth - width - 4))}px`;
            node.style.top = `${Math.max(4, Math.min(rect.top - (height - rect.height) / 2, view.innerHeight - height - 4))}px`;
        }

        node.setAttribute('popover', 'manual');
        node.showPopover?.();
        position();
        input.current?.focus({ preventScroll: true });
        const observer = view.ResizeObserver ? new view.ResizeObserver(position) : undefined;
        observer?.observe(anchor);
        view.addEventListener('resize', position);
        view.addEventListener('scroll', position, true);
        return () => {
            observer?.disconnect();
            view.removeEventListener('resize', position);
            view.removeEventListener('scroll', position, true);
            node.hidePopover?.();
        };
    }, [anchor]);

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

    const inputProps: ComponentProps<typeof Input> = {
        'aria-label': label, ref: input, style: draft?.style, value: draft?.value, disabled: busy, readOnly, maxLength,
        onFocus: event => { if (selectOnFocus) event.target.select(); },
        onChange: event => { if (draft) setDraft({ ...draft, value: event.target.value }); }, onBlur: finishEdit,
        onKeyDown: event => {
            if (event.nativeEvent.isComposing || event.nativeEvent.keyCode === 229) return;
            if (event.key === 'Enter') { event.preventDefault(); event.currentTarget.blur(); }
            if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); setDraft(undefined); }
        },
    };
    return <>{display}{draft && <span ref={overlay} className="ts-inline-editor-overlay" style={{
        ...draft.style, position: 'fixed', display: 'inline-flex', boxSizing: 'border-box', margin: 0, padding: 0,
        border: 0, overflow: 'visible', background: 'transparent', zIndex: 10000,
    }} onPointerDown={event => event.stopPropagation()} onClick={event => event.stopPropagation()}>
        {NativeInput ? <NativeInput {...inputProps} className="ts-inline-editor-input" data-dsh-control="input" /> :
            <input {...inputProps} className="ts-inline-editor-fallback" />}
    </span>}</>;
}
