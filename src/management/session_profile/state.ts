/** @brief Session-owned namespace selection and the durable profiles available to load. */
export interface SessionProfileState {
    enabled: boolean;
    locked?: boolean;
    profile?: string;
    profiles: string[];
    profileBriefs?: Record<string, string>;
}
