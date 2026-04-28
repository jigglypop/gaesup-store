import type {
  ContainerPackageManifest,
  DependencyConflictPolicy,
  HostCompatibilityConfig,
  HostDependencyContract,
  PackageDependencyContract,
  RegisteredStoreSchema,
  StoreDependencyContract,
  ValidationError,
  ValidationResult,
  ValidationWarning
} from '../types'

export interface CompatibilityDecision extends ValidationResult {
  policy: DependencyConflictPolicy
  isolatedStores: string[]
  readonlyStores: string[]
}

export class CompatibilityGuard {
  private readonly host: Required<HostCompatibilityConfig>

  constructor(config: HostCompatibilityConfig = {}) {
    this.host = {
      hostVersion: config.hostVersion || '0.0.0',
      abiVersion: config.abiVersion || '1.0.0',
      dependencies: config.dependencies || [],
      stores: config.stores || [],
      defaultConflictPolicy: config.defaultConflictPolicy || 'reject'
    }
  }

  validate(manifest: ContainerPackageManifest): CompatibilityDecision {
    const errors: ValidationError[] = []
    const warnings: ValidationWarning[] = []
    const isolatedStores: string[] = []
    const readonlyStores: string[] = []

    this.validateManifestShape(manifest, errors)
    this.validateAbi(manifest, errors)
    this.validatePackageDependencies(manifest.dependencies || [], errors, warnings)
    this.validateStores(manifest.stores || [], errors, warnings, isolatedStores, readonlyStores)

    return {
      valid: errors.length === 0,
      errors,
      warnings,
      policy: this.host.defaultConflictPolicy,
      isolatedStores,
      readonlyStores
    }
  }

  private validateManifestShape(
    manifest: ContainerPackageManifest,
    errors: ValidationError[]
  ): void {
    if (manifest.manifestVersion !== '1.0') {
      errors.push({
        code: 'MANIFEST_VERSION_UNSUPPORTED',
        message: `Unsupported manifest version: ${manifest.manifestVersion}`,
        location: 'manifestVersion'
      })
    }

    if (!manifest.name) {
      errors.push({
        code: 'MANIFEST_NAME_REQUIRED',
        message: 'Container manifest requires a name',
        location: 'name'
      })
    }

    if (!manifest.version) {
      errors.push({
        code: 'MANIFEST_CONTAINER_VERSION_REQUIRED',
        message: 'Container manifest requires a version',
        location: 'version'
      })
    }
  }

  private validateAbi(
    manifest: ContainerPackageManifest,
    errors: ValidationError[]
  ): void {
    const requiredAbi = manifest.gaesup?.abiVersion

    if (!requiredAbi) {
      errors.push({
        code: 'ABI_VERSION_REQUIRED',
        message: 'Container manifest must declare gaesup.abiVersion',
        location: 'gaesup.abiVersion'
      })
      return
    }

    if (!isVersionCompatible(this.host.abiVersion, requiredAbi)) {
      errors.push({
        code: 'ABI_VERSION_MISMATCH',
        message: `Container requires gaesup ABI ${requiredAbi}, host provides ${this.host.abiVersion}`,
        location: 'gaesup.abiVersion'
      })
    }

    const minHostVersion = manifest.gaesup?.minHostVersion
    if (minHostVersion && !isVersionCompatible(this.host.hostVersion, minHostVersion)) {
      errors.push({
        code: 'HOST_VERSION_MISMATCH',
        message: `Container requires host ${minHostVersion}, current host is ${this.host.hostVersion}`,
        location: 'gaesup.minHostVersion'
      })
    }
  }

  private validatePackageDependencies(
    requiredDeps: PackageDependencyContract[],
    errors: ValidationError[],
    warnings: ValidationWarning[]
  ): void {
    for (const required of requiredDeps) {
      const provided = this.findDependency(required)

      if (!provided) {
        const issue = {
          code: 'PACKAGE_DEPENDENCY_MISSING',
          message: `Missing host dependency ${required.name}@${required.version}`,
          location: `dependencies.${required.name}`
        }

        if (required.optional) {
          warnings.push(issue)
        } else {
          errors.push(issue)
        }
        continue
      }

      if (!isVersionCompatible(provided.version, required.version)) {
        errors.push({
          code: 'PACKAGE_DEPENDENCY_VERSION_MISMATCH',
          message: `Dependency ${required.name} requires ${required.version}, host provides ${provided.version}`,
          location: `dependencies.${required.name}`
        })
      }
    }
  }

