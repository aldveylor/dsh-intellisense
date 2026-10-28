import { createContext, useContext, useState, type ComponentProps, type ComponentType, type CSSProperties, type ReactNode } from 'react';
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
    const [draft, setDraft] = useState<{ value: string; style: CSSProperties }>();

    /** @brief Start editing only when the caller permits changes. */
    function beginEdit(element: HTMLElement): void {
        if (busy || readOnly) return;
        const { width, height } = element.getBoundingClientRect();
        const display = element.ownerDocument.defaultView!.getComputedStyle(element);
        setDraft({ value, style: {
            boxSizing: 'border-box', width, minWidth: width, maxWidth: width,
            height, minHeight: height, maxHeight: height, flexShrink: 0,
            fontFamily: display.fontFamily, fontSize: display.fontSize, fontWeight: display.fontWeight,
            fontStyle: display.fontStyle, lineHeight: display.lineHeight, letterSpacing: display.letterSpacing,
            textTransform: display.textTransform as CSSProperties['textTransform'], color: display.color,
            paddingTop: display.paddingTop, paddingRight: display.paddingRight,
            paddingBottom: display.paddingBottom, paddingLeft: display.paddingLeft,
            borderTopWidth: display.borderTopWidth, borderRightWidth: display.borderRightWidth,
            borderBottomWidth: display.borderBottomWidth, borderLeftWidth: display.borderLeftWidth,
        } });
    }

    /** @brief Keep rejected drafts open and discard empty or unchanged names. */
    function finishEdit(): void {
        if (draft === undefined || busy || readOnly) return;
        const next = draft.value.trim();
        if ((!empty && !next) || next === value || commit(next) !== false) setDraft(undefined);
    }

    if (draft === undefined) return renderDisplay ? <>{renderDisplay(beginEdit)}</> :
        <span className={className} aria-label={label} role={readOnly ? undefined : 'button'} tabIndex={busy || readOnly ? -1 : 0}
            onDoubleClick={event => beginEdit(event.currentTarget)} onKeyDown={event => {
                if (event.nativeEvent.isComposing || event.nativeEvent.keyCode === 229) return;
                if (!busy && !readOnly && event.key === 'Enter') { event.preventDefault(); beginEdit(event.currentTarget); }
            }}>{value || placeholder}</span>;

    const inputProps: ComponentProps<typeof Input> = {
        'aria-label': label, autoFocus: true, value: draft.value, disabled: busy, readOnly, maxLength,
        onFocus: event => { if (selectOnFocus) event.target.select(); },
        onChange: event => setDraft({ ...draft, value: event.target.value }), onBlur: finishEdit,
        onKeyDown: event => {
            if (event.nativeEvent.isComposing || event.nativeEvent.keyCode === 229) return;
            if (event.key === 'Enter') { event.preventDefault(); event.currentTarget.blur(); }
            if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); setDraft(undefined); }
        },
    };
    return NativeInput ? <span className={`${className ?? ''} ts-inline-editor`} style={{ ...draft.style, display: 'inline-flex' }}>
        <NativeInput {...inputProps} className="ts-inline-editor-input" data-dsh-control="input" />
    </span> : <input {...inputProps} className={className} style={draft.style} />;
}
