function copyArray(value) {
  return Array.isArray(value) ? value.slice() : []
}

function consume(script, request) {
  var remaining = copyArray(script)
  if (remaining.length === 0) {
    return {
      remaining: remaining,
      result: {
        ok: false,
        error: { code: "FAKE_SCRIPT_EXHAUSTED", message: "No fake response was configured" }
      }
    }
  }

  var step = remaining.shift() || {}
  if (step.intent && String(step.intent) !== String((request || {}).intent || "")) {
    return {
      remaining: remaining,
      result: {
        ok: false,
        error: {
          code: "FAKE_UNEXPECTED_INTENT",
          message: "Expected " + step.intent + " but received " + String((request || {}).intent || "")
        }
      }
    }
  }

  if (step.ok === false) {
    return {
      remaining: remaining,
      result: {
        ok: false,
        error: step.error || { code: "FAKE_FAILURE", message: "Configured fake failure" }
      }
    }
  }

  return {
    remaining: remaining,
    result: { ok: true, data: step.data === undefined ? null : step.data }
  }
}

if (typeof module !== "undefined") module.exports = {
  consume: consume
}
