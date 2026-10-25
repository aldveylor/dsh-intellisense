/** @brief Session-owned namespace selection and the durable profiles available to load. */
export interface SessionProfileState {
    enabled: boolean;
    profile?: string;
    profiles: string[];
}
