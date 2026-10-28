/** @brief Profile name with an optional secondary description shared by native and editable menus. */
export function ProfileLabel({ label, brief }: { label: string; brief?: string }) {
    return <span className="ts-profile-text"><span>{label}</span>{brief && <span className="ts-profile-brief">{brief}</span>}</span>;
}