  private validateStores(
    requiredStores: StoreDependencyContract[],
    errors: ValidationError[],
    warnings: ValidationWarning[],
    isolatedStores: string[],
    readonlyStores: string[]
  ): void {
    for (const required of requiredStores) {
      const provided = this.findStore(required)
      const policy = required.conflictPolicy || this.host.defaultConflictPolicy

      if (!provided) {
        if (required.required === false) {
          warnings.push({
            code: 'STORE_SCHEMA_MISSING_OPTIONAL',
            message: `Optional store ${required.storeId} is not registered`,
            location: `stores.${required.storeId}`
          })
          continue
        }

        this.handleStoreConflict(
          policy,
          required.storeId,
          `Required store ${required.storeId} is not registered`,
          errors,
          isolatedStores,
          readonlyStores
        )
        continue
      }

      if (provided.schemaId !== required.schemaId) {
        this.handleStoreConflict(
          policy,
          required.storeId,
          `Store ${required.storeId} schema id mismatch: requires ${required.schemaId}, host provides ${provided.schemaId}`,
          errors,
          isolatedStores,
          readonlyStores
        )
        continue
      }

      const range = required.compatRange || required.schemaVersion
      if (!isVersionCompatible(provided.schemaVersion, range)) {
        this.handleStoreConflict(
          policy,
          required.storeId,
          `Store ${required.storeId} schema version mismatch: requires ${range}, host provides ${provided.schemaVersion}`,
          errors,
          isolatedStores,
          readonlyStores
        )
      }
    }
  }

  private handleStoreConflict(
    policy: DependencyConflictPolicy,
    storeId: string,
    message: string,
    errors: ValidationError[],
    isolatedStores: string[],
    readonlyStores: string[]
  ): void {
    if (policy === 'isolate') {
      isolatedStores.push(storeId)
      return
    }

    if (policy === 'readonly') {
      readonlyStores.push(storeId)
      return
    }

    errors.push({
      code: 'STORE_SCHEMA_CONFLICT',
      message,
      location: `stores.${storeId}`
    })
  }

  private findDependency(required: PackageDependencyContract): HostDependencyContract | undefined {
    return this.host.dependencies.find((dependency) => dependency.name === required.name)
  }

  private findStore(required: StoreDependencyContract): RegisteredStoreSchema | undefined {
    return this.host.stores.find((store) => store.storeId === required.storeId)
  }
}

export function isVersionCompatible(providedVersion: string, requiredRange: string): boolean {
  const provided = parseVersion(providedVersion)
  const ranges = requiredRange.split(/\s+/).filter(Boolean)

  if (ranges.length === 0) {
    return true
  }

  return ranges.every((range) => {
    if (range === '*' || range.toLowerCase() === 'latest') {
      return true
    }

    if (range.startsWith('^')) {
      const base = parseVersion(range.slice(1))
      return provided.major === base.major && compareVersions(provided, base) >= 0
    }

    if (range.startsWith('~')) {
      const base = parseVersion(range.slice(1))
      return provided.major === base.major &&
        provided.minor === base.minor &&
        compareVersions(provided, base) >= 0
    }

    if (range.startsWith('>=')) {
      return compareVersions(provided, parseVersion(range.slice(2))) >= 0
    }

    if (range.startsWith('>')) {
      return compareVersions(provided, parseVersion(range.slice(1))) > 0
    }

    if (range.startsWith('<=')) {
      return compareVersions(provided, parseVersion(range.slice(2))) <= 0
    }

    if (range.startsWith('<')) {
      return compareVersions(provided, parseVersion(range.slice(1))) < 0
    }

    return compareVersions(provided, parseVersion(range)) === 0
  })
}

function parseVersion(version: string) {
  const [major = '0', minor = '0', patch = '0'] = version.replace(/^[^\d]*/, '').split('.')
  return {
    major: Number.parseInt(major, 10) || 0,
    minor: Number.parseInt(minor, 10) || 0,
    patch: Number.parseInt(patch, 10) || 0
  }
}

function compareVersions(
  left: ReturnType<typeof parseVersion>,
  right: ReturnType<typeof parseVersion>
): number {
  if (left.major !== right.major) return left.major - right.major
  if (left.minor !== right.minor) return left.minor - right.minor
  return left.patch - right.patch
}
