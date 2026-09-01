function serviceFor(shell, pluginId) {
  if (!shell || typeof shell.serviceFor !== "function") return null
  return shell.serviceFor(String(pluginId || ""))
}

if (typeof module !== "undefined") module.exports = {
  serviceFor: serviceFor
}
