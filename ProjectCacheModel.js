var SCHEMA_VERSION = 1

function emptyCache() {
  return { projects: [], updatedAt: null }
}

function serialize(projects, updatedAt) {
  if (!Array.isArray(projects)) throw new Error("projects must be an array")
  if (typeof updatedAt !== "string" || updatedAt.length === 0)
    throw new Error("updatedAt must be a non-empty string")
  return JSON.stringify({
    schemaVersion: SCHEMA_VERSION,
    projects: projects,
    updatedAt: updatedAt
  })
}

function deserialize(text) {
  if (typeof text !== "string" || text.length === 0) return emptyCache()
  try {
    var value = JSON.parse(text)
    if (!value || typeof value !== "object" || Array.isArray(value)
        || value.schemaVersion !== SCHEMA_VERSION || !Array.isArray(value.projects)
        || typeof value.updatedAt !== "string" || value.updatedAt.length === 0)
      return emptyCache()
    return { projects: value.projects, updatedAt: value.updatedAt }
  } catch (error) {
    return emptyCache()
  }
}

if (typeof module !== "undefined") module.exports = {
  deserialize: deserialize,
  serialize: serialize
}
