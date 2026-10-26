/** @brief Export detached storage data; restore implementations with constructor(data?). */
export interface Saveable<T> {
    save(): T;
}
