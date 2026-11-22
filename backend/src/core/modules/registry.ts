import type { Router } from 'express';
import type { ModuleManifest } from '@awaaz/shared';

export interface BackendFeatureModule {
  manifest: ModuleManifest;
  createRouter: () => Router;
}

export class ModuleRegistry {
  private readonly modules = new Map<string, BackendFeatureModule>();

  register(mod: BackendFeatureModule): void {
    if (this.modules.has(mod.manifest.id)) {
      throw new Error(`Module '${mod.manifest.id}' is already registered.`);
    }
    this.modules.set(mod.manifest.id, mod);
  }

  listManifests(): ModuleManifest[] {
    return Array.from(this.modules.values()).map((m) => m.manifest);
  }

  getAll(): BackendFeatureModule[] {
    return Array.from(this.modules.values());
  }
}
