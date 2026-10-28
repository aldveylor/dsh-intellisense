/** @brief FIFO mutex protecting complete Profile operations across conversations. */
export class ProfileLock {
    private pending: Promise<void> = Promise.resolve();

    /** @brief Release the next waiter even when the operation fails or is cancelled. */
    async run<T>(operation: () => Promise<T>): Promise<T> {
        const prior = this.pending;
        let release!: () => void;
        this.pending = new Promise<void>(resolve => { release = resolve; });
        await prior;
        try { return await operation(); }
        finally { release(); }
    }
}
