function isModuleExports(moduleValue: unknown): moduleValue is Record<string, unknown> {
  return moduleValue !== null && typeof moduleValue === "object"
}

function isModuleNamespaceObject(moduleValue: Record<string, unknown>): boolean {
  return Object.prototype.toString.call(moduleValue) === "[object Module]"
}

export function createRestoreExports(moduleValue: unknown): Record<string, unknown> {
  if (typeof moduleValue === "function") {
    const functionExports = Object.assign({}, moduleValue)
    return {
      ...functionExports,
      default: moduleValue,
    }
  }

  if (isModuleExports(moduleValue)) {
    if (isModuleNamespaceObject(moduleValue)) {
      return { ...moduleValue }
    }

    return moduleValue
  }

  return { default: moduleValue }
}
