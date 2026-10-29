import { createContext, useContext, useEffect, useRef, type ComponentType } from 'react';
import { createPortal } from 'react-dom';
import type { Toast } from '@deepseek-ai/dsh-client-ui-primitives';
import type { ComponentProps } from 'react';
import { useTranslation } from '../locale/locale.js';

/** @brief Host-provided DSH floating notification renderer. */
export const ToastContext = createContext<ComponentType<ComponentProps<typeof Toast>> | undefined>(undefined);

/** @brief Keep standalone notifications transient without intercepting editor input. */
function PortableToast({ text, onDone }: ComponentProps<typeof Toast>) {
    const done = useRef(onDone);
    useEffect(() => { done.current = onDone; }, [onDone]);
    useEffect(() => {
        const timer = setTimeout(() => done.current(), 7000);
        return () => clearTimeout(timer);
    }, []);
    return createPortal(<div className="ts-error-toast" role="alert">{text}</div>, document.body);
}

/** @brief Display localized operation failures in a nonblocking top-center toast. */
export function ErrorToast({ message, close }: { message: string; close: () => void }) {
    const t = useTranslation();
    const Toast = useContext(ToastContext) ?? PortableToast;
    return <Toast text={t('operation_failed_detail', { message })} holdMs={6000} onDone={close} />;
}
