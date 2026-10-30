import { z } from 'zod';
import { storageVersion } from '../../storage/version.js';
import { upgradeProfileNodes } from './profile_compatibility.js';
import type { ProfileCatalogData } from './registry.js';
import type { PlaneProfileData } from '../plane/profile.js';

/** @brief Persisted configuration undergoing one adjacent schema upgrade at a time. */
type UpgradeData = Record<string, unknown> & { version: number; revision: number };

/** @brief Allocate and validate one named Profile while converting the flat catalog. */
export type UpgradeProfile = (name: string, data: Partial<PlaneProfileData>) => Promise<{
    profile: ProfileCatalogData['profiles'][string];
    editor: NonNullable<ProfileCatalogData['editor']>[string];
}>;

const catalogSchema = z.object({ version: z.number().int(), revision: z.number().int().nonnegative() }).passthrough();
const recordSchema = z.record(z.string(), z.unknown());
const visibilitySchema = z.record(z.string(), z.union([z.boolean(), z.literal(0), z.literal(1), z.literal(2)]));

/** @brief Normalize the boolean visibility and enabled flags accepted by the original flat format. */
function upgradeFlatProfile(value: unknown): Record<string, unknown> {
    const data = recordSchema.parse(value);
    const mappings = z.array(recordSchema).parse(data.mappings);
    const visibility = (value: unknown): Record<string, unknown> => Array.isArray(value)
        ? Object.fromEntries(z.array(z.string()).parse(value).map(name => [name, 2]))
        : Object.fromEntries(Object.entries(visibilitySchema.parse(value)).map(([name, level]) => [name, typeof level === 'boolean' ? level ? 2 : 0 : level]));
    return { ...data, mappings: mappings.map(mapping => ({ ...mapping,
        ...(typeof mapping.alwaysVisible === 'boolean' ? { alwaysVisible: mapping.alwaysVisible ? 2 : 0 } : {}),
        ...(typeof mapping.enabled === 'boolean' ? { disabled: !mapping.enabled } : {}),
    })),
    ...(data.builtinVisible === undefined ? {} : { builtinVisible: visibility(data.builtinVisible) }),
    ...(data.unmountedVisible === undefined && data.unknownVisible === undefined ? {} : { unmountedVisible: visibility(data.unmountedVisible ?? data.unknownVisible) }) };
}

/** @brief Adjacent upgrades; keys identify the input version and each step advances exactly once. */
const configurationUpgrades: Record<number, (data: UpgradeData, profile: UpgradeProfile) => Promise<UpgradeData>> = {
    1: async data => ({ ...data, ...upgradeFlatProfile(data), version: 2,
        ...(data.inactiveProfiles === undefined ? {} : { inactiveProfiles: Object.fromEntries(Object.entries(recordSchema.parse(data.inactiveProfiles))
            .map(([name, value]) => [name, upgradeFlatProfile(value)])) }) }),
    2: async (data, createProfile) => {
        const name = z.string().parse(data.profile ?? 'Default');
        const inactive = recordSchema.parse(data.inactiveProfiles ?? {});
        const configurations = { ...inactive, [name]: data };
        const profiles: ProfileCatalogData['profiles'] = Object.create(null);
        const editor: NonNullable<ProfileCatalogData['editor']> = Object.create(null);
        for (const [name, value] of Object.entries(configurations)) {
            const flat = recordSchema.parse(value);
            z.array(z.unknown()).parse(flat.mappings);
            const upgraded = await createProfile(name, { ...flat,
                ...(flat.providedRoot === undefined ? {} : { providedRoot: upgradeProfileNodes(flat.providedRoot) }),
            } as Partial<PlaneProfileData>);
            profiles[name] = upgraded.profile;
            editor[name] = upgraded.editor;
        }
        return { version: 3, revision: data.revision, profile: name, profiles, editor };
    },
    3: async data => ({ ...data, version: 4, profiles: Object.fromEntries(Object.entries(recordSchema.parse(data.profiles)).map(([name, value]) => {
        const profile = recordSchema.parse(value);
        return [name, { ...profile, root: upgradeProfileNodes(profile.root) }];
    })) }),
};

/** @brief Follow the upgrade table to the current schema and reject unsupported or future versions. */
export async function upgradeProfileCatalog(value: unknown, createProfile: UpgradeProfile): Promise<ProfileCatalogData> {
    let data = catalogSchema.parse(value);
    while (data.version !== storageVersion) {
        const upgrade = configurationUpgrades[data.version];
        if (!upgrade) throw new Error('Invalid Profile reference catalog');
        data = await upgrade(data, createProfile);
    }
    return data as unknown as ProfileCatalogData;
}
