import { createContext, forwardRef, useContext, type ComponentProps, type ComponentType } from 'react';
import type { Button } from '@deepseek-ai/dsh-client-ui-primitives';

/** @brief Native DSH button renderer, provided by the host and optional in standalone pages. */
export const ButtonContext = createContext<ComponentType<ComponentProps<typeof Button>> | undefined>(undefined);

/** @brief Prefer the DSH Button while retaining themed HTML controls for standalone rendering. */
export const ActionButton = forwardRef<HTMLButtonElement, ComponentProps<typeof Button>>(function ActionButton({ variant = 'outline', size = 'md', ...props }, ref) {
    const NativeButton = useContext(ButtonContext);
    return NativeButton ? <NativeButton type="button" {...props} ref={ref} variant={variant} size={size} data-dsh-control="button" />
        : <button type="button" {...props} ref={ref} data-variant={variant} data-size={size} />;
});
